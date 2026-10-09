import config from '../config/index.js';
import { withConnection } from '../db/pool.js';
import { adminEnabled } from '../middleware/security.js';
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
    // New sources per day and feed type over the last two weeks
    const activity = await db.rows(
      `SELECT TO_CHAR(TRUNC(l.started_at), 'YYYY-MM-DD') AS day,
              i.source_type,
              SUM(l.records_fetched)  AS fetched,
              SUM(l.records_inserted) AS inserted,
              SUM(l.records_skipped)  AS skipped,
              COUNT(*)                AS runs
         FROM ingestion_log l
         JOIN ingestion_sources i ON i.ingestion_source_id = l.ingestion_source_id
        WHERE l.started_at >= TRUNC(SYSTIMESTAMP) - 13
        GROUP BY TRUNC(l.started_at), i.source_type
        ORDER BY day, i.source_type`
    );
    // adminControls tells the Lab whether to show SYNC FEEDS to this visitor
    return { scheduler: schedulerState(), summary, lastRefresh, sources, recentRuns, activity, adminControls: adminEnabled() && !config.adminToken };
  });
}
