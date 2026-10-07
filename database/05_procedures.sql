--------------------------------------------------------------------------------
-- AfwaahTracker :: 05_procedures.sql
-- PL/SQL functions and procedures.
--
--   CERTAINTY_RANK            function   ordinal scale for certainty wording
--   CALCULATE_ECHO_RATIO      function   derived sources / total sources * 100
--   ECHO_BAND                 function   textual band for an Echo Ratio
--   WRITE_AUDIT               procedure  shared audit writer used by triggers
--   GENERATE_MUTATION_LEDGER  procedure  structured diff of two variants
--   REBUILD_CLAIM_MUTATIONS   procedure  regenerate ledger for a whole claim
--   ADD_CLAIM_VARIANT         procedure  transactional variant insert
--
-- Concepts: PL/SQL functions & procedures, exception handling,
-- RAISE_APPLICATION_ERROR, SAVEPOINT / ROLLBACK TO SAVEPOINT, cursors.
--------------------------------------------------------------------------------
SET DEFINE OFF
PROMPT Creating PL/SQL functions and procedures ...

-- Ordinal scale used to detect certainty escalation.
CREATE OR REPLACE FUNCTION certainty_rank (p_certainty IN VARCHAR2)
RETURN NUMBER DETERMINISTIC
IS
BEGIN
    RETURN CASE UPPER(p_certainty)
             WHEN 'DENIED'     THEN 0
             WHEN 'UNSTATED'   THEN 1
             WHEN 'QUESTIONED' THEN 1
             WHEN 'POSSIBLE'   THEN 2
             WHEN 'EXPECTED'   THEN 3
             WHEN 'CONFIRMED'  THEN 4
             ELSE 1
           END;
END certainty_rank;
/

-- ECHO RATIO = derived sources / total sources * 100
-- "Derived" means the source has a known parent in SOURCES.derived_from_source_id.
-- Echo Ratio measures source dependence, not truthfulness.
CREATE OR REPLACE FUNCTION calculate_echo_ratio (p_claim_id IN NUMBER)
RETURN NUMBER
IS
    v_total    NUMBER := 0;
    v_derived  NUMBER := 0;
BEGIN
    SELECT COUNT(DISTINCT s.source_id),
           COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NOT NULL THEN s.source_id END)
      INTO v_total, v_derived
      FROM claim_variants v
      JOIN sources s ON s.source_id = v.source_id
     WHERE v.claim_id = p_claim_id;

    IF v_total = 0 THEN
        RETURN 0;
    END IF;

    RETURN ROUND(v_derived / v_total * 100, 1);
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END calculate_echo_ratio;
/

CREATE OR REPLACE FUNCTION echo_band (p_ratio IN NUMBER)
RETURN VARCHAR2 DETERMINISTIC
IS
BEGIN
    IF p_ratio IS NULL THEN
        RETURN 'UNKNOWN';
    ELSIF p_ratio <= 30 THEN
        RETURN 'MOSTLY INDEPENDENT SOURCING';
    ELSIF p_ratio <= 60 THEN
        RETURN 'MIXED SOURCING';
    ELSIF p_ratio <= 80 THEN
        RETURN 'HIGH REPETITION';
    ELSE
        RETURN 'VERY HIGH SOURCE DEPENDENCE';
    END IF;
END echo_band;
/

-- Shared audit writer (runs inside the caller's transaction so a ROLLBACK
-- also removes the audit row, keeping the trail consistent).
CREATE OR REPLACE PROCEDURE write_audit (
    p_table_name IN VARCHAR2,
    p_operation  IN VARCHAR2,
    p_record_id  IN NUMBER,
    p_details    IN VARCHAR2 DEFAULT NULL
)
IS
BEGIN
    INSERT INTO audit_log (table_name, operation, record_id, details)
    VALUES (p_table_name, p_operation, p_record_id, SUBSTR(p_details, 1, 1000));
END write_audit;
/

--------------------------------------------------------------------------------
-- MUTATION LEDGER
-- Compares the structured components of a parent and child variant and
-- writes one CLAIM_MUTATIONS row per difference. Idempotent: existing rows
-- for the same pair are replaced.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE generate_mutation_ledger (
    p_parent_variant_id IN NUMBER,
    p_child_variant_id  IN NUMBER
)
IS
    v_parent  claim_variants%ROWTYPE;
    v_child   claim_variants%ROWTYPE;

    -- Values are compared case- and whitespace-insensitively.
    FUNCTION norm (p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN LOWER(TRIM(REGEXP_REPLACE(p_value, '\s+', ' ')));
    END norm;

    FUNCTION pretty (p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN INITCAP(LOWER(p_value));
    END pretty;

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

        INSERT INTO claim_mutations
            (claim_id, parent_variant_id, child_variant_id,
             changed_component, old_value, new_value, is_escalation)
        VALUES
            (v_child.claim_id, v_parent.variant_id, v_child.variant_id,
             p_component, SUBSTR(p_old, 1, 200), SUBSTR(p_new, 1, 200), p_escalates);
    END record_change;
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
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20012,
            'Variant not found while generating mutation ledger ('
            || p_parent_variant_id || ' -> ' || p_child_variant_id || ').');
END generate_mutation_ledger;
/

-- Regenerates every parent/child pair in one claim (cursor FOR loop).
CREATE OR REPLACE PROCEDURE rebuild_claim_mutations (p_claim_id IN NUMBER)
IS
BEGIN
    DELETE FROM claim_mutations WHERE claim_id = p_claim_id;

    FOR r IN (SELECT variant_id, parent_variant_id
                FROM claim_variants
               WHERE claim_id = p_claim_id
                 AND parent_variant_id IS NOT NULL
               ORDER BY variant_id)
    LOOP
        generate_mutation_ledger(r.parent_variant_id, r.variant_id);
    END LOOP;
END rebuild_claim_mutations;
/

--------------------------------------------------------------------------------
-- ADD_CLAIM_VARIANT
-- Inserts a variant inside a savepoint. The compound trigger on
-- CLAIM_VARIANTS then calls GENERATE_MUTATION_LEDGER for the new pair.
-- The caller decides when to COMMIT.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE add_claim_variant (
    p_claim_id          IN  NUMBER,
    p_source_id         IN  NUMBER,
    p_parent_variant_id IN  NUMBER,
    p_variant_text      IN  VARCHAR2,
    p_actor             IN  VARCHAR2 DEFAULT NULL,
    p_action            IN  VARCHAR2 DEFAULT NULL,
    p_target_object     IN  VARCHAR2 DEFAULT NULL,
    p_location_name     IN  VARCHAR2 DEFAULT NULL,
    p_event_name        IN  VARCHAR2 DEFAULT NULL,
    p_claimed_date      IN  VARCHAR2 DEFAULT NULL,
    p_quantity_value    IN  VARCHAR2 DEFAULT NULL,
    p_certainty         IN  VARCHAR2 DEFAULT 'UNSTATED',
    p_attribution       IN  VARCHAR2 DEFAULT NULL,
    p_match_score       IN  NUMBER   DEFAULT 100,
    p_match_method      IN  VARCHAR2 DEFAULT 'MANUAL',
    p_lineage_basis     IN  VARCHAR2 DEFAULT 'MANUAL',
    p_match_breakdown   IN  VARCHAR2 DEFAULT NULL,
    o_variant_id        OUT NUMBER
)
IS
    v_parent_claim NUMBER;
BEGIN
    SAVEPOINT before_add_variant;

    IF p_parent_variant_id IS NOT NULL THEN
        SELECT claim_id INTO v_parent_claim
          FROM claim_variants
         WHERE variant_id = p_parent_variant_id;

        IF v_parent_claim <> p_claim_id THEN
            RAISE_APPLICATION_ERROR(-20020,
                'Parent variant belongs to a different claim.');
        END IF;
    END IF;

    INSERT INTO claim_variants
        (claim_id, source_id, parent_variant_id, variant_text,
         actor, action, target_object, location_name, event_name,
         claimed_date, quantity_value, certainty, attribution,
         match_score, match_method, lineage_basis, match_breakdown)
    VALUES
        (p_claim_id, p_source_id, p_parent_variant_id, p_variant_text,
         p_actor, p_action, p_target_object, p_location_name, p_event_name,
         p_claimed_date, p_quantity_value, NVL(UPPER(p_certainty), 'UNSTATED'), p_attribution,
         NVL(p_match_score, 100), NVL(p_match_method, 'MANUAL'),
         NVL(p_lineage_basis, 'MANUAL'), p_match_breakdown)
    RETURNING variant_id INTO o_variant_id;

    UPDATE claims SET updated_at = SYSTIMESTAMP WHERE claim_id = p_claim_id;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        ROLLBACK TO before_add_variant;
        RAISE_APPLICATION_ERROR(-20021, 'Parent variant does not exist.');
    WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK TO before_add_variant;
        RAISE_APPLICATION_ERROR(-20022, 'This source already has a variant for this claim.');
    WHEN OTHERS THEN
        ROLLBACK TO before_add_variant;
        RAISE;
END add_claim_variant;
/

SHOW ERRORS
PROMPT PL/SQL procedures created.
