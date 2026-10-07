/**
 * Database Lab: read-only introspection of the schema (USER_* data
 * dictionary views) and a fixed whitelist of example queries.
 * There is deliberately NO way to execute arbitrary SQL.
 */
import { withConnection } from '../db/pool.js';
import { NotFoundError } from '../middleware/errors.js';

const TABLES = ['PLATFORMS', 'CATEGORIES', 'INGESTION_SOURCES', 'INGESTION_LOG', 'SOURCES', 'CLAIMS',
  'CLAIM_VARIANTS', 'ENTITIES', 'ENTITY_ALIASES', 'CLAIM_ENTITIES', 'ENTITY_CANDIDATES', 'KEYWORDS',
  'CLAIM_KEYWORDS', 'FINGERPRINTS', 'CLAIM_MUTATIONS', 'AUDIT_LOG'];

export const EXAMPLE_QUERIES = [
  {
    key: 'echo-ratio',
    title: 'Echo Ratio per claim',
    concept: 'View + PL/SQL function + ORDER BY',
    sql: `SELECT claim_id, canonical_claim, number_of_sources,
       number_of_derived_sources, echo_ratio, echo_band
  FROM vw_claim_overview
 WHERE number_of_sources > 0
 ORDER BY echo_ratio DESC
 FETCH FIRST 8 ROWS ONLY`,
  },
  {
    key: 'mutation-ledger',
    title: 'Mutation Ledger for the flagship demo claim',
    concept: 'Multi-table JOIN (mutation -> variants -> sources)',
    sql: `SELECT ps.publisher AS from_source, cs.publisher AS to_source,
       m.changed_component, m.old_value, m.new_value
  FROM claim_mutations m
  JOIN claim_variants pv ON pv.variant_id = m.parent_variant_id
  JOIN claim_variants cv ON cv.variant_id = m.child_variant_id
  JOIN sources ps ON ps.source_id = pv.source_id
  JOIN sources cs ON cs.source_id = cv.source_id
 WHERE m.claim_id = 1
 ORDER BY m.child_variant_id, m.mutation_id`,
  },
  {
    key: 'source-lineage',
    title: 'Source lineage as a hierarchy',
    concept: 'Hierarchical query (CONNECT BY) over a self-referencing FK',
    sql: `SELECT LPAD(' ', (LEVEL - 1) * 2) || publisher AS lineage,
       LEVEL AS depth, SYS_CONNECT_BY_PATH(source_id, '>') AS path
  FROM sources
 START WITH source_id = 20
CONNECT BY PRIOR source_id = derived_from_source_id`,
  },
  {
    key: 'multi-platform',
    title: 'Claims seen on four or more platforms',
    concept: 'GROUP BY + HAVING + COUNT(DISTINCT)',
    sql: `SELECT c.claim_id, c.canonical_claim,
       COUNT(DISTINCT s.platform_id) AS platforms
  FROM claims c
  JOIN claim_variants v ON v.claim_id = c.claim_id
  JOIN sources s ON s.source_id = v.source_id
 GROUP BY c.claim_id, c.canonical_claim
HAVING COUNT(DISTINCT s.platform_id) >= 4
 ORDER BY platforms DESC`,
  },
  {
    key: 'above-average-echo',
    title: 'Claims above the average Echo Ratio',
    concept: 'Nested subquery',
    sql: `SELECT claim_id, canonical_claim, echo_ratio
  FROM vw_claim_overview
 WHERE echo_ratio > (SELECT AVG(echo_ratio)
                       FROM vw_claim_overview
                      WHERE number_of_sources > 0)
 ORDER BY echo_ratio DESC`,
  },
  {
    key: 'platform-engagement',
    title: 'Engagement by platform',
    concept: 'AVG / MIN / MAX aggregates',
    sql: `SELECT p.platform_name,
       COUNT(*) AS sources,
       ROUND(AVG(s.engagement_count)) AS avg_engagement,
       MAX(s.engagement_count) AS max_engagement
  FROM platforms p
  JOIN sources s ON s.platform_id = p.platform_id
 GROUP BY p.platform_name
 ORDER BY avg_engagement DESC`,
  },
  {
    key: 'ingestion-stats',
    title: 'Ingestion statistics by source type',
    concept: 'LEFT JOIN + GROUP BY + NVL',
    sql: `SELECT i.source_type,
       COUNT(DISTINCT i.ingestion_source_id) AS feeds,
       COUNT(l.log_id) AS runs,
       NVL(SUM(l.records_inserted), 0) AS inserted,
       NVL(SUM(l.records_skipped), 0) AS duplicates_skipped
  FROM ingestion_sources i
  LEFT JOIN ingestion_log l
    ON l.ingestion_source_id = i.ingestion_source_id
 GROUP BY i.source_type`,
  },
  {
    key: 'audit-trail',
    title: 'Latest audit trail entries',
    concept: 'Rows written by AFTER INSERT/UPDATE/DELETE triggers',
    sql: `SELECT table_name, operation, record_id,
       TO_CHAR(changed_at, 'YYYY-MM-DD HH24:MI') AS changed_at, details
  FROM audit_log
 ORDER BY audit_id DESC
 FETCH FIRST 8 ROWS ONLY`,
  },
];

export async function getLabOverview() {
  return withConnection(async (db) => {
    const objects = await db.rows(
      `SELECT object_type, COUNT(*) AS total,
              SUM(CASE WHEN status = 'VALID' THEN 1 ELSE 0 END) AS valid
         FROM user_objects
        WHERE object_type IN ('TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'INDEX')
          AND object_name NOT LIKE 'SYS\\_%' ESCAPE '\\'
          AND object_name NOT LIKE 'BIN$%'
        GROUP BY object_type`
    );
    const constraints = await db.rows(
      `SELECT DECODE(constraint_type, 'P', 'PRIMARY KEY', 'R', 'FOREIGN KEY', 'U', 'UNIQUE',
                     'C', 'CHECK / NOT NULL', constraint_type) AS constraint_type,
              COUNT(*) AS total
         FROM user_constraints
        WHERE constraint_type IN ('P', 'R', 'U', 'C')
          AND table_name NOT LIKE 'BIN$%'
        GROUP BY constraint_type
        ORDER BY total DESC`
    );
    const relationships = await db.rows(
      `SELECT c.table_name AS child_table, cc.column_name AS child_column,
              p.table_name AS parent_table, c.delete_rule,
              CASE WHEN c.table_name = p.table_name THEN 'Y' ELSE 'N' END AS self_reference
         FROM user_constraints c
         JOIN user_constraints p        ON p.constraint_name = c.r_constraint_name
         JOIN user_cons_columns cc      ON cc.constraint_name = c.constraint_name
        WHERE c.constraint_type = 'R'
        ORDER BY c.table_name, cc.column_name`
    );
    const programUnits = await db.rows(
      `SELECT object_name, object_type, status
         FROM user_objects
        WHERE object_type IN ('PROCEDURE', 'FUNCTION', 'TRIGGER')
        ORDER BY object_type, object_name`
    );
    const views = await db.rows(`SELECT view_name FROM user_views ORDER BY view_name`);
    const indexes = await db.rows(
      `SELECT index_name, table_name, index_type, uniqueness
         FROM user_indexes
        WHERE index_name NOT LIKE 'SYS\\_%' ESCAPE '\\'
        ORDER BY table_name, index_name`
    );
    const columns = await db.rows(
      `SELECT table_name, COUNT(*) AS columns
         FROM user_tab_columns
        WHERE table_name IN (${TABLES.map((_, i) => `:t${i}`).join(', ')})
        GROUP BY table_name`,
      Object.fromEntries(TABLES.map((t, i) => [`t${i}`, t]))
    );

    // Row counts: one fixed statement, no dynamic table names
    const counts = await db.one(
      `SELECT ${TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(',\n              ')} FROM dual`
    );
    const columnMap = Object.fromEntries(columns.map((c) => [c.table_name, c.columns]));
    const tables = TABLES.map((t) => ({ table_name: t, rows: counts[t.toLowerCase()], columns: columnMap[t] || 0 }));

    const version = await db.one(`SELECT banner_full AS banner FROM v$version WHERE ROWNUM = 1`).catch(() => null);

    return {
      database: version?.banner || 'Oracle Database',
      objects,
      constraints,
      relationships,
      programUnits,
      views: views.map((v) => v.view_name),
      indexes,
      tables,
      queries: EXAMPLE_QUERIES.map(({ key, title, concept, sql }) => ({ key, title, concept, sql })),
    };
  });
}

export async function runExampleQuery(key) {
  const q = EXAMPLE_QUERIES.find((x) => x.key === key);
  if (!q) throw new NotFoundError('Unknown example query.');
  return withConnection(async (db) => {
    const started = Date.now();
    const result = await db.exec(q.sql, {}, { maxRows: 50 });
    return {
      key: q.key,
      columns: (result.metaData || []).map((m) => m.name.toLowerCase()),
      rows: (result.rows || []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v]))),
      elapsedMs: Date.now() - started,
    };
  });
}
