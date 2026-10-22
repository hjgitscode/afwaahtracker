--------------------------------------------------------------------------------
-- AfwaahTracker :: install.sql
-- Creates the complete AfwaahTracker database in the CURRENT schema.
--
-- Run as the application user, from this directory:
--     sqlplus afwaah/afwaah@localhost:1521/FREEPDB1 @install.sql
--
-- Order matters:
--   reset      drop anything from a previous install
--   01 schema  tables
--   02         constraints (PK/FK/UNIQUE/CHECK)
--   07         indexes
--   05         functions and procedures (used by triggers and views)
--   06         triggers (the mutation trigger must exist before seeding)
--   03         demonstration seed data (one transaction)
--   09         ingestion support + ingestion source registry
--   04         views
--   10         live web investigation (also usable as a migration)
--   11         Tavily as the web search provider (also usable as a migration)
--   12         claim intelligence: evidence, propositions, search-claim matches
--   13         novelty pipeline: run stages, provenance/lineage/ledger finalisation, legacy merge
--------------------------------------------------------------------------------
SET ECHO OFF
SET VERIFY OFF
SET DEFINE OFF
SET SQLBLANKLINES ON
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

PROMPT ============================================================
PROMPT  AfwaahTracker database installation
PROMPT ============================================================

@@reset.sql
@@01_schema.sql
@@02_constraints.sql
@@07_indexes.sql
@@05_procedures.sql
@@06_triggers.sql
@@03_seed.sql
@@09_ingestion_support.sql
@@04_views.sql
@@10_web_investigation.sql
@@11_tavily_provider.sql
@@12_claim_intelligence.sql
@@13_novelty_pipeline.sql

PROMPT Recompiling dependent objects ...
BEGIN
    DBMS_UTILITY.COMPILE_SCHEMA(schema => USER, compile_all => FALSE);
END;
/

PROMPT
PROMPT Verifying installation ...
SET HEADING ON
SET PAGESIZE 50
SET LINESIZE 160
COLUMN object_type FORMAT A20
SELECT object_type, COUNT(*) AS objects,
       SUM(CASE WHEN status = 'VALID' THEN 1 ELSE 0 END) AS valid
  FROM user_objects
 WHERE object_type IN ('TABLE','VIEW','PROCEDURE','FUNCTION','TRIGGER','INDEX')
 GROUP BY object_type
 ORDER BY object_type;

SELECT (SELECT COUNT(*) FROM claims)          AS claims,
       (SELECT COUNT(*) FROM sources)         AS sources,
       (SELECT COUNT(*) FROM claim_variants)  AS variants,
       (SELECT COUNT(*) FROM claim_mutations) AS mutations,
       (SELECT COUNT(*) FROM entities)        AS entities,
       (SELECT COUNT(*) FROM keywords)        AS keywords
  FROM dual;

PROMPT ============================================================
PROMPT  Installation complete.
PROMPT ============================================================
WHENEVER SQLERROR CONTINUE
