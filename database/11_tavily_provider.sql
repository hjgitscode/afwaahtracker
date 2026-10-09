--------------------------------------------------------------------------------
-- AfwaahTracker :: 11_tavily_provider.sql
-- Live web search provider switched to Tavily. Safe to run more than once.
--
--   * WEB_SEARCH_RUNS.search_provider and SEARCH_RESULT_LINKS.search_provider
--     default to 'TAVILY' for new rows (the application always passes the
--     provider name explicitly as well).
--   * START_WEB_SEARCH_RUN / RECORD_SEARCH_RESULT_LINK default to 'TAVILY'.
--   * No table is dropped and no existing row is changed: earlier runs keep
--     the provider name they were recorded with. There is no CHECK constraint
--     on search_provider, so none needs to change.
--------------------------------------------------------------------------------
SET DEFINE OFF
PROMPT Switching the web search provider default to TAVILY ...

ALTER TABLE web_search_runs     MODIFY (search_provider DEFAULT 'TAVILY');
ALTER TABLE search_result_links MODIFY (search_provider DEFAULT 'TAVILY');

CREATE OR REPLACE FUNCTION start_web_search_run (
    p_query    IN VARCHAR2,
    p_provider IN VARCHAR2 DEFAULT 'TAVILY'
) RETURN NUMBER
IS
    v_id NUMBER;
BEGIN
    INSERT INTO web_search_runs (query_text, search_provider, status)
    VALUES (SUBSTR(TRIM(p_query), 1, 400), NVL(p_provider, 'TAVILY'), 'RUNNING')
    RETURNING search_run_id INTO v_id;
    RETURN v_id;
END start_web_search_run;
/
CREATE OR REPLACE PROCEDURE record_search_result_link (
    p_run_id     IN NUMBER,
    p_source_id  IN NUMBER,
    p_rank       IN NUMBER,
    p_provider   IN VARCHAR2,
    p_snippet    IN VARCHAR2,
    p_duplicate  IN CHAR DEFAULT 'N'
)
IS
BEGIN
    MERGE INTO search_result_links l
    USING (SELECT p_run_id AS search_run_id, p_source_id AS source_id FROM dual) src
       ON (l.search_run_id = src.search_run_id AND l.source_id = src.source_id)
     WHEN MATCHED THEN
          UPDATE SET l.search_rank = LEAST(l.search_rank, p_rank)
     WHEN NOT MATCHED THEN
          INSERT (search_run_id, source_id, search_rank, search_provider, result_snippet, was_duplicate)
          VALUES (p_run_id, p_source_id, GREATEST(NVL(p_rank, 1), 1), NVL(p_provider, 'TAVILY'),
                  SUBSTR(p_snippet, 1, 1000), NVL(p_duplicate, 'N'));
END record_search_result_link;
/

SHOW ERRORS
PROMPT Web search provider is TAVILY.
