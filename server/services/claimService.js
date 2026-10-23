/**
 * Claim queries. All filtering, sorting, aggregation and Echo Ratio
 * calculation happens in Oracle; values are always passed as bind variables.
 * Only fixed, server-defined SQL fragments are ever appended to a statement.
 */
import { query, queryOne, withConnection, withTransaction, oracledb } from '../db/pool.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { STOP_WORDS } from '../ingestion/normalizer.js';

export const CLAIM_STATUSES = ['UNVERIFIED', 'DEVELOPING', 'CORROBORATED', 'DISPUTED', 'DEBUNKED', 'CANDIDATE'];
export const ECHO_BANDS = ['MOSTLY INDEPENDENT SOURCING', 'MIXED SOURCING', 'HIGH REPETITION', 'VERY HIGH SOURCE DEPENDENCE'];
const SOURCE_TYPES = ['DEMO', 'AUTOMATED', 'WEB_SEARCH', 'MANUAL', 'GDELT', 'HACKER_NEWS', 'RSS'];

const SORTS = {
  newest: 'o.latest_seen DESC NULLS LAST, o.claim_id DESC',
  sources: 'o.number_of_sources DESC, o.latest_seen DESC NULLS LAST',
  echo: 'o.echo_ratio DESC, o.number_of_sources DESC',
  platforms: 'o.number_of_platforms DESC, o.number_of_sources DESC',
  relevance: 'relevance DESC, o.number_of_sources DESC, o.latest_seen DESC NULLS LAST',
};

/** Split a free-text search into sanitised terms (letters/digits only). */
export function searchTerms(q) {
  return String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 6);
}

const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Builds the WHERE clause for claim searches. Each search term must appear
 * (as a word prefix) in the canonical claim, a variant, a source title or
 * publisher, an entity alias or a keyword of the claim.
 */
function buildClaimFilter(params) {
  // Title-made families merged into a proposition-based family are kept for
  // history (claim page) but never listed as families of their own
  const where = [`o.status <> 'MERGED'`];
  const binds = {};
  const relevance = [];

  searchTerms(params.q).forEach((term, i) => {
    const b = `t${i}`;
    // The term contains only letters/digits, so it is safe inside a regex;
    // it is still passed as a bind variable.
    binds[b] = `(^|[^[:alnum:]])${term}`;
    where.push(`(
        REGEXP_LIKE(o.canonical_claim, :${b}, 'i')
     OR EXISTS (SELECT 1 FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
                 WHERE v.claim_id = o.claim_id
                   AND (REGEXP_LIKE(v.variant_text, :${b}, 'i')
                        OR REGEXP_LIKE(s.source_title, :${b}, 'i')
                        OR REGEXP_LIKE(s.publisher, :${b}, 'i')))
     OR EXISTS (SELECT 1 FROM claim_entities ce JOIN entity_aliases a ON a.entity_id = ce.entity_id
                 WHERE ce.claim_id = o.claim_id AND REGEXP_LIKE(a.alias_text, :${b}, 'i'))
     OR EXISTS (SELECT 1 FROM claim_keywords ck JOIN keywords k ON k.keyword_id = ck.keyword_id
                 WHERE ck.claim_id = o.claim_id AND REGEXP_LIKE(k.keyword_text, :${b}, 'i')))`);
    relevance.push(`CASE WHEN REGEXP_LIKE(o.canonical_claim, :${b}, 'i') THEN 2 ELSE 0 END`);
  });

  const platformId = toInt(params.platform);
  if (platformId) {
    binds.platform_id = platformId;
    where.push(`EXISTS (SELECT 1 FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
                         WHERE v.claim_id = o.claim_id AND s.platform_id = :platform_id)`);
  }

  const categoryId = toInt(params.category);
  if (categoryId) {
    binds.category_id = categoryId;
    where.push('o.category_id = :category_id');
  }

  if (params.status === 'CURATED') {
    where.push(`o.status <> 'CANDIDATE'`);
  } else if (CLAIM_STATUSES.includes(params.status)) {
    binds.status = params.status;
    where.push('o.status = :status');
  }

  if (params.origin === 'LIVE') where.push(`o.claim_origin <> 'DEMO'`);
  else if (params.origin === 'DEMO') where.push(`o.claim_origin = 'DEMO'`);

  if (ECHO_BANDS.includes(params.echoBand)) {
    binds.echo_band = params.echoBand;
    where.push('o.echo_band = :echo_band');
  }

  const from = toDate(params.dateFrom);
  if (from) {
    binds.date_from = from;
    where.push('o.latest_seen >= :date_from');
  }
  const to = toDate(params.dateTo);
  if (to) {
    to.setHours(23, 59, 59, 999);
    binds.date_to = to;
    where.push('o.first_seen <= :date_to');
  }

  if (SOURCE_TYPES.includes(params.sourceType)) {
    binds.source_type = params.sourceType;
    if (['DEMO', 'AUTOMATED', 'WEB_SEARCH', 'MANUAL'].includes(params.sourceType)) {
      where.push(`EXISTS (SELECT 1 FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
                           WHERE v.claim_id = o.claim_id AND s.origin_type = :source_type)`);
    } else {
      where.push(`EXISTS (SELECT 1 FROM claim_variants v
                            JOIN sources s ON s.source_id = v.source_id
                            JOIN ingestion_sources i ON i.ingestion_source_id = s.ingestion_source_id
                           WHERE v.claim_id = o.claim_id AND i.source_type = :source_type)`);
    }
  }

  // Claim families touched by one live web search run
  const runId = toInt(params.run);
  if (runId) {
    binds.run_id = runId;
    where.push(`EXISTS (SELECT 1 FROM search_result_links l JOIN claim_variants v ON v.source_id = l.source_id
                         WHERE v.claim_id = o.claim_id AND l.search_run_id = :run_id)`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join('\n AND ')}` : '',
    binds,
    relevanceSql: relevance.length ? relevance.join(' + ') : '0',
    hasTerms: relevance.length > 0,
  };
}

export async function listClaims(params = {}) {
  const { whereSql, binds, relevanceSql, hasTerms } = buildClaimFilter(params);
  const sortKey = SORTS[params.sort] ? params.sort : hasTerms ? 'relevance' : 'sources';
  const limit = Math.min(Math.max(toInt(params.limit) || 24, 1), 100);
  const offset = Math.max(toInt(params.offset) || 0, 0);

  const rows = await query(
    `SELECT o.claim_id, o.canonical_claim, o.category_id, o.category, o.status, o.claim_origin,
            o.first_seen, o.latest_seen, o.number_of_sources, o.number_of_platforms,
            o.number_of_variants, o.number_of_independent_origins, o.number_of_derived_sources,
            o.echo_ratio, o.echo_band,
            (SELECT LISTAGG(p.platform_name, ', ') WITHIN GROUP (ORDER BY p.platform_name)
               FROM platforms p
              WHERE p.platform_id IN (SELECT s.platform_id FROM claim_variants v
                                        JOIN sources s ON s.source_id = v.source_id
                                       WHERE v.claim_id = o.claim_id)) AS platforms,
            (SELECT ci.evidence_count FROM vw_claim_investigation ci WHERE ci.claim_id = o.claim_id) AS evidence_count,
            ${toInt(params.run) ? `(SELECT COUNT(DISTINCT l.source_id) FROM search_result_links l
                JOIN claim_variants v ON v.source_id = l.source_id
               WHERE v.claim_id = o.claim_id AND l.search_run_id = :run_id)` : 'NULL'} AS run_sources,
            ${relevanceSql} AS relevance,
            COUNT(*) OVER () AS total_count
       FROM vw_claim_overview o
       ${whereSql}
      ORDER BY ${SORTS[sortKey]}
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset, limit }
  );

  return {
    total: rows.length ? rows[0].total_count : 0,
    limit,
    offset,
    sort: sortKey,
    terms: searchTerms(params.q),
    claims: rows.map(({ total_count, relevance, ...r }) => r),
  };
}

export async function getClaim(id) {
  return withConnection(async (db) => {
    const claim = await db.one(
      `SELECT o.*, c.summary, c.merged_into_claim_id,
              ci.claim_type, ci.subject, ci.predicate, ci.object, ci.qualifier, ci.temporal_scope,
              ci.normalized_signature, ci.evidence_count, ci.known_upstream_count, ci.known_echo_ratio,
              ci.mutation_count, ci.variant_count,
              calculate_echo_ratio(o.claim_id) AS echo_ratio_plsql,
              -- self-repetition (VW_CLAIM_REPETITION): shown next to, never inside, the Echo Ratio
              rp.publisher_count, rp.repeated_sources, rp.self_repetition_ratio, rp.repeated_publishers,
              (SELECT COUNT(*) FROM source_references r
                WHERE r.from_source_id IN (SELECT source_id FROM claim_variants WHERE claim_id = o.claim_id)
                  AND r.to_source_id   IN (SELECT source_id FROM claim_variants WHERE claim_id = o.claim_id)) AS known_reference_links,
              (SELECT COUNT(*) FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
                WHERE v.claim_id = o.claim_id AND s.published_at IS NULL) AS undated_sources
         FROM vw_claim_overview o
         JOIN claims c ON c.claim_id = o.claim_id
         JOIN vw_claim_investigation ci ON ci.claim_id = o.claim_id
         LEFT JOIN vw_claim_repetition rp ON rp.claim_id = o.claim_id
        WHERE o.claim_id = :id`,
      { id }
    );
    if (!claim) throw new NotFoundError(`Claim #${id} does not exist.`);

    const [fingerprint, entities, keywords, platforms] = await Promise.all([
      db.one(
        `SELECT core_assertion, sentiment, emotional_hook, manipulation_marker,
                source_pattern, notes, is_curated
           FROM fingerprints WHERE claim_id = :id`,
        { id }
      ),
      db.rows(
        `SELECT e.entity_id, e.entity_name, e.entity_type, ce.detected_by,
                (SELECT COUNT(*) FROM claim_entities x WHERE x.entity_id = e.entity_id) AS claim_count
           FROM claim_entities ce
           JOIN entities e ON e.entity_id = ce.entity_id
          WHERE ce.claim_id = :id
          ORDER BY e.entity_type, e.entity_name`,
        { id }
      ),
      db.rows(
        `SELECT k.keyword_id, k.keyword_text, k.keyword_origin, ck.weight
           FROM claim_keywords ck
           JOIN keywords k ON k.keyword_id = ck.keyword_id
          WHERE ck.claim_id = :id
          ORDER BY ck.weight DESC, k.keyword_text`,
        { id }
      ),
      db.rows(
        `SELECT platform_name, COUNT(*) AS sources
           FROM vw_claim_sources WHERE claim_id = :id
          GROUP BY platform_name
          ORDER BY sources DESC, platform_name`,
        { id }
      ),
    ]);

    return { ...claim, fingerprint, entities, keywords, platforms };
  });
}

export async function getClaimSources(id) {
  await assertClaim(id);
  return query(
    `SELECT cs.*,
            v.lineage_basis, v.parent_variant_id AS wording_parent_id, v.match_breakdown,
            CASE WHEN cs.published_at IS NOT NULL AND cs.published_at = MIN(cs.published_at) OVER ()
                 THEN 'Y' ELSE 'N' END AS is_earliest,
            (SELECT COUNT(*) FROM source_references r WHERE r.from_source_id = cs.source_id) AS reference_count
       FROM vw_claim_sources cs
       JOIN claim_variants v ON v.variant_id = cs.variant_id
      WHERE cs.claim_id = :id
      ORDER BY cs.published_at NULLS LAST, cs.variant_id`,
    { id }
  );
}

/** Evidence table: exact sentences per source (VW_CLAIM_EVIDENCE), chronological. */
export async function getClaimEvidence(id) {
  await assertClaim(id);
  return query(
    `SELECT e.*,
            CASE WHEN e.published_at IS NOT NULL
                  AND e.published_at = MIN(e.published_at) OVER () THEN 'Y' ELSE 'N' END AS is_earliest,
            -- stated provenance of this source: credits it makes, resolved or not
            (SELECT LISTAGG(a.publisher_text || CASE a.resolution_status WHEN 'RESOLVED' THEN '' ELSE ' (not retrieved)' END, ', ')
                      WITHIN GROUP (ORDER BY a.publisher_text)
               FROM source_attributions a WHERE a.source_id = e.source_id) AS stated_credits
       FROM vw_claim_evidence e
      WHERE e.claim_id = :id
      ORDER BY e.published_at NULLS LAST, e.variant_id`,
    { id }
  );
}

/**
 * The investigation that led to this claim page: what was asked, how this
 * family relates to it (SEARCH_CLAIM_MATCHES) and how much retrieved evidence
 * supported exactly the asked relationship.
 */
export async function getClaimInvestigation(id, runId) {
  await assertClaim(id);
  const row = await queryOne(
    `SELECT r.search_run_id, r.query_text, r.query_type, r.hypothesis_text, r.hypothesis_predicate,
            r.hypothesis_object, m.relationship_to_query, m.evidence_count, m.source_count,
            (SELECT NVL(SUM(x.evidence_count), 0) FROM search_claim_matches x
              WHERE x.search_run_id = r.search_run_id AND x.relationship_to_query = 'EXACT') AS exact_evidence
       FROM web_search_runs r
       LEFT JOIN search_claim_matches m ON m.search_run_id = r.search_run_id AND m.claim_id = :id
      WHERE r.search_run_id = :run`,
    { id, run: runId }
  );
  if (!row) throw new NotFoundError(`Web search run #${runId} does not exist.`);
  return row;
}

export async function getClaimVariants(id) {
  await assertClaim(id);
  return query(
    `SELECT v.variant_id, v.parent_variant_id, v.variant_text, v.actor, v.action, v.target_object,
            v.location_name, v.event_name, v.claimed_date, v.quantity_value, v.certainty,
            v.attribution, v.match_score, v.match_method, v.match_breakdown, v.lineage_basis,
            s.source_id, s.publisher, s.source_url, s.published_at, p.platform_name,
            (SELECT COUNT(*) FROM claim_mutations m WHERE m.child_variant_id = v.variant_id) AS mutation_count
       FROM claim_variants v
       JOIN sources s   ON s.source_id = v.source_id
       JOIN platforms p ON p.platform_id = s.platform_id
      WHERE v.claim_id = :id
      ORDER BY s.published_at NULLS LAST, v.variant_id`,
    { id }
  );
}

export async function getClaimMutations(id) {
  await assertClaim(id);
  return query(
    `SELECT m.mutation_id, m.parent_variant_id, m.child_variant_id, m.changed_component,
            m.old_value, m.new_value, m.is_escalation, m.detected_at,
            pv.variant_text AS from_text, cv.variant_text AS to_text,
            ps.source_id AS from_source_id, ps.publisher AS from_publisher, pp.platform_name AS from_platform,
            ps.published_at AS from_published, ps.source_url AS from_url,
            cs.source_id AS to_source_id, cs.publisher AS to_publisher, cp.platform_name AS to_platform,
            cs.published_at AS to_published, cs.source_url AS to_url
       FROM claim_mutations m
       JOIN claim_variants pv ON pv.variant_id = m.parent_variant_id
       JOIN claim_variants cv ON cv.variant_id = m.child_variant_id
       JOIN sources ps        ON ps.source_id = pv.source_id
       JOIN sources cs        ON cs.source_id = cv.source_id
       JOIN platforms pp      ON pp.platform_id = ps.platform_id
       JOIN platforms cp      ON cp.platform_id = cs.platform_id
      WHERE m.claim_id = :id
      ORDER BY cs.published_at NULLS LAST, m.child_variant_id,
               DECODE(m.changed_component, 'ACTOR', 1, 'ACTION', 2, 'TARGET', 3, 'LOCATION', 4,
                      'EVENT', 5, 'DATE', 6, 'QUANTITY', 7, 'CERTAINTY', 8, 9)`,
    { id }
  );
}

/** Claim (wording) lineage: hierarchical query over parent_variant_id. */
export async function getClaimLineage(id) {
  await assertClaim(id);
  const nodes = await query(
    `SELECT v.variant_id, v.parent_variant_id, v.variant_text, v.certainty, v.lineage_basis,
            LEVEL AS depth, CONNECT_BY_ISLEAF AS is_leaf,
            s.source_id, s.publisher, s.source_url, s.published_at, p.platform_name,
            (SELECT COUNT(*) FROM claim_mutations m WHERE m.child_variant_id = v.variant_id) AS mutation_count
       FROM claim_variants v
       JOIN sources s   ON s.source_id = v.source_id
       JOIN platforms p ON p.platform_id = s.platform_id
      WHERE v.claim_id = :id
      START WITH v.parent_variant_id IS NULL
    CONNECT BY NOCYCLE PRIOR v.variant_id = v.parent_variant_id
      ORDER SIBLINGS BY s.published_at NULLS LAST`,
    { id }
  );
  const edges = nodes
    .filter((n) => n.parent_variant_id)
    .map((n) => ({ source: n.parent_variant_id, target: n.variant_id }));
  return { nodes, edges };
}

/**
 * Source lineage: the claim's sources plus every known upstream ancestor
 * (walks SOURCES.derived_from_source_id upwards with CONNECT BY).
 */
export async function getSourceLineage(id) {
  await assertClaim(id);
  // Nodes: the claim's sources, every known upstream ancestor
  // (SOURCES.derived_from_source_id) and every source they reference
  // (SOURCE_REFERENCES: hyperlink, submitted link, canonical, attribution)
  const nodes = await query(
    `WITH claim_sources AS (
         SELECT DISTINCT source_id FROM claim_variants WHERE claim_id = :id
     ),
     ancestry AS (
         SELECT DISTINCT s.source_id
           FROM sources s
          START WITH s.source_id IN (SELECT source_id FROM claim_sources)
        CONNECT BY NOCYCLE s.source_id = PRIOR s.derived_from_source_id
     ),
     graph AS (
         SELECT source_id FROM ancestry
         UNION
         SELECT r.to_source_id FROM source_references r
          WHERE r.from_source_id IN (SELECT source_id FROM claim_sources)
     )
     SELECT s.source_id, s.derived_from_source_id, s.publisher, s.source_title, s.source_url,
            s.published_at, s.origin_type, s.provenance_note, p.platform_name,
            l.lineage_depth AS depth, l.root_source_id,
            CASE WHEN s.derived_from_source_id IS NULL THEN 'INDEPENDENT' ELSE 'DERIVED' END AS dependency,
            CASE WHEN s.source_id IN (SELECT source_id FROM claim_sources) THEN 'Y' ELSE 'N' END AS in_claim,
            (SELECT COUNT(*) FROM sources c WHERE c.derived_from_source_id = s.source_id) AS child_count
       FROM sources s
       JOIN graph g             ON g.source_id = s.source_id
       JOIN platforms p         ON p.platform_id = s.platform_id
       LEFT JOIN vw_source_lineage l ON l.source_id = s.source_id
      ORDER BY l.lineage_depth NULLS LAST, s.published_at NULLS LAST`,
    { id }
  );
  // Edges: upstream source -> dependent source. A SOURCE_REFERENCES row is the
  // evidence (its type labels the edge); the known-upstream shortcut is shown
  // where no reference row explains it (curated demo provenance).
  const refs = await query(
    `SELECT r.from_source_id, r.to_source_id, r.reference_type
       FROM source_references r
      WHERE r.from_source_id IN (SELECT source_id FROM claim_variants WHERE claim_id = :id)
         OR r.to_source_id   IN (SELECT source_id FROM claim_variants WHERE claim_id = :id)
      ORDER BY r.from_source_id, r.to_source_id`,
    { id }
  );
  const ids = new Set(nodes.map((n) => n.source_id));
  const edges = [];
  const seen = new Set();
  for (const r of refs) {
    const key = `${r.to_source_id}>${r.from_source_id}`;
    if (!ids.has(r.to_source_id) || !ids.has(r.from_source_id) || seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: r.to_source_id, target: r.from_source_id, kind: r.reference_type });
  }
  for (const n of nodes) {
    const key = `${n.derived_from_source_id}>${n.source_id}`;
    if (n.derived_from_source_id && ids.has(n.derived_from_source_id) && !seen.has(key)) {
      seen.add(key);
      edges.push({ source: n.derived_from_source_id, target: n.source_id, kind: 'KNOWN_UPSTREAM' });
    }
  }
  return { nodes, edges };
}

/**
 * Novelty diagnostics for one claim family, counted in Oracle
 * (VW_CLAIM_NOVELTY_DIAGNOSTICS), plus the pipeline stages recorded by the
 * investigations that touched it (SEARCH_RUN_STAGES).
 */
export async function getNoveltyDiagnostics(id) {
  await assertClaim(id);
  return withConnection(async (db) => {
    const d = await db.one('SELECT * FROM vw_claim_novelty_diagnostics WHERE claim_id = :id', { id });
    const runs = await db.rows(
      `SELECT DISTINCT l.search_run_id
         FROM search_result_links l
        WHERE l.source_id IN (SELECT source_id FROM claim_variants WHERE claim_id = :id)
        ORDER BY l.search_run_id DESC
        FETCH FIRST 5 ROWS ONLY`,
      { id }
    );
    const stages = runs.length
      ? await db.rows(
        `SELECT search_run_id, stage_code, items_examined, rows_written, detail
           FROM search_run_stages
          WHERE search_run_id IN (SELECT column_value FROM TABLE(sys.odcinumberlist(${runs.map((r) => Number(r.search_run_id)).join(',')})))
          ORDER BY search_run_id DESC, stage_order`
      )
      : [];
    // Stated provenance by publisher (GROUP BY in Oracle)
    const statedCredits = await db.rows(
      `SELECT a.publisher_text AS publisher,
              COUNT(DISTINCT a.source_id) AS sources,
              SUM(CASE WHEN a.resolution_status = 'RESOLVED' THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN a.resolution_status = 'UNRESOLVED' THEN 1 ELSE 0 END) AS unresolved
         FROM source_attributions a
        WHERE a.source_id IN (SELECT source_id FROM claim_variants WHERE claim_id = :id)
        GROUP BY a.publisher_text
        ORDER BY COUNT(DISTINCT a.source_id) DESC, a.publisher_text`,
      { id }
    );
    return { claimId: id, ...diagnosticsShape(d), statedCredits, stages };
  });
}

const VARIATION_DIMENSIONS = [
  ['certainty_varies', 'certainty', 'Certainty'],
  ['date_varies', 'claimed_date', 'Date stated'],
  ['quantity_varies', 'quantity_value', 'Quantity'],
  ['location_varies', 'location_name', 'Location'],
  ['event_varies', 'event_name', 'Event'],
  ['attribution_varies', 'attribution', 'Attribution'],
  ['object_varies', 'relation_object', 'Object'],
  ['qualifier_varies', 'relation_qualifier', 'Qualifier'],
];

/**
 * Claim Variation: how the retrieved versions differ, without order or
 * parentage. Oracle (VW_CLAIM_VARIATION) decides which dimensions vary; the
 * API only lists them with each version's value.
 */
export async function getClaimVariation(id) {
  await assertClaim(id);
  const rows = await query(
    `SELECT * FROM vw_claim_variation WHERE claim_id = :id ORDER BY publisher, variant_id`,
    { id }
  );
  const first = rows[0] || {};
  const dimensions = VARIATION_DIMENSIONS
    .filter(([flag]) => first[flag] === 'Y')
    .map(([, column, label]) => ({ column, label }));
  return {
    claimId: id,
    variantCount: Number(first.variant_count || 0),
    dimensions,
    variants: rows.map((r) => ({
      variant_id: r.variant_id, source_id: r.source_id, publisher: r.publisher, published_at: r.published_at,
      variant_text: r.variant_text,
      values: Object.fromEntries(dimensions.map((d) => [d.column, r[d.column] ?? null])),
    })),
  };
}

/** Oracle row (VW_CLAIM_NOVELTY_DIAGNOSTICS) -> API shape. */
export function diagnosticsShape(d) {
  const n = (v) => Number(v || 0);
  return {
    status: d.status,
    mergedIntoClaimId: d.merged_into_claim_id || null,
    hasProposition: d.has_proposition === 'Y',
    normalizedSignature: d.normalized_signature || null,
    sourceCount: n(d.source_count),
    readableSourceCount: n(d.readable_source_count),
    datedSourceCount: n(d.dated_source_count),
    datedVariantCount: n(d.dated_variant_count),
    referencedParentCount: n(d.referenced_parent_count),
    transitionsWithChange: n(d.transitions_with_change),
    hasVariation: n(d.has_variation) > 0,
    statedAttributionCount: n(d.stated_attribution_count),
    sourcesWithStatedCredit: n(d.sources_with_stated_credit),
    resolvedAttributionCount: n(d.resolved_attribution_count),
    unresolvedAttributionCount: n(d.unresolved_attribution_count),
    evidenceCount: n(d.evidence_count),
    storedSentenceCount: n(d.stored_sentence_count),
    variantCount: n(d.variant_count),
    variantsWithEvidence: n(d.variants_with_evidence),
    structuredVariantCount: n(d.structured_variant_count),
    variantsWithParent: n(d.variants_with_parent),
    claimLineageEdges: n(d.claim_lineage_edges),
    mutationCount: n(d.mutation_count),
    sourceReferenceCount: n(d.source_reference_count),
    inFamilyReferenceCount: n(d.in_family_reference_count),
    sourcesWithKnownUpstream: n(d.sources_with_known_upstream),
    sourceLineageEdges: n(d.source_lineage_edges),
    knownEchoRatio: d.known_echo_ratio === null || d.known_echo_ratio === undefined ? null : Number(d.known_echo_ratio),
  };
}

async function assertClaim(id) {
  const row = await queryOne('SELECT claim_id FROM claims WHERE claim_id = :id', { id });
  if (!row) throw new NotFoundError(`Claim #${id} does not exist.`);
}

function requireText(value, field, max) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new ValidationError(`${field} is required.`);
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  return v;
}

const optText = (value, max) => {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v.slice(0, max) : null;
};

export async function createClaim(body = {}) {
  const canonical = requireText(body.canonical_claim, 'canonical_claim', 500);
  const categoryId = toInt(body.category_id);
  if (!categoryId) throw new ValidationError('category_id is required.');
  const status = body.status || 'UNVERIFIED';
  if (!CLAIM_STATUSES.includes(status)) throw new ValidationError('status is not valid.');

  const id = await withTransaction(async (db) => {
    const r = await db.exec(
      `INSERT INTO claims (canonical_claim, category_id, status, claim_origin, summary)
       VALUES (:canonical, :category_id, :status, 'MANUAL', :summary)
       RETURNING claim_id INTO :id`,
      {
        canonical,
        category_id: categoryId,
        status,
        summary: optText(body.summary, 1000),
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const claimId = r.outBinds.id[0];
    const fp = body.fingerprint || {};
    await db.exec(
      `INSERT INTO fingerprints (claim_id, core_assertion, sentiment, emotional_hook,
                                 manipulation_marker, source_pattern, notes, is_curated)
       VALUES (:claim_id, :core, :sentiment, :hook, :marker, :pattern, :notes, :curated)`,
      {
        claim_id: claimId,
        core: optText(fp.core_assertion, 500) || canonical,
        sentiment: ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED'].includes(fp.sentiment) ? fp.sentiment : null,
        hook: optText(fp.emotional_hook, 200),
        marker: optText(fp.manipulation_marker, 200),
        pattern: optText(fp.source_pattern, 200),
        notes: optText(fp.notes, 1000),
        curated: fp.emotional_hook || fp.manipulation_marker ? 'Y' : 'N',
      }
    );
    return claimId;
  });
  return getClaim(id);
}

export async function updateClaim(id, body = {}) {
  await assertClaim(id);
  const sets = [];
  const binds = { id };
  if (body.canonical_claim !== undefined) {
    binds.canonical = requireText(body.canonical_claim, 'canonical_claim', 500);
    sets.push('canonical_claim = :canonical');
  }
  if (body.category_id !== undefined) {
    binds.category_id = toInt(body.category_id);
    if (!binds.category_id) throw new ValidationError('category_id is not valid.');
    sets.push('category_id = :category_id');
  }
  if (body.status !== undefined) {
    if (!CLAIM_STATUSES.includes(body.status)) throw new ValidationError('status is not valid.');
    binds.status = body.status;
    sets.push('status = :status');
  }
  if (body.summary !== undefined) {
    binds.summary = optText(body.summary, 1000);
    sets.push('summary = :summary');
  }
  if (!sets.length) throw new ValidationError('Nothing to update.');
  await withTransaction((db) => db.exec(`UPDATE claims SET ${sets.join(', ')} WHERE claim_id = :id`, binds));
  return getClaim(id);
}

export async function deleteClaim(id) {
  await assertClaim(id);
  await withTransaction((db) => db.exec('DELETE FROM claims WHERE claim_id = :id', { id }));
  return { deleted: true, claim_id: id };
}

/**
 * Adds a variant through the ADD_CLAIM_VARIANT procedure. A new source can be
 * supplied inline; it is inserted in the same transaction.
 */
export async function addVariant(claimId, body = {}) {
  await assertClaim(claimId);
  const variantText = requireText(body.variant_text, 'variant_text', 1000);
  const certainty = (body.certainty || 'UNSTATED').toUpperCase();
  if (!['UNSTATED', 'QUESTIONED', 'POSSIBLE', 'EXPECTED', 'CONFIRMED', 'DENIED'].includes(certainty)) {
    throw new ValidationError('certainty is not valid.');
  }

  const variantId = await withTransaction(async (db) => {
    let sourceId = toInt(body.source_id);
    if (!sourceId && body.source) {
      const { insertSource } = await import('./sourceService.js');
      sourceId = await insertSource(db, body.source);
    }
    if (!sourceId) throw new ValidationError('source_id or a new source is required.');

    const r = await db.exec(
      `BEGIN
         add_claim_variant(
           p_claim_id => :claim_id, p_source_id => :source_id, p_parent_variant_id => :parent_id,
           p_variant_text => :text, p_actor => :actor, p_action => :action,
           p_target_object => :target, p_location_name => :location, p_event_name => :event,
           p_claimed_date => :claimed_date, p_quantity_value => :quantity, p_certainty => :certainty,
           p_attribution => :attribution, p_match_score => 100, p_match_method => 'MANUAL',
           p_lineage_basis => :basis, p_match_breakdown => NULL, o_variant_id => :variant_id);
       END;`,
      {
        claim_id: claimId,
        source_id: sourceId,
        parent_id: toInt(body.parent_variant_id),
        text: variantText,
        actor: optText(body.actor, 200),
        action: optText(body.action, 100),
        target: optText(body.target_object, 200),
        location: optText(body.location_name, 200),
        event: optText(body.event_name, 200),
        claimed_date: optText(body.claimed_date, 80),
        quantity: optText(body.quantity_value, 80),
        certainty,
        attribution: optText(body.attribution, 200),
        basis: toInt(body.parent_variant_id) ? 'MANUAL' : 'NONE',
        variant_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    return r.outBinds.variant_id;
  });

  const variants = await getClaimVariants(claimId);
  return variants.find((v) => v.variant_id === variantId) || { variant_id: variantId };
}
