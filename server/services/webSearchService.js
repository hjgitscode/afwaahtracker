/**
 * Live web investigation API: start a run, report its progress, and return
 * what Oracle now holds for it (claim families, related sources, stored
 * matches). All result data is re-queried from Oracle after the run.
 */
import { query, queryOne } from '../db/pool.js';
import { NotFoundError } from '../middleware/errors.js';
import { investigateWeb, getProgress, STAGES } from '../web-search/webInvestigator.js';
import { isWebSearchConfigured } from '../web-search/searchProvider.js';
import { listClaims } from './claimService.js';
import { listSources } from './sourceService.js';

export const UNAVAILABLE_MESSAGE = 'Live web search unavailable — showing stored sources.';

function summarise(result, claimFamilies) {
  return {
    searchRunId: result.searchRunId,
    query: result.query,
    status: result.status,
    error: result.error,
    webSearchAvailable: isWebSearchConfigured(),
    message: isWebSearchConfigured() ? null : UNAVAILABLE_MESSAGE,
    resultsReceived: result.resultsReceived,
    pagesFetched: result.pagesFetched,
    pagesFailed: result.pagesFailed,
    sourcesAnalysed: result.sourcesInserted + result.duplicatesSkipped,
    sourcesInserted: result.sourcesInserted,
    duplicatesSkipped: result.duplicatesSkipped,
    claimsMatched: result.claimsMatched,
    claimsCreated: result.claimsCreated,
    referencesFound: result.referencesFound,
    claimFamilies,
  };
}

async function countFamilies(runId) {
  const row = await queryOne(
    `SELECT COUNT(DISTINCT v.claim_id) AS n
       FROM search_result_links l JOIN claim_variants v ON v.source_id = l.source_id
      WHERE l.search_run_id = :id`,
    { id: runId }
  );
  return row ? row.n : 0;
}

/**
 * Synchronous mode returns the finished summary. Async mode returns as soon
 * as the run row exists so the browser can poll /web-search/:id/status.
 */
// The same query investigated this recently reuses that run instead of
// spending another search request (failed runs are never reused).
const REUSE_WINDOW_SECONDS = 120;

async function recentRun(text) {
  const q = text.trim().replace(/\s+/g, ' ').toLowerCase();
  if (q.length < 2) return null;
  return queryOne(
    `SELECT search_run_id, status FROM web_search_runs
      WHERE LOWER(query_text) = :q
        AND status <> 'FAILED'
        AND started_at >= SYSTIMESTAMP - NUMTODSINTERVAL(:secs, 'SECOND')
      ORDER BY started_at DESC
      FETCH FIRST 1 ROWS ONLY`,
    { q: q.slice(0, 400), secs: REUSE_WINDOW_SECONDS }
  );
}

export async function startInvestigation(body = {}) {
  const text = String(body.query ?? body.q ?? '');
  const reused = await recentRun(text);
  if (reused) {
    if (body.async) {
      return { searchRunId: reused.search_run_id, status: reused.status, query: text.trim(), webSearchAvailable: isWebSearchConfigured(), reused: true };
    }
    const st = await getRunStatus(reused.search_run_id);
    return { ...summarise({ searchRunId: reused.search_run_id, query: st.query, status: st.status, error: st.error, referencesFound: null, ...st.counts }, st.counts?.claimFamilies ?? 0), reused: true };
  }
  if (body.async) {
    return new Promise((resolve, reject) => {
      let started = false;
      investigateWeb(text, {
        onStart: (runId) => {
          started = true;
          resolve({ searchRunId: runId, status: 'RUNNING', query: text.trim(), webSearchAvailable: isWebSearchConfigured() });
        },
      }).catch((err) => {
        if (!started) reject(err);
        else console.error('[web-search] background run failed', err.message);
      });
    });
  }
  const result = await investigateWeb(text);
  return summarise(result, await countFamilies(result.searchRunId));
}

export async function getRunStatus(runId) {
  const live = getProgress(runId);
  const row = await queryOne(`SELECT * FROM vw_web_search_runs WHERE search_run_id = :id`, { id: runId });
  if (!row && !live) throw new NotFoundError(`Web search run #${runId} does not exist.`);
  const done = row && row.status !== 'RUNNING';
  return {
    searchRunId: runId,
    query: row?.query_text ?? live?.query,
    status: done ? row.status : live?.status || row?.status || 'RUNNING',
    stage: done ? 'COMPLETE' : live?.stage || null,
    stageIndex: done ? STAGES.length : live?.stageIndex ?? -1,
    stages: STAGES,
    error: row?.error_message ?? live?.error ?? null,
    webSearchAvailable: isWebSearchConfigured(),
    message: isWebSearchConfigured() ? null : UNAVAILABLE_MESSAGE,
    counts: done
      ? {
        resultsReceived: row.results_received,
        pagesFetched: row.pages_fetched,
        pagesFailed: row.pages_failed,
        sourcesInserted: row.sources_inserted,
        duplicatesSkipped: row.duplicates_skipped,
        sourcesAnalysed: row.sources_inserted + row.duplicates_skipped,
        claimsMatched: row.claims_matched,
        claimsCreated: row.claims_created,
        claimFamilies: row.claim_families,
      }
      : live?.counts || null,
    startedAt: row?.started_at ?? live?.startedAt,
    completedAt: row?.completed_at ?? null,
  };
}

/**
 * Everything the Explore page needs for one run.
 * A claim family counts as "strong" when two or more of this run's sources
 * belong to it, or one of them matched it strongly (score >= threshold).
 */
export async function getRunResults(runId) {
  const run = await queryOne(`SELECT * FROM vw_web_search_runs WHERE search_run_id = :id`, { id: runId });
  if (!run) throw new NotFoundError(`Web search run #${runId} does not exist.`);

  const [families, strongRows, related, stored] = await Promise.all([
    listClaims({ run: runId, sort: 'sources', limit: 60 }),
    query(
      `SELECT DISTINCT v.claim_id
         FROM search_result_links l JOIN claim_variants v ON v.source_id = l.source_id
        WHERE l.search_run_id = :id AND v.match_method IN ('RULE_STRONG','CURATED','MANUAL')`,
      { id: runId }
    ),
    listSources({ run: runId, limit: 60, sort: 'newest' }),
    // Oracle first: stored claim families that match the query text
    listClaims({ q: run.query_text, limit: 12 }),
  ]);

  const strongIds = new Set(strongRows.map((r) => r.claim_id));
  const claims = families.claims
    .map((c) => ({ ...c, strong_family: strongIds.has(c.claim_id) || (c.run_sources || 0) >= 2 ? 'Y' : 'N' }))
    .sort((a, b) => (b.strong_family === 'Y') - (a.strong_family === 'Y') || b.run_sources - a.run_sources || b.number_of_sources - a.number_of_sources);
  const runClaimIds = new Set(claims.map((c) => c.claim_id));

  return {
    run,
    webSearchAvailable: isWebSearchConfigured(),
    message: run.status === 'FAILED' ? run.error_message || UNAVAILABLE_MESSAGE : null,
    strongFamilyDetected: claims.some((c) => c.strong_family === 'Y'),
    claims,
    relatedSources: related.sources,
    relatedSourceCount: related.total,
    storedClaims: stored.claims.filter((c) => !runClaimIds.has(c.claim_id)),
  };
}

export function listRuns(limit = 20) {
  return query(
    `SELECT * FROM vw_web_search_runs ORDER BY started_at DESC FETCH FIRST :n ROWS ONLY`,
    { n: Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100) }
  );
}
