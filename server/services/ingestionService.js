import { withConnection, query } from '../db/pool.js';
import { schedulerState } from '../ingestion/scheduler.js';
import { lastRefreshByType } from './dashboardService.js';

export async function getIngestionStatus() {
  return withConnection(async (db) => {
    const sources = await db.rows(
      `SELECT ingestion_source_id, source_name, source_type, endpoint_url, enabled,
              fetch_interval_minutes, max_items, last_fetched_at, platform_name, default_category,
              last_status, last_started_at, last_completed_at, last_fetched, last_inserted,
              last_skipped, last_matched, last_error, total_sources_ingested
         FROM vw_ingestion_status
        ORDER BY source_type, ingestion_source_id`
    );
    const recentRuns = await db.rows(
      `SELECT l.log_id, l.ingestion_source_id, i.source_name, i.source_type, l.started_at,
              l.completed_at, l.records_fetched, l.records_inserted, l.records_skipped,
              l.records_matched, l.status, l.error_message
         FROM ingestion_log l
         JOIN ingestion_sources i ON i.ingestion_source_id = l.ingestion_source_id
        ORDER BY l.started_at DESC, l.log_id DESC
        FETCH FIRST 25 ROWS ONLY`
    );
    const summary = await db.one(
      `SELECT (SELECT MAX(completed_at) FROM ingestion_log WHERE status <> 'RUNNING')       AS last_sync,
              (SELECT NVL(SUM(records_inserted), 0) FROM ingestion_log
                WHERE started_at >= SYSTIMESTAMP - INTERVAL '1' DAY)                        AS new_sources_24h,
              (SELECT NVL(SUM(records_skipped), 0) FROM ingestion_log
                WHERE started_at >= SYSTIMESTAMP - INTERVAL '1' DAY)                        AS skipped_24h,
              (SELECT COUNT(*) FROM ingestion_sources WHERE enabled = 'Y')                  AS active_feeds,
              (SELECT COUNT(*) FROM ingestion_sources)                                      AS total_feeds,
              (SELECT COUNT(*) FROM sources WHERE origin_type = 'AUTOMATED')                AS automated_sources,
              (SELECT COUNT(*) FROM ingestion_log)                                          AS total_runs
         FROM dual`
    );
    const lastRefresh = await lastRefreshByType(db);
    return { scheduler: schedulerState(), summary, lastRefresh, sources, recentRuns };
  });
}

/** Latest automatically ingested sources with their matched claim. */
export function getLiveFeed({ limit = 50, sourceType } = {}) {
  const binds = { limit: Math.min(Math.max(Number(limit) || 50, 1), 200) };
  let filter = '';
  if (['GDELT', 'HACKER_NEWS', 'RSS'].includes(sourceType)) {
    binds.source_type = sourceType;
    filter = 'AND i.source_type = :source_type';
  }
  return query(
    `SELECT s.source_id, s.publisher, s.author, s.source_title, s.source_url, s.linked_url,
            s.published_at, s.fetched_at, s.engagement_count, s.source_status,
            s.derived_from_source_id, p.platform_name, i.source_name AS feed_name, i.source_type,
            v.claim_id, c.canonical_claim, c.status AS claim_status,
            v.match_score, v.match_method, v.match_breakdown
       FROM sources s
       JOIN platforms p ON p.platform_id = s.platform_id
       LEFT JOIN ingestion_sources i ON i.ingestion_source_id = s.ingestion_source_id
       LEFT JOIN claim_variants v ON v.source_id = s.source_id
       LEFT JOIN claims c ON c.claim_id = v.claim_id
      WHERE s.origin_type = 'AUTOMATED' ${filter}
      ORDER BY s.fetched_at DESC, s.source_id DESC
      FETCH FIRST :limit ROWS ONLY`,
    binds
  );
}
