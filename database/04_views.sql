--------------------------------------------------------------------------------
-- AfwaahTracker :: 04_views.sql
-- Views used by the API and the dashboard.
--
-- Concepts: views, multi-table JOIN, LEFT JOIN, GROUP BY, aggregates
-- (COUNT/SUM/AVG/MIN/MAX), CASE expressions, analytic functions,
-- hierarchical queries (CONNECT BY), calling PL/SQL functions from SQL.
--------------------------------------------------------------------------------
SET DEFINE OFF
PROMPT Creating views ...

-- One row per variant, enriched with its source, platform and the
-- publisher of the known upstream source (self-join on SOURCES).
CREATE OR REPLACE VIEW vw_claim_sources AS
SELECT v.claim_id,
       v.variant_id,
       v.parent_variant_id,
       v.variant_text,
       v.certainty,
       v.match_score,
       v.match_method,
       s.source_id,
       s.publisher,
       s.author,
       s.source_title,
       s.source_url,
       s.linked_url,
       s.published_at,
       s.fetched_at,
       s.engagement_count,
       s.source_status,
       s.origin_type,
       s.derived_from_source_id,
       s.provenance_note,
       CASE WHEN s.derived_from_source_id IS NULL THEN 'INDEPENDENT' ELSE 'DERIVED' END AS dependency,
       parent.publisher  AS derived_from_publisher,
       parent.source_url AS derived_from_url,
       p.platform_id,
       p.platform_name,
       p.platform_type
  FROM claim_variants v
  JOIN sources        s      ON s.source_id = v.source_id
  JOIN platforms      p      ON p.platform_id = s.platform_id
  LEFT JOIN sources   parent ON parent.source_id = s.derived_from_source_id;

-- Claim-level overview with Echo Ratio.
-- Echo Ratio = derived sources / total sources * 100 (same formula as the
-- PL/SQL function CALCULATE_ECHO_RATIO, written inline so it can be
-- filtered and sorted efficiently). It measures source dependence, not truthfulness.
CREATE OR REPLACE VIEW vw_claim_overview AS
SELECT x.claim_id,
       x.canonical_claim,
       x.category_id,
       x.category,
       x.status,
       x.claim_origin,
       x.created_at,
       x.updated_at,
       x.first_seen,
       x.latest_seen,
       x.number_of_sources,
       x.number_of_platforms,
       x.number_of_variants,
       x.number_of_independent_origins,
       x.number_of_derived_sources,
       x.total_engagement,
       x.echo_ratio,
       echo_band(x.echo_ratio) AS echo_band
  FROM (
        SELECT c.claim_id,
               c.canonical_claim,
               c.category_id,
               cat.category_name                                   AS category,
               c.status,
               c.claim_origin,
               c.created_at,
               c.updated_at,
               MIN(s.published_at)                                 AS first_seen,
               MAX(s.published_at)                                 AS latest_seen,
               COUNT(DISTINCT s.source_id)                         AS number_of_sources,
               COUNT(DISTINCT s.platform_id)                       AS number_of_platforms,
               COUNT(DISTINCT v.variant_id)                        AS number_of_variants,
               COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NULL
                                   THEN s.source_id END)           AS number_of_independent_origins,
               COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NOT NULL
                                   THEN s.source_id END)           AS number_of_derived_sources,
               NVL(SUM(s.engagement_count), 0)                     AS total_engagement,
               CASE WHEN COUNT(DISTINCT s.source_id) = 0 THEN 0
                    ELSE ROUND(COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NOT NULL
                                                   THEN s.source_id END)
                               / COUNT(DISTINCT s.source_id) * 100, 1)
               END                                                 AS echo_ratio
          FROM claims c
          JOIN categories       cat ON cat.category_id = c.category_id
          LEFT JOIN claim_variants v ON v.claim_id = c.claim_id
          LEFT JOIN sources        s ON s.source_id = v.source_id
         GROUP BY c.claim_id, c.canonical_claim, c.category_id, cat.category_name,
                  c.status, c.claim_origin, c.created_at, c.updated_at
       ) x;

-- Per-platform statistics
CREATE OR REPLACE VIEW vw_platform_statistics AS
SELECT p.platform_id,
       p.platform_name,
       p.platform_type,
       COUNT(DISTINCT s.source_id)                                   AS source_count,
       COUNT(DISTINCT v.claim_id)                                    AS claim_count,
       COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NULL THEN s.source_id END)     AS independent_count,
       COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NOT NULL THEN s.source_id END) AS derived_count,
       ROUND(AVG(s.engagement_count), 0)                             AS avg_engagement,
       MIN(s.published_at)                                           AS first_published,
       MAX(s.published_at)                                           AS last_published
  FROM platforms p
  LEFT JOIN sources        s ON s.platform_id = p.platform_id
  LEFT JOIN claim_variants v ON v.source_id   = s.source_id
 GROUP BY p.platform_id, p.platform_name, p.platform_type;

-- Source provenance as a hierarchy (CONNECT BY). One row per source,
-- with its root (earliest known independent source), depth and path.
CREATE OR REPLACE VIEW vw_source_lineage AS
SELECT s.source_id,
       s.derived_from_source_id,
       CONNECT_BY_ROOT s.source_id          AS root_source_id,
       LEVEL                                AS lineage_depth,
       SYS_CONNECT_BY_PATH(s.source_id, '>') AS lineage_path,
       CONNECT_BY_ISLEAF                    AS is_leaf,
       s.publisher,
       s.source_title,
       s.source_url,
       s.published_at,
       s.origin_type,
       s.platform_id
  FROM sources s
 START WITH s.derived_from_source_id IS NULL
 CONNECT BY NOCYCLE PRIOR s.source_id = s.derived_from_source_id;

-- Most recently active claim families
CREATE OR REPLACE VIEW vw_recent_claims AS
SELECT claim_id, canonical_claim, category, status, claim_origin,
       first_seen, latest_seen, number_of_sources, number_of_platforms,
       echo_ratio, echo_band
  FROM vw_claim_overview
 WHERE number_of_sources > 0
 ORDER BY latest_seen DESC
 FETCH FIRST 20 ROWS ONLY;

-- Registry + most recent run for each ingestion source (analytic ROW_NUMBER)
CREATE OR REPLACE VIEW vw_ingestion_status AS
SELECT i.ingestion_source_id,
       i.source_name,
       i.source_type,
       i.endpoint_url,
       i.enabled,
       i.fetch_interval_minutes,
       i.max_items,
       i.last_fetched_at,
       p.platform_name,
       cat.category_name                         AS default_category,
       l.log_id                                  AS last_log_id,
       l.started_at                              AS last_started_at,
       l.completed_at                            AS last_completed_at,
       l.status                                  AS last_status,
       l.records_fetched                         AS last_fetched,
       l.records_inserted                        AS last_inserted,
       l.records_skipped                         AS last_skipped,
       l.records_matched                         AS last_matched,
       l.error_message                           AS last_error,
       (SELECT COUNT(*) FROM sources s
         WHERE s.ingestion_source_id = i.ingestion_source_id) AS total_sources_ingested
  FROM ingestion_sources i
  JOIN platforms  p   ON p.platform_id = i.platform_id
  JOIN categories cat ON cat.category_id = i.default_category_id
  LEFT JOIN (
        SELECT lg.*,
               ROW_NUMBER() OVER (PARTITION BY lg.ingestion_source_id
                                  ORDER BY lg.started_at DESC, lg.log_id DESC) AS rn
          FROM ingestion_log lg
       ) l ON l.ingestion_source_id = i.ingestion_source_id AND l.rn = 1;

PROMPT Views created.
