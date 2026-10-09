/**
 * Home-page system overview. Every number is computed by Oracle; the
 * frontend only renders them.
 */
import { withConnection } from '../db/pool.js';
import { isWebSearchConfigured } from '../web-search/braveSearch.js';

export async function getDashboard() {
  return withConnection(async (db) => {
    const metrics = await db.one(
      `SELECT (SELECT COUNT(*) FROM claims)                                          AS total_claims,
              (SELECT COUNT(*) FROM sources)                                         AS total_sources,
              (SELECT COUNT(*) FROM sources WHERE origin_type <> 'DEMO')             AS live_sources,
              (SELECT COUNT(*) FROM sources WHERE origin_type = 'DEMO')              AS demo_sources,
              (SELECT COUNT(DISTINCT platform_id) FROM sources)                      AS platforms,
              (SELECT COUNT(*) FROM web_search_runs)                                 AS web_search_runs,
              (SELECT COUNT(*) FROM source_references)                               AS source_references,
              (SELECT COUNT(*) FROM claim_mutations)                                 AS total_mutations
         FROM dual`
    );
    const recentSearches = await db.rows(
      `SELECT search_run_id, query_text, started_at, status, results_received, claim_families
         FROM vw_web_search_runs
        WHERE status <> 'RUNNING'
        ORDER BY started_at DESC
        FETCH FIRST 5 ROWS ONLY`
    );
    return { metrics, recentSearches, webSearchAvailable: isWebSearchConfigured() };
  });
}

/** Most recent completed run of each source type, summed across feeds. */
export async function lastRefreshByType(db) {
  return db.rows(
    `SELECT i.source_type,
            COUNT(*)                AS feeds,
            MAX(l.completed_at)     AS completed_at,
            SUM(l.records_fetched)  AS fetched,
            SUM(l.records_inserted) AS inserted,
            SUM(l.records_skipped)  AS skipped,
            SUM(CASE WHEN l.status = 'FAILED' THEN 1 ELSE 0 END) AS failed
       FROM ingestion_sources i
       JOIN (SELECT lg.*, ROW_NUMBER() OVER (PARTITION BY lg.ingestion_source_id
                                             ORDER BY lg.started_at DESC, lg.log_id DESC) AS rn
               FROM ingestion_log lg
              WHERE lg.status <> 'RUNNING') l
         ON l.ingestion_source_id = i.ingestion_source_id AND l.rn = 1
      GROUP BY i.source_type
      ORDER BY i.source_type`
  );
}
