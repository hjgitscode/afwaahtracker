/**
 * Dashboard aggregates. Every number is computed by Oracle (views, GROUP BY,
 * COUNT/SUM/AVG); the frontend only renders them.
 */
import { withConnection } from '../db/pool.js';

export async function getDashboard() {
  return withConnection(async (db) => {
    const metrics = await db.one(
      `SELECT (SELECT COUNT(*) FROM claims)                                           AS total_claims,
              (SELECT COUNT(*) FROM claims WHERE status <> 'CANDIDATE')               AS curated_claims,
              (SELECT COUNT(*) FROM sources)                                          AS total_sources,
              (SELECT COUNT(*) FROM sources WHERE derived_from_source_id IS NULL)     AS independent_origins,
              (SELECT COUNT(*) FROM sources WHERE derived_from_source_id IS NOT NULL) AS derived_sources,
              (SELECT ROUND(AVG(echo_ratio), 1) FROM vw_claim_overview
                WHERE number_of_sources > 1)                                          AS average_echo_ratio,
              (SELECT COUNT(DISTINCT platform_id) FROM sources)                       AS platforms,
              (SELECT COUNT(*) FROM sources
                WHERE origin_type = 'AUTOMATED' AND fetched_at >= TRUNC(SYSTIMESTAMP)) AS ingested_today,
              (SELECT COUNT(*) FROM claim_mutations)                                  AS total_mutations,
              (SELECT COUNT(*) FROM claim_variants)                                   AS total_variants
         FROM dual`
    );

    const highEcho = await db.rows(
      `SELECT claim_id, canonical_claim, category, status, number_of_sources,
              number_of_derived_sources, echo_ratio, echo_band
         FROM vw_claim_overview
        WHERE number_of_sources >= 3
        ORDER BY echo_ratio DESC, number_of_sources DESC
        FETCH FIRST 5 ROWS ONLY`
    );

    const mostRepeated = await db.rows(
      `SELECT claim_id, canonical_claim, category, number_of_sources, number_of_variants,
              number_of_platforms, echo_ratio
         FROM vw_claim_overview
        ORDER BY number_of_sources DESC, number_of_platforms DESC
        FETCH FIRST 5 ROWS ONLY`
    );

    const platformDistribution = await db.rows(
      `SELECT platform_name, platform_type, source_count, independent_count, derived_count, avg_engagement
         FROM vw_platform_statistics
        WHERE source_count > 0
        ORDER BY source_count DESC`
    );

    const categoryDistribution = await db.rows(
      `SELECT category, COUNT(*) AS claims, SUM(number_of_sources) AS sources,
              ROUND(AVG(echo_ratio), 1) AS avg_echo
         FROM vw_claim_overview
        GROUP BY category
       HAVING COUNT(*) > 0
        ORDER BY claims DESC`
    );

    const recentClaims = await db.rows(
      `SELECT claim_id, canonical_claim, category, status, claim_origin, first_seen, latest_seen,
              number_of_sources, number_of_platforms, echo_ratio, echo_band
         FROM vw_recent_claims
        FETCH FIRST 6 ROWS ONLY`
    );

    // Ingestion activity for the last 14 days (one row per day and source type)
    const ingestionActivity = await db.rows(
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

    const lastRefresh = await lastRefreshByType(db);

    return {
      metrics,
      highEcho,
      mostRepeated,
      platformDistribution,
      categoryDistribution,
      recentClaims,
      ingestionActivity,
      lastRefresh,
    };
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
