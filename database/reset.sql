--------------------------------------------------------------------------------
-- AfwaahTracker :: reset.sql
-- Drops every AfwaahTracker object owned by the current schema so that
-- install.sql can be re-run safely. Missing objects are ignored.
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON
SET FEEDBACK OFF
PROMPT Removing existing AfwaahTracker objects (if any) ...

DECLARE
    PROCEDURE drop_object (p_sql IN VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE p_sql;
    EXCEPTION
        WHEN OTHERS THEN
            -- ORA-00942 table/view does not exist, ORA-04043 object does not exist,
            -- ORA-04080 trigger does not exist
            IF SQLCODE NOT IN (-942, -4043, -4080) THEN
                RAISE;
            END IF;
    END drop_object;
BEGIN
    FOR v IN (SELECT column_value AS name FROM TABLE(sys.odcivarchar2list(
                'VW_RECENT_CLAIMS','VW_CLAIM_OVERVIEW','VW_CLAIM_SOURCES',
                'VW_PLATFORM_STATISTICS','VW_SOURCE_LINEAGE','VW_INGESTION_STATUS',
                'VW_WEB_SEARCH_RUNS','VW_SOURCE_REFERENCES','VW_CLAIM_INVESTIGATION','VW_CLAIM_EVIDENCE',
                'VW_CLAIM_NOVELTY_DIAGNOSTICS'))) LOOP
        drop_object('DROP VIEW ' || v.name);
    END LOOP;

    FOR p IN (SELECT column_value AS name FROM TABLE(sys.odcivarchar2list(
                'GENERATE_MUTATION_LEDGER','REBUILD_CLAIM_MUTATIONS','ADD_CLAIM_VARIANT',
                'WRITE_AUDIT','FINISH_INGESTION_RUN','LINK_CLAIM_ENTITY',
                'LINK_CLAIM_KEYWORD','RECORD_ENTITY_CANDIDATE','AFW_DDL','AFW_SWAP_CHECK','FINISH_WEB_SEARCH_RUN',
                'RECORD_SEARCH_RESULT_LINK','CHOOSE_VARIANT_PARENT','RELINK_CLAIM_LINEAGE',
                'CREATE_PROPOSITION_CLAIM','RECORD_SEARCH_CLAIM_MATCHES',
                'RECORD_RUN_STAGE','FINALISE_CLAIM_LINEAGE'))) LOOP
        drop_object('DROP PROCEDURE ' || p.name);
    END LOOP;

    FOR f IN (SELECT column_value AS name FROM TABLE(sys.odcivarchar2list(
                'CALCULATE_ECHO_RATIO','ECHO_BAND','CERTAINTY_RANK',
                'INGEST_SOURCE','START_INGESTION_RUN','FIND_SOURCE_ID','START_WEB_SEARCH_RUN',
                'RECORD_SOURCE_REFERENCE','WORDING_SIMILARITY','APPLY_SOURCE_DEPENDENCE',
                'NAME_KEY','RESOLVE_ENTITY','RECORD_EVIDENCE','RECORD_ATTRIBUTION_REFERENCE',
                'PUBLISHER_MATCHES','REFRESH_CLAIM_PROVENANCE','SUPERSEDE_LEGACY_VARIANTS'))) LOOP
        drop_object('DROP FUNCTION ' || f.name);
    END LOOP;

    -- Child tables first (CASCADE CONSTRAINTS also removes inbound foreign keys)
    FOR t IN (SELECT column_value AS name FROM TABLE(sys.odcivarchar2list(
                'SEARCH_RUN_STAGES','SEARCH_CLAIM_MATCHES','CLAIM_PROPOSITIONS','SEARCH_RESULT_LINKS','SOURCE_REFERENCES',
                'SOURCE_EVIDENCE','WEB_SEARCH_RUNS',
                'AUDIT_LOG','CLAIM_MUTATIONS','FINGERPRINTS','CLAIM_KEYWORDS','KEYWORDS',
                'ENTITY_CANDIDATES','CLAIM_ENTITIES','ENTITY_ALIASES','ENTITIES',
                'CLAIM_VARIANTS','CLAIMS','SOURCES','INGESTION_LOG',
                'INGESTION_SOURCES','CATEGORIES','PLATFORMS'))) LOOP
        drop_object('DROP TABLE ' || t.name || ' CASCADE CONSTRAINTS PURGE');
    END LOOP;
END;
/

SET FEEDBACK ON
PROMPT Reset complete.
