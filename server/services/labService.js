/**
 * Database Lab: read-only introspection of the schema (USER_* data
 * dictionary views) and a fixed whitelist of example queries.
 * There is deliberately NO way to execute arbitrary SQL.
 */
import { withConnection } from '../db/pool.js';
import { NotFoundError } from '../middleware/errors.js';

const TABLES = ['PLATFORMS', 'CATEGORIES', 'INGESTION_SOURCES', 'INGESTION_LOG', 'SOURCES', 'CLAIMS',
  'CLAIM_VARIANTS', 'ENTITIES', 'ENTITY_ALIASES', 'CLAIM_ENTITIES', 'ENTITY_CANDIDATES', 'KEYWORDS',
  'CLAIM_KEYWORDS', 'FINGERPRINTS', 'CLAIM_MUTATIONS', 'AUDIT_LOG', 'WEB_SEARCH_RUNS',
  'SEARCH_RESULT_LINKS', 'SOURCE_REFERENCES', 'SOURCE_EVIDENCE', 'CLAIM_PROPOSITIONS', 'SEARCH_CLAIM_MATCHES'];

// Live data first (DEMO rows sort last), so each example shows what the
// latest investigations actually produced.
export const EXAMPLE_QUERIES = [
  {
    key: 'claim-evidence-join',
    title: 'Claims, their sources and the exact evidence',
    concept: 'INNER JOIN + LEFT JOIN across four tables',
    sql: `SELECT c.claim_id, c.canonical_claim, s.publisher,
       e.sentence_text AS evidence, e.extraction_method
  FROM claims c
  JOIN claim_variants v       ON v.claim_id = c.claim_id
  JOIN sources s              ON s.source_id = v.source_id
  LEFT JOIN source_evidence e ON e.evidence_id = v.evidence_id
 ORDER BY CASE c.claim_origin WHEN 'DEMO' THEN 1 ELSE 0 END,
          c.claim_id DESC, s.published_at NULLS LAST
 FETCH FIRST 12 ROWS ONLY`,
  },
  {
    key: 'source-counts',
    title: 'Claim families repeated by two or more sources',
    concept: 'GROUP BY + COUNT(DISTINCT) + HAVING',
    sql: `SELECT c.claim_id, c.canonical_claim,
       COUNT(DISTINCT v.source_id)  AS sources,
       COUNT(DISTINCT s.platform_id) AS platforms,
       COUNT(DISTINCT v.evidence_id) AS evidence
  FROM claims c
  JOIN claim_variants v ON v.claim_id = c.claim_id
  JOIN sources s        ON s.source_id = v.source_id
 GROUP BY c.claim_id, c.canonical_claim
HAVING COUNT(DISTINCT v.source_id) >= 2
 ORDER BY sources DESC, c.claim_id DESC
 FETCH FIRST 10 ROWS ONLY`,
  },
  {
    key: 'chronology',
    title: 'Earliest and latest known source per claim family',
    concept: 'MIN / MAX aggregates',
    sql: `SELECT c.claim_id, c.canonical_claim,
       TO_CHAR(MIN(s.published_at), 'YYYY-MM-DD') AS earliest_known,
       TO_CHAR(MAX(s.published_at), 'YYYY-MM-DD') AS latest_known,
       SUM(CASE WHEN s.published_at IS NULL THEN 1 ELSE 0 END) AS undated
  FROM claims c
  JOIN claim_variants v ON v.claim_id = c.claim_id
  JOIN sources s        ON s.source_id = v.source_id
 GROUP BY c.claim_id, c.canonical_claim
 ORDER BY MAX(s.published_at) DESC NULLS LAST
 FETCH FIRST 10 ROWS ONLY`,
  },
  {
    key: 'echo-ratio',
    title: 'Known Echo Ratio per claim family',
    concept: 'View + PL/SQL function',
    sql: `SELECT claim_id, canonical_claim, source_count,
       known_upstream_count, known_echo_ratio,
       calculate_echo_ratio(claim_id) AS echo_plsql
  FROM vw_claim_investigation
 WHERE source_count > 0
 ORDER BY CASE claim_origin WHEN 'DEMO' THEN 1 ELSE 0 END,
          known_echo_ratio DESC, source_count DESC
 FETCH FIRST 10 ROWS ONLY`,
  },
  {
    key: 'claim-lineage',
    title: 'Claim lineage of the most connected family',
    concept: 'Hierarchical query (CONNECT BY) on a self-referencing FK',
    sql: `SELECT LPAD(' ', (LEVEL - 1) * 2) || s.publisher AS lineage,
       v.lineage_basis, v.certainty, LEVEL AS depth
  FROM claim_variants v
  JOIN sources s ON s.source_id = v.source_id
 WHERE v.claim_id = (SELECT claim_id FROM claim_variants
                      WHERE parent_variant_id IS NOT NULL
                      GROUP BY claim_id
                      ORDER BY COUNT(*) DESC, claim_id DESC
                      FETCH FIRST 1 ROWS ONLY)
 START WITH v.parent_variant_id IS NULL
CONNECT BY PRIOR v.variant_id = v.parent_variant_id
 ORDER SIBLINGS BY s.published_at`,
  },
  {
    key: 'source-lineage',
    title: 'Source provenance: explicit references',
    concept: 'Self-join of SOURCES through SOURCE_REFERENCES',
    sql: `SELECT f.publisher AS source, r.reference_type,
       t.publisher AS refers_to,
       CASE WHEN f.derived_from_source_id = t.source_id
            THEN 'KNOWN DERIVED' ELSE '-' END AS dependency
  FROM source_references r
  JOIN sources f ON f.source_id = r.from_source_id
  JOIN sources t ON t.source_id = r.to_source_id
 ORDER BY r.detected_at DESC
 FETCH FIRST 10 ROWS ONLY`,
  },
  {
    key: 'mutation-ledger',
    title: 'Mutation Ledger of the latest family with changes',
    concept: 'Trigger-generated rows + multi-table JOIN',
    sql: `SELECT ps.publisher AS from_source, cs.publisher AS to_source,
       m.changed_component, m.old_value, m.new_value, m.is_escalation
  FROM claim_mutations m
  JOIN claim_variants pv ON pv.variant_id = m.parent_variant_id
  JOIN claim_variants cv ON cv.variant_id = m.child_variant_id
  JOIN sources ps ON ps.source_id = pv.source_id
  JOIN sources cs ON cs.source_id = cv.source_id
 WHERE m.claim_id = (SELECT MAX(claim_id) FROM claim_mutations)
 ORDER BY m.child_variant_id, m.mutation_id`,
  },
  {
    key: 'search-matches',
    title: 'What each investigation found',
    concept: 'M:N tables SEARCH_CLAIM_MATCHES and SEARCH_RESULT_LINKS + subquery',
    sql: `SELECT r.query_text, r.query_type, m.relationship_to_query,
       c.canonical_claim, m.evidence_count,
       (SELECT COUNT(*) FROM search_result_links l
         WHERE l.search_run_id = r.search_run_id) AS sources_retrieved
  FROM web_search_runs r
  JOIN search_claim_matches m ON m.search_run_id = r.search_run_id
  JOIN claims c               ON c.claim_id = m.claim_id
 ORDER BY r.search_run_id DESC, m.match_score DESC
 FETCH FIRST 12 ROWS ONLY`,
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
          AND object_name NOT IN ('AFW_DDL', 'AFW_SWAP_CHECK')
        ORDER BY object_type, object_name`
    );
    const views = await db.rows(`SELECT view_name FROM user_views ORDER BY view_name`);
    const webRuns = await db.rows(
      `SELECT search_run_id, query_text, status, started_at, results_received, sources_inserted,
              duplicates_skipped, pages_failed, claim_families, error_message
         FROM vw_web_search_runs
        ORDER BY started_at DESC
        FETCH FIRST 6 ROWS ONLY`
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
      webRuns,
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
