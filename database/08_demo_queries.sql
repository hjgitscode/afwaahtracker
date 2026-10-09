--------------------------------------------------------------------------------
-- AfwaahTracker :: 08_demo_queries.sql
-- 37 read-only demonstration queries. Each is labelled with the SQL concept
-- it demonstrates. Run after install.sql:
--     sqlplus afwaah/afwaah@localhost:1521/FREEPDB1 @08_demo_queries.sql
-- Substitution variables are not used; literal search terms are shown so the
-- script runs unattended. The application itself always uses bind variables.
--------------------------------------------------------------------------------
SET DEFINE OFF
SET PAGESIZE 60
SET LINESIZE 200
SET FEEDBACK ON
COLUMN canonical_claim   FORMAT A50
COLUMN publisher         FORMAT A38
COLUMN platform_name     FORMAT A18
COLUMN variant_text      FORMAT A55
COLUMN entity_name       FORMAT A28
COLUMN keyword_text      FORMAT A20
COLUMN category          FORMAT A14
COLUMN echo_band         FORMAT A30
COLUMN lineage_path      FORMAT A24
COLUMN changed_component FORMAT A12
COLUMN old_value         FORMAT A28
COLUMN new_value         FORMAT A28
COLUMN source_name       FORMAT A40
COLUMN source_url        FORMAT A70

PROMPT
PROMPT ===== Q1. Search by canonical claim (LIKE + LOWER, function-based index) =====
SELECT claim_id, canonical_claim, status
  FROM claims
 WHERE LOWER(canonical_claim) LIKE '%aakash%'
 ORDER BY claim_id;

PROMPT ===== Q2. Search by entity, including aliases (multi-table INNER JOIN + DISTINCT) =====
SELECT DISTINCT c.claim_id, c.canonical_claim, e.entity_name
  FROM claims c
  JOIN claim_entities ce ON ce.claim_id = c.claim_id
  JOIN entities e        ON e.entity_id = ce.entity_id
  JOIN entity_aliases a  ON a.entity_id = e.entity_id
 WHERE LOWER(a.alias_text) = LOWER('Vellore Institute of Technology')
 ORDER BY c.claim_id;

PROMPT ===== Q3. Search by keyword (M:N junction table JOIN) =====
SELECT c.claim_id, c.canonical_claim, k.keyword_text, ck.weight
  FROM claims c
  JOIN claim_keywords ck ON ck.claim_id = c.claim_id
  JOIN keywords k        ON k.keyword_id = ck.keyword_id
 WHERE k.keyword_text IN ('exams', 'board exams')
 ORDER BY c.claim_id;

PROMPT ===== Q4. Search by publisher (LIKE on function-based index) =====
SELECT source_id, publisher, source_title
  FROM sources
 WHERE LOWER(publisher) LIKE '%campus%'
 ORDER BY published_at;

PROMPT ===== Q5. Search by platform (INNER JOIN + WHERE) =====
SELECT s.source_id, p.platform_name, s.publisher, s.published_at
  FROM sources s
  JOIN platforms p ON p.platform_id = s.platform_id
 WHERE p.platform_name = 'WhatsApp Forward'
 ORDER BY s.published_at;

PROMPT ===== Q6. All sources for one claim (4-table JOIN incl. self-join via view) =====
SELECT publisher, platform_name, dependency, derived_from_publisher AS derived_from, published_at
  FROM vw_claim_sources
 WHERE claim_id = 1
 ORDER BY published_at;

PROMPT ===== Q7. Variant retrieval with structured components =====
SELECT variant_id, parent_variant_id AS parent, variant_text, action, event_name, certainty
  FROM claim_variants
 WHERE claim_id = 1
 ORDER BY variant_id;

PROMPT ===== Q8. Claim lineage: hierarchical query over CLAIM_VARIANTS.parent_variant_id =====
SELECT LPAD(' ', (LEVEL - 1) * 3) || variant_text AS variant_tree, LEVEL AS depth, certainty
  FROM claim_variants
 WHERE claim_id = 1
 START WITH parent_variant_id IS NULL
 CONNECT BY PRIOR variant_id = parent_variant_id
 ORDER SIBLINGS BY variant_id;

PROMPT ===== Q9. Source lineage: hierarchical view over SOURCES.derived_from_source_id =====
SELECT l.source_id, l.root_source_id, l.lineage_depth, l.lineage_path, l.publisher
  FROM vw_source_lineage l
 WHERE l.source_id IN (SELECT source_id FROM claim_variants WHERE claim_id = 4)
 ORDER BY l.lineage_path;

PROMPT ===== Q10. Most repeated claims (GROUP BY + COUNT + ORDER BY) =====
SELECT c.claim_id, c.canonical_claim, COUNT(v.variant_id) AS repetitions
  FROM claims c
  JOIN claim_variants v ON v.claim_id = c.claim_id
 GROUP BY c.claim_id, c.canonical_claim
 ORDER BY repetitions DESC, c.claim_id
 FETCH FIRST 5 ROWS ONLY;

PROMPT ===== Q11. Multi-platform claims (GROUP BY + HAVING) =====
SELECT v.claim_id, COUNT(DISTINCT s.platform_id) AS platforms
  FROM claim_variants v
  JOIN sources s ON s.source_id = v.source_id
 GROUP BY v.claim_id
HAVING COUNT(DISTINCT s.platform_id) >= 4
 ORDER BY platforms DESC;

PROMPT ===== Q12. Platform count per claim (view) =====
SELECT claim_id, canonical_claim, number_of_platforms
  FROM vw_claim_overview
 ORDER BY number_of_platforms DESC, claim_id;

PROMPT ===== Q13. Total source count (COUNT) and sources per origin type (GROUP BY) =====
SELECT COUNT(*) AS total_sources FROM sources;
SELECT origin_type, COUNT(*) AS sources FROM sources GROUP BY origin_type;

PROMPT ===== Q14. Independent origin count per claim (conditional aggregation) =====
SELECT v.claim_id,
       COUNT(CASE WHEN s.derived_from_source_id IS NULL THEN 1 END) AS independent_origins
  FROM claim_variants v
  JOIN sources s ON s.source_id = v.source_id
 GROUP BY v.claim_id
 ORDER BY v.claim_id;

PROMPT ===== Q15. Derived source count per claim (conditional aggregation) =====
SELECT v.claim_id,
       SUM(CASE WHEN s.derived_from_source_id IS NOT NULL THEN 1 ELSE 0 END) AS derived_sources
  FROM claim_variants v
  JOIN sources s ON s.source_id = v.source_id
 GROUP BY v.claim_id
 ORDER BY v.claim_id;

PROMPT ===== Q16. Echo Ratio via PL/SQL function called from SQL =====
SELECT claim_id, canonical_claim,
       calculate_echo_ratio(claim_id)            AS echo_ratio,
       echo_band(calculate_echo_ratio(claim_id)) AS echo_band
  FROM claims
 WHERE claim_id IN (1, 2, 5);

PROMPT ===== Q17. Highest Echo Ratio (view + ORDER BY + FETCH FIRST) =====
SELECT claim_id, canonical_claim, echo_ratio, echo_band
  FROM vw_claim_overview
 WHERE number_of_sources > 0
 ORDER BY echo_ratio DESC, number_of_sources DESC
 FETCH FIRST 5 ROWS ONLY;

PROMPT ===== Q18. Entity frequency across claims (LEFT JOIN keeps unused entities) =====
SELECT e.entity_name, e.entity_type, COUNT(ce.claim_id) AS claims
  FROM entities e
  LEFT JOIN claim_entities ce ON ce.entity_id = e.entity_id
 GROUP BY e.entity_name, e.entity_type
 ORDER BY claims DESC, e.entity_name
 FETCH FIRST 10 ROWS ONLY;

PROMPT ===== Q19. Average / min / max engagement per platform (AVG, MIN, MAX) =====
SELECT p.platform_name,
       ROUND(AVG(s.engagement_count)) AS avg_engagement,
       MIN(s.engagement_count)        AS min_engagement,
       MAX(s.engagement_count)        AS max_engagement
  FROM platforms p
  JOIN sources s ON s.platform_id = p.platform_id
 GROUP BY p.platform_name
 ORDER BY avg_engagement DESC;

PROMPT ===== Q20. Recent claims (view with ORDER BY / FETCH FIRST) =====
SELECT claim_id, canonical_claim, latest_seen FROM vw_recent_claims FETCH FIRST 5 ROWS ONLY;

PROMPT ===== Q21. Categories with more than 5 sources and their total engagement (GROUP BY + HAVING + SUM) =====
SELECT cat.category_name AS category, COUNT(DISTINCT s.source_id) AS sources,
       SUM(s.engagement_count) AS total_engagement
  FROM categories cat
  JOIN claims c         ON c.category_id = cat.category_id
  JOIN claim_variants v ON v.claim_id = c.claim_id
  JOIN sources s        ON s.source_id = v.source_id
 GROUP BY cat.category_name
HAVING COUNT(DISTINCT s.source_id) > 5
 ORDER BY sources DESC;

PROMPT ===== Q22. Nested query: claims whose Echo Ratio is above the average Echo Ratio =====
SELECT claim_id, canonical_claim, echo_ratio
  FROM vw_claim_overview
 WHERE echo_ratio > (SELECT AVG(echo_ratio) FROM vw_claim_overview WHERE number_of_sources > 0)
 ORDER BY echo_ratio DESC;

PROMPT ===== Q23. Correlated subquery: earliest known source of each claim =====
SELECT v.claim_id, s.publisher, s.published_at
  FROM claim_variants v
  JOIN sources s ON s.source_id = v.source_id
 WHERE s.published_at = (SELECT MIN(s2.published_at)
                           FROM claim_variants v2
                           JOIN sources s2 ON s2.source_id = v2.source_id
                          WHERE v2.claim_id = v.claim_id)
 ORDER BY v.claim_id;

PROMPT ===== Q24. Multi-table JOIN: variant -> source -> platform -> claim -> category =====
SELECT c.canonical_claim, cat.category_name AS category, p.platform_name, v.variant_text
  FROM claim_variants v
  JOIN claims c       ON c.claim_id = v.claim_id
  JOIN categories cat ON cat.category_id = c.category_id
  JOIN sources s      ON s.source_id = v.source_id
  JOIN platforms p    ON p.platform_id = s.platform_id
 WHERE c.claim_id = 6
 ORDER BY s.published_at;

PROMPT ===== Q25. Mutation Ledger for the flagship claim (JOIN mutations to both variants) =====
SELECT ps.publisher AS from_source, cs.publisher AS to_source,
       m.changed_component, NVL(m.old_value, '(none)') AS old_value,
       NVL(m.new_value, '(none)') AS new_value, m.is_escalation
  FROM claim_mutations m
  JOIN claim_variants pv ON pv.variant_id = m.parent_variant_id
  JOIN claim_variants cv ON cv.variant_id = m.child_variant_id
  JOIN sources ps        ON ps.source_id = pv.source_id
  JOIN sources cs        ON cs.source_id = cv.source_id
 WHERE m.claim_id = 1
 ORDER BY m.child_variant_id, m.mutation_id;

PROMPT ===== Q26. Most frequently mutated components (GROUP BY on the ledger) =====
SELECT changed_component, COUNT(*) AS changes,
       SUM(CASE WHEN is_escalation = 'Y' THEN 1 ELSE 0 END) AS escalations
  FROM claim_mutations
 GROUP BY changed_component
 ORDER BY changes DESC;

PROMPT ===== Q27. Dashboard statistics (scalar subqueries) =====
SELECT (SELECT COUNT(*) FROM claims)                                          AS total_claims,
       (SELECT COUNT(*) FROM sources)                                         AS total_sources,
       (SELECT COUNT(*) FROM sources WHERE derived_from_source_id IS NULL)    AS independent_origins,
       (SELECT ROUND(AVG(echo_ratio), 1) FROM vw_claim_overview
         WHERE number_of_sources > 0)                                         AS avg_echo_ratio,
       (SELECT COUNT(*) FROM platforms)                                       AS platforms,
       (SELECT COUNT(*) FROM sources WHERE origin_type = 'AUTOMATED'
           AND fetched_at >= TRUNC(SYSTIMESTAMP))                             AS ingested_today
  FROM dual;

PROMPT ===== Q28. Ingestion statistics per source type (LEFT JOIN + GROUP BY + NVL) =====
SELECT i.source_type,
       COUNT(DISTINCT i.ingestion_source_id) AS feeds,
       COUNT(l.log_id)                       AS runs,
       NVL(SUM(l.records_fetched), 0)        AS fetched,
       NVL(SUM(l.records_inserted), 0)       AS inserted,
       NVL(SUM(l.records_skipped), 0)        AS skipped_duplicates
  FROM ingestion_sources i
  LEFT JOIN ingestion_log l ON l.ingestion_source_id = i.ingestion_source_id
 GROUP BY i.source_type
 ORDER BY i.source_type;

PROMPT ===== Q29. Deduplication lookup: is this URL already stored? (unique-index lookup + EXISTS) =====
SELECT CASE WHEN EXISTS (SELECT 1 FROM sources
                          WHERE source_url = 'https://x.example/campusinsider_demo/status/1001')
            THEN 'DUPLICATE - would be skipped'
            ELSE 'NEW - would be inserted'
       END AS dedup_result
  FROM dual;

PROMPT ===== Q30. Platform statistics view =====
SELECT platform_name, source_count, claim_count, independent_count, derived_count, avg_engagement
  FROM vw_platform_statistics
 ORDER BY source_count DESC;

PROMPT ===== Q31. Transaction demo: SAVEPOINT / ROLLBACK leaves data unchanged =====
SAVEPOINT demo_start;
UPDATE claims SET status = 'CORROBORATED' WHERE claim_id = 1;
SELECT claim_id, status FROM claims WHERE claim_id = 1;
ROLLBACK TO demo_start;
SELECT claim_id, status FROM claims WHERE claim_id = 1;
ROLLBACK;

PROMPT ===== Q32. Audit trail written by triggers (most recent 10 rows) =====
SELECT table_name, operation, record_id, changed_at
  FROM audit_log
 ORDER BY audit_id DESC
 FETCH FIRST 10 ROWS ONLY;

PROMPT ===== Q33. Live web search runs and what each stored (view over WEB_SEARCH_RUNS) =====
SELECT search_run_id, SUBSTR(query_text, 1, 40) AS query_text, status,
       results_received, sources_inserted, duplicates_skipped, pages_failed, claim_families
  FROM vw_web_search_runs
 ORDER BY started_at DESC
 FETCH FIRST 10 ROWS ONLY;

PROMPT ===== Q34. Sources returned by one search run, in search rank order (M:N junction) =====
SELECT l.search_rank, s.publisher, p.platform_name, l.was_duplicate,
       NVL(TO_CHAR(s.published_at, 'YYYY-MM-DD'), 'Not determined') AS published
  FROM search_result_links l
  JOIN sources   s ON s.source_id = l.source_id
  JOIN platforms p ON p.platform_id = s.platform_id
 WHERE l.search_run_id = (SELECT MAX(search_run_id) FROM web_search_runs)
 ORDER BY l.search_rank;

PROMPT ===== Q35. Explicit evidence between sources and whether it set source dependence =====
SELECT reference_type, SUBSTR(from_publisher, 1, 30) AS from_source,
       SUBSTR(to_publisher, 1, 30) AS to_source, sets_dependence
  FROM vw_source_references
 ORDER BY detected_at DESC
 FETCH FIRST 15 ROWS ONLY;

PROMPT ===== Q36. How each wording parent was chosen (GROUP BY lineage_basis) =====
SELECT lineage_basis, COUNT(*) AS variants,
       SUM(CASE WHEN parent_variant_id IS NULL THEN 1 ELSE 0 END) AS without_parent
  FROM claim_variants
 GROUP BY lineage_basis
 ORDER BY variants DESC;

PROMPT ===== Q37. Deterministic wording similarity (PL/SQL function used for inferred predecessors) =====
SELECT wording_similarity('Aakash Gupta may visit VIT', 'Aakash Gupta will perform at VIT Vibrance') AS similar_pair,
       wording_similarity('Aakash Gupta may visit VIT', 'Exam results postponed by the board')    AS unrelated_pair
  FROM dual;
