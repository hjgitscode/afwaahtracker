--------------------------------------------------------------------------------
-- AfwaahTracker :: 06_triggers.sql
-- Triggers: audit logging, timestamp maintenance, keyword normalisation,
-- ingestion bookkeeping and automatic Mutation Ledger generation.
--------------------------------------------------------------------------------
SET DEFINE OFF
PROMPT Creating triggers ...

-- Keep CLAIMS.updated_at current (BEFORE UPDATE row trigger)
CREATE OR REPLACE TRIGGER trg_claims_touch
BEFORE UPDATE ON claims
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

-- Audit trail for CLAIMS
CREATE OR REPLACE TRIGGER trg_claims_audit
AFTER INSERT OR UPDATE OR DELETE ON claims
FOR EACH ROW
BEGIN
    IF INSERTING THEN
        write_audit('CLAIMS', 'INSERT', :NEW.claim_id, 'Created: ' || :NEW.canonical_claim);
    ELSIF UPDATING THEN
        write_audit('CLAIMS', 'UPDATE', :NEW.claim_id,
            CASE WHEN :OLD.status <> :NEW.status
                 THEN 'Status ' || :OLD.status || ' -> ' || :NEW.status || '. ' END
            || 'Claim: ' || :NEW.canonical_claim);
    ELSE
        write_audit('CLAIMS', 'DELETE', :OLD.claim_id, 'Deleted: ' || :OLD.canonical_claim);
    END IF;
END;
/

-- Audit trail for SOURCES
CREATE OR REPLACE TRIGGER trg_sources_audit
AFTER INSERT OR UPDATE OR DELETE ON sources
FOR EACH ROW
BEGIN
    IF INSERTING THEN
        write_audit('SOURCES', 'INSERT', :NEW.source_id,
            :NEW.origin_type || ' source from ' || :NEW.publisher);
    ELSIF UPDATING THEN
        write_audit('SOURCES', 'UPDATE', :NEW.source_id, 'Updated source ' || :NEW.source_url);
    ELSE
        write_audit('SOURCES', 'DELETE', :OLD.source_id, 'Deleted source ' || :OLD.source_url);
    END IF;
END;
/

-- Audit trail for CLAIM_VARIANTS
CREATE OR REPLACE TRIGGER trg_variants_audit
AFTER INSERT OR UPDATE OR DELETE ON claim_variants
FOR EACH ROW
BEGIN
    IF INSERTING THEN
        write_audit('CLAIM_VARIANTS', 'INSERT', :NEW.variant_id,
            'Claim ' || :NEW.claim_id || ' via ' || :NEW.match_method
            || ' (score ' || :NEW.match_score || ')');
    ELSIF UPDATING THEN
        write_audit('CLAIM_VARIANTS', 'UPDATE', :NEW.variant_id, 'Claim ' || :NEW.claim_id);
    ELSE
        write_audit('CLAIM_VARIANTS', 'DELETE', :OLD.variant_id, 'Claim ' || :OLD.claim_id);
    END IF;
END;
/

-- Keywords are always stored trimmed and lower-case
CREATE OR REPLACE TRIGGER trg_keywords_normalise
BEFORE INSERT OR UPDATE OF keyword_text ON keywords
FOR EACH ROW
BEGIN
    :NEW.keyword_text := LOWER(TRIM(:NEW.keyword_text));
END;
/

-- When an ingestion run finishes, stamp the registry row
CREATE OR REPLACE TRIGGER trg_ingestion_log_complete
AFTER UPDATE OF status ON ingestion_log
FOR EACH ROW
WHEN (NEW.status <> 'RUNNING')
BEGIN
    UPDATE ingestion_sources
       SET last_fetched_at = NVL(:NEW.completed_at, SYSTIMESTAMP)
     WHERE ingestion_source_id = :NEW.ingestion_source_id;
END;
/

--------------------------------------------------------------------------------
-- Automatic Mutation Ledger generation.
-- A COMPOUND trigger is used to avoid the "mutating table" error: rows are
-- collected per row, and GENERATE_MUTATION_LEDGER (which reads
-- CLAIM_VARIANTS) is called once the statement has finished.
--------------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_variants_mutations
FOR INSERT OR UPDATE ON claim_variants
COMPOUND TRIGGER

    TYPE t_id_list IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
    g_child_ids   t_id_list;
    g_parent_ids  t_id_list;
    g_changed_ids t_id_list;

    BEFORE STATEMENT IS
    BEGIN
        g_child_ids.DELETE;
        g_parent_ids.DELETE;
        g_changed_ids.DELETE;
    END BEFORE STATEMENT;

    AFTER EACH ROW IS
    BEGIN
        g_child_ids(g_child_ids.COUNT + 1)   := :NEW.variant_id;
        g_parent_ids(g_parent_ids.COUNT + 1) := :NEW.parent_variant_id;
        IF UPDATING THEN
            g_changed_ids(g_changed_ids.COUNT + 1) := :NEW.variant_id;
        END IF;
    END AFTER EACH ROW;

    AFTER STATEMENT IS
    BEGIN
        FOR i IN 1 .. g_child_ids.COUNT LOOP
            IF g_parent_ids(i) IS NULL THEN
                -- Parent removed: drop stale ledger rows for this child
                DELETE FROM claim_mutations WHERE child_variant_id = g_child_ids(i);
            ELSE
                DELETE FROM claim_mutations
                 WHERE child_variant_id = g_child_ids(i)
                   AND parent_variant_id <> g_parent_ids(i);
                generate_mutation_ledger(g_parent_ids(i), g_child_ids(i));
            END IF;
        END LOOP;

        -- An edited variant may itself be a parent: refresh its children too
        FOR i IN 1 .. g_changed_ids.COUNT LOOP
            FOR c IN (SELECT variant_id FROM claim_variants
                       WHERE parent_variant_id = g_changed_ids(i)) LOOP
                generate_mutation_ledger(g_changed_ids(i), c.variant_id);
            END LOOP;
        END LOOP;

        g_child_ids.DELETE;
        g_parent_ids.DELETE;
        g_changed_ids.DELETE;
    END AFTER STATEMENT;

END trg_variants_mutations;
/

SHOW ERRORS
PROMPT Triggers created.
