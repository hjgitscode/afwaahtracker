--------------------------------------------------------------------------------
-- AfwaahTracker :: 13_novelty_pipeline.sql
-- Makes the provenance / lineage / ledger stages of a live investigation
-- observable and complete. Safe to run on an existing database and safe to run
-- again: tables and columns are only added, CHECK lists only widened, program
-- units replaced. No data is deleted by this script.
--
--   SEARCH_RUN_STAGES        one row per pipeline stage of a web investigation
--                            (items examined / rows written), so "0 detected"
--                            can be told apart from "stage never ran"
--   CLAIMS.merged_into_claim_id + status MERGED
--                            an older title-made family whose sources now
--                            belong to a proposition-based family
--   RECORD_RUN_STAGE         upsert of one stage row
--   RECORD_ATTRIBUTION_REFERENCE  stricter publisher matching ("AP" no longer
--                            matches "Apple"; "PTI" matches "ptinews.com")
--   GENERATE_MUTATION_LEDGER relation objects compared by their proposition
--                            key (word order / punctuation is not a mutation)
--   CHOOSE_VARIANT_PARENT    1 hyperlink / submitted / canonical reference,
--                            2 attribution reference, 3 closest earlier dated
--                            variant of the same proposition, 4 most similar
--                            earlier wording (claims without a proposition),
--                            5 none
--   RELINK_CLAIM_LINEAGE     also re-evaluates ATTRIBUTION_REFERENCE parents
--   REFRESH_CLAIM_PROVENANCE known upstream source for every source of a claim
--   FINALISE_CLAIM_LINEAGE   provenance -> parents -> Mutation Ledger, one call
--   SUPERSEDE_LEGACY_VARIANTS moves a source out of older title-made families
--                            once it belongs to a proposition-based family
--   VW_CLAIM_NOVELTY_DIAGNOSTICS  per-claim counts for every novelty stage
--------------------------------------------------------------------------------
SET DEFINE OFF
SET SQLBLANKLINES ON

BEGIN
    ------------------------------------------------------------------ CHECK updates
    afw_swap_check('claims', 'ck_claims_status', 'MERGED',
        'status IN (''UNVERIFIED'',''DEVELOPING'',''CORROBORATED'',''DISPUTED'',''DEBUNKED'',''CANDIDATE'',''MERGED'')');
    afw_swap_check('claim_variants', 'ck_variants_lineage_basis', 'ATTRIBUTION_REFERENCE',
        'lineage_basis IN (''CURATED'',''MANUAL'',''EXPLICIT_REFERENCE'',''ATTRIBUTION_REFERENCE'',
                                          ''PROPOSITION_PREDECESSOR'',''LEXICAL_PREDECESSOR'',''NONE'',''AUTO_ROOT'')');

    ------------------------------------------------------------------ CLAIMS.merged_into_claim_id
    afw_ddl('ALTER TABLE claims ADD (merged_into_claim_id NUMBER)');
    afw_ddl('ALTER TABLE claims ADD CONSTRAINT fk_claims_merged_into
                 FOREIGN KEY (merged_into_claim_id) REFERENCES claims (claim_id) ON DELETE SET NULL');
    afw_ddl('ALTER TABLE claims ADD CONSTRAINT ck_claims_not_merged_self
                 CHECK (merged_into_claim_id IS NULL OR merged_into_claim_id <> claim_id)');
    afw_ddl('CREATE INDEX ix_claims_merged_into ON claims (merged_into_claim_id)');

    ------------------------------------------------------------------ CLAIM_VARIANTS.relation_object_key
    -- the proposition object key of this variant (the same key as in the
    -- family signature: VICE_PRESIDENT, CRORE_FLOOD_PACKAGE_RELIEF ...), so the
    -- Mutation Ledger compares objects the way the family was identified
    afw_ddl('ALTER TABLE claim_variants ADD (relation_object_key VARCHAR2(200))');

    ------------------------------------------------------------------ SEARCH_RUN_STAGES
    afw_ddl('CREATE TABLE search_run_stages (
        search_run_id   NUMBER        NOT NULL,
        stage_code      VARCHAR2(20)  NOT NULL,
        stage_order     NUMBER(2)     NOT NULL,
        items_examined  NUMBER        DEFAULT 0 NOT NULL,
        rows_written    NUMBER        DEFAULT 0 NOT NULL,
        detail          VARCHAR2(400),
        recorded_at     TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT pk_search_run_stages PRIMARY KEY (search_run_id, stage_code))');
    afw_ddl('ALTER TABLE search_run_stages ADD CONSTRAINT fk_run_stages_run
                 FOREIGN KEY (search_run_id) REFERENCES web_search_runs (search_run_id) ON DELETE CASCADE');
    afw_ddl('ALTER TABLE search_run_stages ADD CONSTRAINT ck_run_stages_code
                 CHECK (stage_code IN (''SEARCH'',''NORMALISE'',''FETCH'',''EVIDENCE'',''PROPOSITIONS'',''VARIANTS'',
                                       ''REFERENCES'',''PROVENANCE'',''LINEAGE'',''MUTATIONS'',''MATCHES'',''SUPERSEDE''))');
    afw_ddl('ALTER TABLE search_run_stages ADD CONSTRAINT ck_run_stages_counts
                 CHECK (items_examined >= 0 AND rows_written >= 0)');
END;
/

--------------------------------------------------------------------------------
-- RECORD_RUN_STAGE: one row per stage of a run (re-recording replaces it)
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE record_run_stage (
    p_run_id    IN NUMBER,
    p_stage     IN VARCHAR2,
    p_examined  IN NUMBER,
    p_written   IN NUMBER,
    p_detail    IN VARCHAR2 DEFAULT NULL
)
IS
BEGIN
    MERGE INTO search_run_stages t
    USING (SELECT p_run_id AS run_id, p_stage AS stage FROM dual) s
       ON (t.search_run_id = s.run_id AND t.stage_code = s.stage)
     WHEN MATCHED THEN
          UPDATE SET t.items_examined = NVL(p_examined, 0), t.rows_written = NVL(p_written, 0),
                     t.detail = SUBSTR(p_detail, 1, 400), t.recorded_at = SYSTIMESTAMP
     WHEN NOT MATCHED THEN
          INSERT (search_run_id, stage_code, stage_order, items_examined, rows_written, detail)
          VALUES (p_run_id, p_stage,
                  CASE p_stage WHEN 'SEARCH' THEN 1 WHEN 'NORMALISE' THEN 2 WHEN 'FETCH' THEN 3
                               WHEN 'EVIDENCE' THEN 4 WHEN 'PROPOSITIONS' THEN 5 WHEN 'VARIANTS' THEN 6
                               WHEN 'SUPERSEDE' THEN 7 WHEN 'REFERENCES' THEN 8 WHEN 'PROVENANCE' THEN 9
                               WHEN 'LINEAGE' THEN 10 WHEN 'MUTATIONS' THEN 11 ELSE 12 END,
                  NVL(p_examined, 0), NVL(p_written, 0), SUBSTR(p_detail, 1, 400));
END record_run_stage;
/

--------------------------------------------------------------------------------
-- PUBLISHER_MATCHES: does an attribution name ("PTI", "The Hindu", "AP")
-- denote this stored publisher ("ptinews.com", "thehindu.com", "AP News")?
-- Exact name key, or the name key followed only by a news / domain suffix.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publisher_matches (p_publisher IN VARCHAR2, p_name IN VARCHAR2)
RETURN NUMBER DETERMINISTIC
IS
    v_pub  VARCHAR2(200) := name_key(p_publisher);
    v_name VARCHAR2(200) := name_key(p_name);
    v_rest VARCHAR2(200);
BEGIN
    IF v_pub IS NULL OR v_name IS NULL OR LENGTH(v_name) < 2 THEN
        RETURN 0;
    END IF;
    v_pub := REGEXP_REPLACE(v_pub, '^(WWW)', '');
    IF v_pub = v_name OR v_pub = 'THE' || v_name OR 'THE' || v_pub = v_name THEN
        RETURN 1;
    END IF;
    FOR k IN (SELECT v_name AS n FROM dual UNION ALL SELECT 'THE' || v_name FROM dual) LOOP
        IF SUBSTR(v_pub, 1, LENGTH(k.n)) = k.n THEN
            v_rest := SUBSTR(v_pub, LENGTH(k.n) + 1);
            IF REGEXP_LIKE(v_rest, '^(NEWS|NEWSAGENCY|ONLINE|DIGITAL|LIVE|WIRE)?(COM|IN|ORG|NET|COUK|COIN|NEWS|TV)?$') THEN
                RETURN 1;
            END IF;
        END IF;
    END LOOP;
    RETURN 0;
END publisher_matches;
/

--------------------------------------------------------------------------------
-- RECORD_ATTRIBUTION_REFERENCE: "according to Reuters", "via PTI" ...
-- When the named publisher has a stored source in the same claim family as
-- this source, record an ATTRIBUTION reference to its earliest such source.
-- Returns 1 when a new reference was recorded.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_attribution_reference (
    p_source_id IN NUMBER,
    p_publisher IN VARCHAR2
) RETURN NUMBER
IS
BEGIN
    IF p_source_id IS NULL OR name_key(p_publisher) IS NULL OR LENGTH(name_key(p_publisher)) < 2 THEN
        RETURN 0;
    END IF;
    FOR t IN (SELECT s2.source_id
                FROM sources s2
               WHERE s2.source_id <> p_source_id
                 AND publisher_matches(s2.publisher, p_publisher) = 1
                 AND EXISTS (SELECT 1
                               FROM claim_variants a
                               JOIN claim_variants b ON b.claim_id = a.claim_id
                              WHERE a.source_id = p_source_id
                                AND b.source_id = s2.source_id)
               ORDER BY s2.published_at NULLS LAST, s2.source_id
               FETCH FIRST 1 ROWS ONLY)
    LOOP
        RETURN record_source_reference(p_source_id, t.source_id, 'ATTRIBUTION',
                                       'Text attributes its information to ' || SUBSTR(p_publisher, 1, 200) || '.');
    END LOOP;
    RETURN 0;
END record_attribution_reference;
/

--------------------------------------------------------------------------------
-- GENERATE_MUTATION_LEDGER: one row per structured component that differs
-- between a parent and a child variant. Values are normalised first (case,
-- whitespace; names by NAME_KEY; relation objects by their proposition key),
-- so "Vice-President" -> "Vice President" or a reordered phrase is not a
-- mutation, while "Vice President" -> "Director" is.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE generate_mutation_ledger (
    p_parent_variant_id IN NUMBER,
    p_child_variant_id  IN NUMBER
)
IS
    v_parent  claim_variants%ROWTYPE;
    v_child   claim_variants%ROWTYPE;

    FUNCTION norm (p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN LOWER(TRIM(REGEXP_REPLACE(p_value, '\s+', ' ')));
    END norm;

    FUNCTION pretty (p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN INITCAP(LOWER(p_value));
    END pretty;

    PROCEDURE insert_change (p_component IN VARCHAR2, p_old IN VARCHAR2, p_new IN VARCHAR2, p_escalates IN CHAR) IS
    BEGIN
        INSERT INTO claim_mutations
            (claim_id, parent_variant_id, child_variant_id,
             changed_component, old_value, new_value, is_escalation)
        VALUES
            (v_child.claim_id, v_parent.variant_id, v_child.variant_id,
             p_component, SUBSTR(p_old, 1, 200), SUBSTR(p_new, 1, 200), p_escalates);
    END insert_change;

    PROCEDURE record_change (
        p_component IN VARCHAR2,
        p_old       IN VARCHAR2,
        p_new       IN VARCHAR2,
        p_escalates IN CHAR DEFAULT 'N'
    ) IS
    BEGIN
        IF (norm(p_old) IS NULL AND norm(p_new) IS NULL)
           OR norm(p_old) = norm(p_new) THEN
            RETURN;
        END IF;
        insert_change(p_component, p_old, p_new, p_escalates);
    END record_change;

    -- Relation values: compared by name key (punctuation / honorific / case blind)
    PROCEDURE record_relation (p_component IN VARCHAR2, p_old IN VARCHAR2, p_new IN VARCHAR2) IS
    BEGIN
        IF NVL(name_key(p_old), '~') = NVL(name_key(p_new), '~') THEN
            RETURN;
        END IF;
        insert_change(p_component, p_old, p_new, 'N');
    END record_relation;
BEGIN
    IF p_parent_variant_id IS NULL OR p_child_variant_id IS NULL THEN
        RETURN;
    END IF;

    IF p_parent_variant_id = p_child_variant_id THEN
        RAISE_APPLICATION_ERROR(-20010, 'A variant cannot be compared with itself.');
    END IF;

    SELECT * INTO v_parent FROM claim_variants WHERE variant_id = p_parent_variant_id;
    SELECT * INTO v_child  FROM claim_variants WHERE variant_id = p_child_variant_id;

    IF v_parent.claim_id <> v_child.claim_id THEN
        RAISE_APPLICATION_ERROR(-20011,
            'Parent and child variants belong to different claims.');
    END IF;

    DELETE FROM claim_mutations
     WHERE parent_variant_id = p_parent_variant_id
       AND child_variant_id  = p_child_variant_id;

    record_change('ACTOR',       v_parent.actor,          v_child.actor);
    record_change('ACTION',      v_parent.action,         v_child.action);
    record_change('TARGET',      v_parent.target_object,  v_child.target_object);
    record_change('LOCATION',    v_parent.location_name,  v_child.location_name);
    record_change('EVENT',       v_parent.event_name,     v_child.event_name);
    record_change('DATE',        v_parent.claimed_date,   v_child.claimed_date);
    record_change('QUANTITY',    v_parent.quantity_value, v_child.quantity_value);
    record_change('CERTAINTY',   pretty(v_parent.certainty), pretty(v_child.certainty),
                  CASE WHEN certainty_rank(v_child.certainty)
                            - certainty_rank(v_parent.certainty) >= 2
                       THEN 'Y' ELSE 'N' END);
    record_change('ATTRIBUTION', v_parent.attribution,    v_child.attribution);

    IF v_parent.relation_predicate IS NOT NULL AND v_child.relation_predicate IS NOT NULL THEN
        record_relation('SUBJECT',   v_parent.relation_subject,   v_child.relation_subject);
        record_relation('PREDICATE', v_parent.relation_predicate, v_child.relation_predicate);
        IF v_parent.relation_object_key IS NOT NULL AND v_child.relation_object_key IS NOT NULL THEN
            IF v_parent.relation_object_key <> v_child.relation_object_key THEN
                insert_change(CASE WHEN v_child.relation_predicate = 'HOLDS_ROLE' THEN 'ROLE' ELSE 'OBJECT' END,
                              v_parent.relation_object, v_child.relation_object, 'N');
            END IF;
        ELSE
            record_relation(CASE WHEN v_child.relation_predicate = 'HOLDS_ROLE' THEN 'ROLE' ELSE 'OBJECT' END,
                            v_parent.relation_object, v_child.relation_object);
        END IF;
        record_relation('ORGANISATION', v_parent.relation_qualifier, v_child.relation_qualifier);
    END IF;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20012,
            'Variant not found while generating mutation ledger ('
            || p_parent_variant_id || ' -> ' || p_child_variant_id || ').');
END generate_mutation_ledger;
/

--------------------------------------------------------------------------------
-- CHOOSE_VARIANT_PARENT. Parent wording, in order:
--   1. EXPLICIT_REFERENCE       a hyperlink / submitted link / canonical link
--                               (or the known upstream source) to a source
--                               already in the family
--   2. ATTRIBUTION_REFERENCE    the text credits a source already in the family
--   3. PROPOSITION_PREDECESSOR  same structured proposition: the strictly
--                               earlier dated variant with the fewest
--                               structured differences (closest in time on ties)
--   4. LEXICAL_PREDECESSOR      claims without a proposition: most similar
--                               strictly earlier wording (>= p_min_similarity)
--   5. NONE                     never invented to make a graph look busy
-- Descendants of the variant being relinked are excluded (no cycles); an
-- undated source only ever gets a parent through an explicit reference.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE choose_variant_parent (
    p_claim_id           IN  NUMBER,
    p_source_id          IN  NUMBER,
    p_variant_text       IN  VARCHAR2,
    p_exclude_variant_id IN  NUMBER DEFAULT NULL,
    p_min_similarity     IN  NUMBER DEFAULT 55,
    o_parent_variant_id  OUT NUMBER,
    o_basis              OUT VARCHAR2,
    o_similarity         OUT NUMBER,
    p_certainty          IN  VARCHAR2 DEFAULT NULL,
    p_claimed_date       IN  VARCHAR2 DEFAULT NULL,
    p_quantity           IN  VARCHAR2 DEFAULT NULL,
    p_location           IN  VARCHAR2 DEFAULT NULL,
    p_rel_object         IN  VARCHAR2 DEFAULT NULL
)
IS
    v_published   TIMESTAMP;
    v_has_prop    NUMBER;
BEGIN
    o_parent_variant_id := NULL;
    o_basis := 'NONE';
    o_similarity := NULL;

    SELECT published_at INTO v_published FROM sources WHERE source_id = p_source_id;

    -- 1 + 2. Explicit reference / attribution to a source already in this family
    FOR r IN (SELECT v.variant_id, rf.kind
                FROM (SELECT to_source_id, CASE reference_type WHEN 'ATTRIBUTION' THEN 2 ELSE 1 END AS kind
                        FROM source_references WHERE from_source_id = p_source_id
                      UNION ALL
                      -- the known upstream source counts as the kind of reference behind it
                      SELECT s0.derived_from_source_id,
                             CASE WHEN EXISTS (SELECT 1 FROM source_references r0
                                                WHERE r0.from_source_id = s0.source_id
                                                  AND r0.to_source_id = s0.derived_from_source_id
                                                  AND r0.reference_type <> 'ATTRIBUTION') THEN 1
                                  WHEN EXISTS (SELECT 1 FROM source_references r0
                                                WHERE r0.from_source_id = s0.source_id
                                                  AND r0.to_source_id = s0.derived_from_source_id) THEN 2
                                  ELSE 1 END
                        FROM sources s0
                       WHERE s0.source_id = p_source_id AND s0.derived_from_source_id IS NOT NULL) rf
                JOIN claim_variants v ON v.source_id = rf.to_source_id AND v.claim_id = p_claim_id
                JOIN sources s        ON s.source_id = v.source_id
               WHERE v.source_id <> p_source_id
                 AND (p_exclude_variant_id IS NULL
                      OR v.variant_id NOT IN (SELECT variant_id FROM claim_variants
                                               START WITH variant_id = p_exclude_variant_id
                                               CONNECT BY NOCYCLE PRIOR variant_id = parent_variant_id))
               ORDER BY rf.kind, s.published_at NULLS LAST, v.variant_id
               FETCH FIRST 1 ROWS ONLY)
    LOOP
        o_parent_variant_id := r.variant_id;
        o_basis := CASE r.kind WHEN 2 THEN 'ATTRIBUTION_REFERENCE' ELSE 'EXPLICIT_REFERENCE' END;
        RETURN;
    END LOOP;

    IF v_published IS NULL THEN
        RETURN;  -- an undated source cannot have an inferred predecessor
    END IF;

    SELECT COUNT(*) INTO v_has_prop FROM claim_propositions WHERE claim_id = p_claim_id;

    -- 3. Same proposition: closest structured variation among earlier variants
    IF v_has_prop > 0 THEN
        FOR r IN (SELECT v.variant_id,
                         (CASE WHEN NVL(v.certainty, '~') <> NVL(UPPER(p_certainty), NVL(v.certainty, '~')) THEN 1 ELSE 0 END
                          + CASE WHEN NVL(LOWER(v.claimed_date), '~') <> NVL(LOWER(p_claimed_date), '~') THEN 1 ELSE 0 END
                          + CASE WHEN NVL(LOWER(v.quantity_value), '~') <> NVL(LOWER(p_quantity), '~') THEN 1 ELSE 0 END
                          + CASE WHEN NVL(LOWER(v.location_name), '~') <> NVL(LOWER(p_location), '~') THEN 1 ELSE 0 END
                          + CASE WHEN NVL(name_key(v.relation_object), '~') <> NVL(name_key(p_rel_object), NVL(name_key(v.relation_object), '~'))
                                  AND NVL(v.relation_object_key, '~') <> NVL((SELECT x.relation_object_key FROM claim_variants x
                                                                              WHERE x.variant_id = p_exclude_variant_id), '#')
                                 THEN 1 ELSE 0 END
                         ) AS differences,
                         s.published_at
                    FROM claim_variants v
                    JOIN sources s ON s.source_id = v.source_id
                   WHERE v.claim_id = p_claim_id
                     AND v.source_id <> p_source_id
                     AND s.published_at < v_published
                     AND (p_exclude_variant_id IS NULL
                          OR v.variant_id NOT IN (SELECT variant_id FROM claim_variants
                                                   START WITH variant_id = p_exclude_variant_id
                                                   CONNECT BY NOCYCLE PRIOR variant_id = parent_variant_id))
                   ORDER BY differences, s.published_at DESC, v.variant_id DESC
                   FETCH FIRST 1 ROWS ONLY)
        LOOP
            o_parent_variant_id := r.variant_id;
            o_basis := 'PROPOSITION_PREDECESSOR';
            o_similarity := 100 - 20 * r.differences;
        END LOOP;
        RETURN;
    END IF;

    -- 4. Lexical predecessor (claims without a structured proposition)
    FOR r IN (SELECT variant_id, sim
                FROM (SELECT v.variant_id,
                             wording_similarity(v.variant_text, p_variant_text) AS sim,
                             s.published_at
                        FROM claim_variants v
                        JOIN sources s ON s.source_id = v.source_id
                       WHERE v.claim_id = p_claim_id
                         AND v.source_id <> p_source_id
                         AND s.published_at < v_published
                         AND (p_exclude_variant_id IS NULL
                              OR v.variant_id NOT IN (SELECT variant_id FROM claim_variants
                                                       START WITH variant_id = p_exclude_variant_id
                                                       CONNECT BY NOCYCLE PRIOR variant_id = parent_variant_id)))
               WHERE sim >= p_min_similarity
               ORDER BY sim DESC, published_at DESC, variant_id DESC
               FETCH FIRST 1 ROWS ONLY)
    LOOP
        o_parent_variant_id := r.variant_id;
        o_basis := 'LEXICAL_PREDECESSOR';
        o_similarity := r.sim;
    END LOOP;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        NULL;
END choose_variant_parent;
/

--------------------------------------------------------------------------------
-- RELINK_CLAIM_LINEAGE: recompute every automatically chosen parent of one
-- claim in publication order (curated / manual lineage is never touched). The
-- compound trigger on CLAIM_VARIANTS regenerates the ledger for each change.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE relink_claim_lineage (p_claim_id IN NUMBER)
IS
    v_parent NUMBER;
    v_basis  VARCHAR2(30);
    v_sim    NUMBER;
BEGIN
    FOR v IN (SELECT cv.variant_id, cv.source_id, cv.variant_text, cv.parent_variant_id, cv.lineage_basis,
                     cv.certainty, cv.claimed_date, cv.quantity_value, cv.location_name, cv.relation_object
                FROM claim_variants cv
                JOIN sources s ON s.source_id = cv.source_id
               WHERE cv.claim_id = p_claim_id
                 AND cv.lineage_basis IN ('AUTO_ROOT','EXPLICIT_REFERENCE','ATTRIBUTION_REFERENCE',
                                          'PROPOSITION_PREDECESSOR','LEXICAL_PREDECESSOR','NONE')
               ORDER BY s.published_at NULLS LAST, cv.variant_id)
    LOOP
        choose_variant_parent(p_claim_id, v.source_id, v.variant_text, v.variant_id, 55,
                              v_parent, v_basis, v_sim,
                              v.certainty, v.claimed_date, v.quantity_value, v.location_name, v.relation_object);
        IF NVL(v_parent, -1) <> NVL(v.parent_variant_id, -1) OR v_basis <> v.lineage_basis THEN
            UPDATE claim_variants
               SET parent_variant_id = v_parent,
                   lineage_basis     = v_basis
             WHERE variant_id = v.variant_id;
        END IF;
    END LOOP;
END relink_claim_lineage;
/

--------------------------------------------------------------------------------
-- REFRESH_CLAIM_PROVENANCE: a reference may have been recorded before its
-- target joined this claim family; give every source of the claim its known
-- upstream source now (APPLY_SOURCE_DEPENDENCE: same family, no cycles).
-- Returns the number of sources that gained a known upstream source.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_claim_provenance (p_claim_id IN NUMBER)
RETURN NUMBER
IS
    v_added NUMBER := 0;
BEGIN
    FOR s IN (SELECT DISTINCT v.source_id
                FROM claim_variants v
                JOIN sources src ON src.source_id = v.source_id
               WHERE v.claim_id = p_claim_id
                 AND src.derived_from_source_id IS NULL
                 AND EXISTS (SELECT 1 FROM source_references r WHERE r.from_source_id = v.source_id))
    LOOP
        IF apply_source_dependence(s.source_id) IS NOT NULL THEN
            v_added := v_added + 1;
        END IF;
    END LOOP;
    RETURN v_added;
END refresh_claim_provenance;
/

--------------------------------------------------------------------------------
-- FINALISE_CLAIM_LINEAGE: after a run (or a repair) touches a claim family:
-- known upstream sources -> wording parents -> Mutation Ledger rebuilt from
-- the final parent links. Called once per touched claim; no manual step.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE finalise_claim_lineage (p_claim_id IN NUMBER)
IS
    v_n NUMBER;
BEGIN
    v_n := refresh_claim_provenance(p_claim_id);
    relink_claim_lineage(p_claim_id);
    rebuild_claim_mutations(p_claim_id);
END finalise_claim_lineage;
/

--------------------------------------------------------------------------------
-- SUPERSEDE_LEGACY_VARIANTS: once a source belongs to a proposition-based
-- family, remove its variant from older automated families that have no
-- proposition (title-made). Such a family that loses its last variant is kept
-- for history with status MERGED and merged_into_claim_id; its search-claim
-- matches are recomputed for the affected runs. Demo and manual claims are
-- never touched. Returns the number of variants moved out.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION supersede_legacy_variants (p_source_id IN NUMBER)
RETURN NUMBER
IS
    v_target  NUMBER;
    v_left    NUMBER;
    v_moved   NUMBER := 0;
BEGIN
    SELECT MIN(v.claim_id) KEEP (DENSE_RANK FIRST ORDER BY v.variant_id)
      INTO v_target
      FROM claim_variants v
      JOIN claim_propositions p ON p.claim_id = v.claim_id
     WHERE v.source_id = p_source_id;
    IF v_target IS NULL THEN
        RETURN 0;
    END IF;

    FOR l IN (SELECT v.variant_id, v.claim_id
                FROM claim_variants v
                JOIN claims c ON c.claim_id = v.claim_id
               WHERE v.source_id = p_source_id
                 AND c.claim_origin = 'AUTOMATED'
                 AND c.status <> 'MERGED'
                 AND NOT EXISTS (SELECT 1 FROM claim_propositions p WHERE p.claim_id = v.claim_id))
    LOOP
        -- Detach first (an ON DELETE SET NULL cascade would fire the ledger
        -- trigger while CLAIM_MUTATIONS is itself being cascaded: ORA-04091)
        DELETE FROM claim_mutations
         WHERE parent_variant_id = l.variant_id OR child_variant_id = l.variant_id;
        UPDATE claim_variants SET parent_variant_id = NULL, lineage_basis = 'NONE'
         WHERE parent_variant_id = l.variant_id;
        DELETE FROM claim_variants WHERE variant_id = l.variant_id;
        v_moved := v_moved + 1;
        UPDATE claims SET merged_into_claim_id = NVL(merged_into_claim_id, v_target)
         WHERE claim_id = l.claim_id;

        SELECT COUNT(*) INTO v_left FROM claim_variants WHERE claim_id = l.claim_id;
        IF v_left = 0 THEN
            UPDATE claims SET status = 'MERGED' WHERE claim_id = l.claim_id;
            write_audit('CLAIMS', 'UPDATE', l.claim_id,
                        'Title-made family merged into proposition-based claim #' || v_target);
            FOR r IN (SELECT search_run_id FROM search_claim_matches WHERE claim_id = l.claim_id) LOOP
                DELETE FROM search_claim_matches WHERE search_run_id = r.search_run_id AND claim_id = l.claim_id;
                record_search_claim_matches(r.search_run_id);
            END LOOP;
        ELSE
            relink_claim_lineage(l.claim_id);
        END IF;
    END LOOP;
    RETURN v_moved;
END supersede_legacy_variants;
/

--------------------------------------------------------------------------------
-- VW_CLAIM_NOVELTY_DIAGNOSTICS: every novelty stage of a claim family, counted
-- in Oracle. A zero here is a zero in the stored relations.
--------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_claim_novelty_diagnostics AS
SELECT c.claim_id,
       c.status,
       c.merged_into_claim_id,
       CASE WHEN p.claim_id IS NULL THEN 'N' ELSE 'Y' END                         AS has_proposition,
       p.normalized_signature,
       (SELECT COUNT(DISTINCT v.source_id) FROM claim_variants v WHERE v.claim_id = c.claim_id) AS source_count,
       (SELECT COUNT(DISTINCT v.evidence_id) FROM claim_variants v WHERE v.claim_id = c.claim_id) AS evidence_count,
       (SELECT COUNT(*)
          FROM source_evidence e
         WHERE e.source_id IN (SELECT v.source_id FROM claim_variants v WHERE v.claim_id = c.claim_id)) AS stored_sentence_count,
       (SELECT COUNT(*) FROM claim_variants v WHERE v.claim_id = c.claim_id AND v.evidence_id IS NOT NULL) AS variants_with_evidence,
       (SELECT COUNT(*) FROM claim_variants v WHERE v.claim_id = c.claim_id)                 AS variant_count,
       (SELECT COUNT(*) FROM claim_variants v
         WHERE v.claim_id = c.claim_id
           AND (v.relation_predicate IS NOT NULL OR v.action IS NOT NULL))                    AS structured_variant_count,
       (SELECT COUNT(*) FROM claim_variants v
         WHERE v.claim_id = c.claim_id AND v.parent_variant_id IS NOT NULL)                  AS variants_with_parent,
       (SELECT COUNT(*) FROM claim_variants v
          JOIN claim_variants pv ON pv.variant_id = v.parent_variant_id
         WHERE v.claim_id = c.claim_id AND pv.claim_id = c.claim_id)                          AS claim_lineage_edges,
       (SELECT COUNT(*) FROM claim_mutations m WHERE m.claim_id = c.claim_id)                AS mutation_count,
       (SELECT COUNT(*) FROM source_references r
         WHERE r.from_source_id IN (SELECT v.source_id FROM claim_variants v WHERE v.claim_id = c.claim_id)) AS source_reference_count,
       (SELECT COUNT(*) FROM source_references r
         WHERE r.from_source_id IN (SELECT v.source_id FROM claim_variants v WHERE v.claim_id = c.claim_id)
           AND r.to_source_id   IN (SELECT v.source_id FROM claim_variants v WHERE v.claim_id = c.claim_id)) AS in_family_reference_count,
       (SELECT COUNT(DISTINCT v.source_id) FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
         WHERE v.claim_id = c.claim_id AND s.derived_from_source_id IS NOT NULL)              AS sources_with_known_upstream,
       (SELECT COUNT(*) FROM (SELECT r.from_source_id, r.to_source_id FROM source_references r
                              UNION
                              SELECT s.source_id, s.derived_from_source_id FROM sources s
                               WHERE s.derived_from_source_id IS NOT NULL) e
         WHERE e.from_source_id IN (SELECT v.source_id FROM claim_variants v WHERE v.claim_id = c.claim_id)) AS source_lineage_edges,
       calculate_echo_ratio(c.claim_id)                                                       AS known_echo_ratio,
       (SELECT COUNT(DISTINCT v.source_id) FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
         WHERE v.claim_id = c.claim_id AND s.published_at IS NOT NULL)                        AS dated_source_count
  FROM claims c
  LEFT JOIN claim_propositions p ON p.claim_id = c.claim_id;
