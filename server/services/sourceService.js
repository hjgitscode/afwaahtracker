/**
 * Source queries and manual source CRUD (bind variables only).
 */
import { query, withConnection, withTransaction, oracledb } from '../db/pool.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { normaliseUrl } from '../ingestion/normalizer.js';

const SORTS = {
  newest: 's.published_at DESC NULLS LAST, s.source_id DESC',
  oldest: 's.published_at ASC NULLS LAST, s.source_id ASC',
  fetched: 's.fetched_at DESC, s.source_id DESC',
  publisher: 'LOWER(s.publisher) ASC, s.published_at DESC NULLS LAST',
  engagement: 's.engagement_count DESC, s.published_at DESC NULLS LAST',
};

const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Primary claim of each source = the variant with the highest match score. */
const SOURCE_SELECT = `
  SELECT s.source_id, s.publisher, s.author, s.source_title, s.source_url, s.linked_url,
         s.external_source_id, s.published_at, s.fetched_at, s.snippet, s.engagement_count,
         s.source_status, s.origin_type, s.derived_from_source_id, s.provenance_note, s.canonical_url,
         CASE s.origin_type WHEN 'AUTOMATED' THEN 'FEED' ELSE s.origin_type END AS retrieval_method,
         (SELECT COUNT(*) FROM source_references r WHERE r.from_source_id = s.source_id) AS reference_count,
         p.platform_id, p.platform_name, p.platform_type,
         i.source_name AS ingestion_source_name, i.source_type AS ingestion_source_type,
         parent.publisher AS derived_from_publisher,
         CASE WHEN s.derived_from_source_id IS NULL THEN 'INDEPENDENT' ELSE 'DERIVED' END AS dependency,
         mv.claim_id, mc.canonical_claim, mc.status AS claim_status,
         mv.match_score, mv.match_method, mv.variant_text,
         (SELECT COUNT(*) FROM claim_variants x WHERE x.source_id = s.source_id) AS claim_count`;

const SOURCE_FROM = `
    FROM sources s
    JOIN platforms p              ON p.platform_id = s.platform_id
    LEFT JOIN ingestion_sources i ON i.ingestion_source_id = s.ingestion_source_id
    LEFT JOIN sources parent      ON parent.source_id = s.derived_from_source_id
    LEFT JOIN (SELECT v.*, ROW_NUMBER() OVER (PARTITION BY v.source_id
                                              ORDER BY v.match_score DESC, v.variant_id) AS rn
                 FROM claim_variants v) mv
           ON mv.source_id = s.source_id AND mv.rn = 1
    LEFT JOIN claims mc           ON mc.claim_id = mv.claim_id`;

export async function listSources(params = {}) {
  const where = [];
  const binds = {};

  const q = String(params.q || '').trim().toLowerCase().slice(0, 100);
  if (q) {
    binds.q = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(LOWER(s.publisher) LIKE :q ESCAPE '\\'
              OR LOWER(s.source_title) LIKE :q ESCAPE '\\'
              OR LOWER(s.source_url) LIKE :q ESCAPE '\\'
              OR LOWER(NVL(s.author, ' ')) LIKE :q ESCAPE '\\'
              OR LOWER(NVL(mc.canonical_claim, ' ')) LIKE :q ESCAPE '\\')`);
  }
  const platformId = toInt(params.platform);
  if (platformId) {
    binds.platform_id = platformId;
    where.push('s.platform_id = :platform_id');
  }
  // Retrieval method: DEMO | FEED (scheduled feeds) | WEB_SEARCH | MANUAL
  const origin = params.retrieval === 'FEED' ? 'AUTOMATED' : params.retrieval || params.origin;
  if (['DEMO', 'AUTOMATED', 'WEB_SEARCH', 'MANUAL'].includes(origin)) {
    binds.origin = origin;
    where.push('s.origin_type = :origin');
  }
  const runId = toInt(params.run);
  if (runId) {
    binds.run_id = runId;
    where.push('EXISTS (SELECT 1 FROM search_result_links l WHERE l.source_id = s.source_id AND l.search_run_id = :run_id)');
  }
  if (params.claimLinked === 'N') where.push('NOT EXISTS (SELECT 1 FROM claim_variants cv WHERE cv.source_id = s.source_id)');
  if (['GDELT', 'HACKER_NEWS', 'RSS'].includes(params.sourceType)) {
    binds.source_type = params.sourceType;
    where.push('i.source_type = :source_type');
  }
  if (['INDEPENDENT', 'DERIVED', 'KNOWN_DERIVED', 'NO_KNOWN_UPSTREAM'].includes(params.dependency)) {
    where.push(['DERIVED', 'KNOWN_DERIVED'].includes(params.dependency)
      ? 's.derived_from_source_id IS NOT NULL'
      : 's.derived_from_source_id IS NULL');
  }
  const claimId = toInt(params.claim);
  if (claimId) {
    binds.claim_id = claimId;
    where.push('EXISTS (SELECT 1 FROM claim_variants cv WHERE cv.source_id = s.source_id AND cv.claim_id = :claim_id)');
  }
  const from = toDate(params.dateFrom);
  if (from) {
    binds.date_from = from;
    where.push('s.published_at >= :date_from');
  }
  const to = toDate(params.dateTo);
  if (to) {
    to.setHours(23, 59, 59, 999);
    binds.date_to = to;
    where.push('s.published_at <= :date_to');
  }

  const sort = SORTS[params.sort] ? params.sort : 'newest';
  const limit = Math.min(Math.max(toInt(params.limit) || 25, 1), 100);
  const offset = Math.max(toInt(params.offset) || 0, 0);

  const rows = await query(
    `${SOURCE_SELECT}, COUNT(*) OVER () AS total_count
     ${SOURCE_FROM}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${SORTS[sort]}
     OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset, limit }
  );

  return {
    total: rows.length ? rows[0].total_count : 0,
    limit,
    offset,
    sort,
    sources: rows.map(({ total_count, ...r }) => r),
  };
}

export async function getSource(id) {
  return withConnection(async (db) => {
    const source = await db.one(`${SOURCE_SELECT} ${SOURCE_FROM} WHERE s.source_id = :id`, { id });
    if (!source) throw new NotFoundError(`Source #${id} does not exist.`);

    const [claims, derivedChildren, lineage, references, searchRuns] = await Promise.all([
      db.rows(
        `SELECT v.claim_id, c.canonical_claim, c.status, v.variant_id, v.variant_text, v.certainty,
                v.match_score, v.match_method, v.match_breakdown
           FROM claim_variants v JOIN claims c ON c.claim_id = v.claim_id
          WHERE v.source_id = :id
          ORDER BY v.match_score DESC`,
        { id }
      ),
      db.rows(
        `SELECT s.source_id, s.publisher, s.source_title, s.published_at, p.platform_name
           FROM sources s JOIN platforms p ON p.platform_id = s.platform_id
          WHERE s.derived_from_source_id = :id
          ORDER BY s.published_at NULLS LAST`,
        { id }
      ),
      // Upstream chain to the earliest known origin (hierarchical query, walking upwards)
      db.rows(
        `SELECT s.source_id, s.publisher, s.published_at, p.platform_name, LEVEL AS steps_back
           FROM sources s JOIN platforms p ON p.platform_id = s.platform_id
          START WITH s.source_id = :id
        CONNECT BY NOCYCLE s.source_id = PRIOR s.derived_from_source_id
          ORDER BY LEVEL DESC`,
        { id }
      ),
      // Explicit evidence in both directions (VW_SOURCE_REFERENCES)
      db.rows(
        `SELECT reference_id, reference_type, confidence_basis, detected_at, sets_dependence,
                CASE WHEN from_source_id = :id THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
                CASE WHEN from_source_id = :id THEN to_source_id ELSE from_source_id END AS other_source_id,
                CASE WHEN from_source_id = :id THEN to_publisher ELSE from_publisher END AS other_publisher,
                CASE WHEN from_source_id = :id THEN to_title ELSE from_title END AS other_title,
                CASE WHEN from_source_id = :id THEN to_url ELSE from_url END AS other_url
           FROM vw_source_references
          WHERE from_source_id = :id OR to_source_id = :id
          ORDER BY direction DESC, detected_at`,
        { id }
      ),
      db.rows(
        `SELECT r.search_run_id, r.query_text, r.started_at, l.search_rank, l.result_snippet, l.was_duplicate
           FROM search_result_links l JOIN web_search_runs r ON r.search_run_id = l.search_run_id
          WHERE l.source_id = :id
          ORDER BY r.started_at DESC
          FETCH FIRST 10 ROWS ONLY`,
        { id }
      ),
    ]);
    return {
      ...source,
      claims,
      derived_children: derivedChildren,
      upstream_chain: lineage,
      references,
      search_runs: searchRuns,
    };
  });
}

function cleanSourceInput(body, { partial = false } = {}) {
  const out = {};
  const text = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);

  if (!partial || body.publisher !== undefined) {
    out.publisher = text(body.publisher, 200);
    if (!out.publisher) throw new ValidationError('publisher is required.');
  }
  if (!partial || body.source_title !== undefined) {
    out.source_title = text(body.source_title, 1000);
    if (!out.source_title) throw new ValidationError('source_title is required.');
  }
  if (!partial || body.source_url !== undefined) {
    out.source_url = normaliseUrl(body.source_url);
    if (!out.source_url) throw new ValidationError('source_url must be a valid http(s) URL.');
  }
  if (!partial || body.platform_id !== undefined) {
    out.platform_id = toInt(body.platform_id);
    if (!out.platform_id) throw new ValidationError('platform_id is required.');
  }
  if (!partial || body.published_at !== undefined) {
    out.published_at = toDate(body.published_at) || (partial ? null : new Date());
    if (partial && !out.published_at) throw new ValidationError('published_at is not a valid date.');
  }
  if (body.author !== undefined) out.author = text(body.author, 200);
  if (body.snippet !== undefined) out.snippet = text(body.snippet, 4000);
  if (body.engagement_count !== undefined) out.engagement_count = Math.max(0, toInt(body.engagement_count) || 0);
  if (body.derived_from_source_id !== undefined) out.derived_from_source_id = toInt(body.derived_from_source_id);
  if (body.provenance_note !== undefined) out.provenance_note = text(body.provenance_note, 500);
  if (body.source_status !== undefined) {
    if (!['ACTIVE', 'UNAVAILABLE', 'REMOVED', 'ARCHIVED'].includes(body.source_status)) {
      throw new ValidationError('source_status is not valid.');
    }
    out.source_status = body.source_status;
  }
  return out;
}

/** Inserts a MANUAL source using an existing transaction runner. */
export async function insertSource(db, body) {
  const s = cleanSourceInput(body);
  const r = await db.exec(
    `INSERT INTO sources (platform_id, publisher, author, source_title, source_url, published_at,
                          snippet, engagement_count, origin_type, derived_from_source_id, provenance_note)
     VALUES (:platform_id, :publisher, :author, :source_title, :source_url, :published_at,
             :snippet, :engagement_count, 'MANUAL', :derived_from_source_id, :provenance_note)
     RETURNING source_id INTO :id`,
    {
      platform_id: s.platform_id,
      publisher: s.publisher,
      author: s.author ?? null,
      source_title: s.source_title,
      source_url: s.source_url,
      published_at: s.published_at,
      snippet: s.snippet ?? null,
      engagement_count: s.engagement_count ?? 0,
      derived_from_source_id: s.derived_from_source_id ?? null,
      provenance_note: s.provenance_note ?? 'Added manually.',
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );
  const sourceId = r.outBinds.id[0];
  await recordManualReference(db, sourceId, s.derived_from_source_id);
  return sourceId;
}

/** A manually entered upstream source is recorded as MANUAL evidence. */
async function recordManualReference(db, sourceId, upstreamId) {
  if (!upstreamId || upstreamId === sourceId) return;
  await db.exec(`BEGIN :n := record_source_reference(:f, :t, 'MANUAL', 'Upstream source entered manually.'); END;`, {
    n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    f: sourceId,
    t: upstreamId,
  });
}

export async function createSource(body = {}) {
  const id = await withTransaction((db) => insertSource(db, body));
  return getSource(id);
}

const UPDATABLE = ['publisher', 'author', 'source_title', 'source_url', 'platform_id', 'published_at', 'snippet',
  'engagement_count', 'derived_from_source_id', 'provenance_note', 'source_status'];

export async function updateSource(id, body = {}) {
  const s = cleanSourceInput(body, { partial: true });
  const cols = UPDATABLE.filter((c) => Object.prototype.hasOwnProperty.call(s, c));
  if (!cols.length) throw new ValidationError('Nothing to update.');
  if (s.derived_from_source_id === id) throw new ValidationError('A source cannot be derived from itself.');

  const binds = { id };
  cols.forEach((c) => {
    binds[c] = s[c];
  });
  const result = await withTransaction(async (db) => {
    const r = await db.exec(`UPDATE sources SET ${cols.map((c) => `${c} = :${c}`).join(', ')} WHERE source_id = :id`, binds);
    if (r.rowsAffected) await recordManualReference(db, id, s.derived_from_source_id);
    return r;
  });
  if (!result.rowsAffected) throw new NotFoundError(`Source #${id} does not exist.`);
  return getSource(id);
}
