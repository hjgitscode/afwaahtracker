/**
 * Live web investigation (on-demand "INVESTIGATE WEB").
 *
 *   1. START_WEB_SEARCH_RUN                                   (COMMIT)
 *   2. web search provider (Tavily) -> one request -> publicly indexed results
 *   3. normalise URLs, drop duplicates inside the batch
 *   4. duplicates already in Oracle are linked to the run, not re-stored
 *   5. fetch new public pages (bounded concurrency, timeout, size limit);
 *      a failed page falls back to the search title + snippet
 *   6. extract title / publisher / author / date / text / canonical / links
 *   7. per result, ONE transaction: store source, link it to the run, match
 *      or create a claim family, variant, Mutation Ledger, references
 *   8. relationship pass: links between pages stored in the same run
 *   9. FINISH_WEB_SEARCH_RUN with the counts                  (COMMIT)
 *
 * Without TAVILY_API_KEY the run is recorded as FAILED with a clear
 * message, and the caller still shows the sources stored in Oracle.
 */
import { withConnection, withTransaction, oracledb } from '../db/pool.js';
import config from '../config/index.js';
import { HttpError, ValidationError } from '../middleware/errors.js';
import { mapLimit } from '../ingestion/http.js';
import { normaliseUrl, makeItem, domainOf, cleanText } from '../ingestion/normalizer.js';
import { loadDictionary } from '../ingestion/entityMatcher.js';
import { processSourceItem, recordReferences, refreshLineage } from '../ingestion/sourceProcessor.js';
import { searchWeb, providerName, isWebSearchConfigured, WebSearchUnavailableError } from './searchProvider.js';
import { fetchPage } from './pageFetcher.js';
import { extractPage } from './pageExtractor.js';

export const STAGES = [
  { key: 'SEARCHING', label: 'Searching indexed web sources' },
  { key: 'NORMALISING', label: 'Normalising URLs' },
  { key: 'DEDUPLICATING', label: 'Removing duplicates' },
  { key: 'FETCHING', label: 'Fetching public pages' },
  { key: 'MATCHING', label: 'Matching claim families' },
  { key: 'RELATIONSHIPS', label: 'Building source relationships' },
];

// In-memory progress for runs in this server process (the counts are also
// written to WEB_SEARCH_RUNS when the run finishes).
const progress = new Map();
let activeRuns = 0;
const MAX_ACTIVE_RUNS = 2;

export function getProgress(runId) {
  return progress.get(Number(runId)) || null;
}

function setStage(state, key) {
  state.stage = key;
  state.stageIndex = STAGES.findIndex((s) => s.key === key);
  state.updatedAt = new Date().toISOString();
}

const SOCIAL_HOSTS = [
  [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'X'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/^news\.ycombinator\.com$/, 'Hacker News'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram'],
];
const BLOG_HOSTS = /(^|\.)(medium\.com|substack\.com|blogspot\.com|wordpress\.com|tumblr\.com|ghost\.io|hashnode\.dev)$/;
const OFFICIAL_HOSTS = /(\.gov|\.gov\.[a-z]{2}|\.nic\.in|\.mil|(^|\.)who\.int|(^|\.)un\.org|(^|\.)europa\.eu|\.edu|\.ac\.[a-z]{2})$/;

/** Deterministic platform from the host name and page metadata. */
export function platformNameFor(url, page) {
  const host = domainOf(url) || '';
  for (const [re, name] of SOCIAL_HOSTS) if (re.test(host)) return name;
  if (BLOG_HOSTS.test(host) || page?.isBlogPosting || /\/blog(s)?\//i.test(url)) return 'Blog';
  if (OFFICIAL_HOSTS.test(host)) return 'Official Website';
  if (page?.isArticle) return 'News Website';
  return 'Web Page';
}

async function startRun(query) {
  return withTransaction(async (db) => {
    const r = await db.exec(`BEGIN :id := start_web_search_run(:q, :provider); END;`, {
      provider: providerName(),
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      q: query,
    });
    return r.outBinds.id;
  });
}

async function finishRun(runId, c, status, error) {
  await withTransaction((db) =>
    db.exec(
      `BEGIN finish_web_search_run(:id, :received, :fetched, :failed, :inserted, :dups,
                                   :matched, :created, :status, :err); END;`,
      {
        id: runId,
        received: c.resultsReceived,
        fetched: c.pagesFetched,
        failed: c.pagesFailed,
        inserted: c.sourcesInserted,
        dups: c.duplicatesSkipped,
        matched: c.claimsMatched,
        created: c.claimsCreated,
        status,
        err: error ? String(error).slice(0, 1000) : null,
      }
    )
  );
}

async function linkResult(db, runId, sourceId, result, duplicate) {
  await db.exec(
    `BEGIN record_search_result_link(:run, :src, :rank, :provider, :snippet, :dup); END;`,
    { provider: result.provider || providerName(), run: runId, src: sourceId, rank: result.rank, snippet: result.snippet, dup: duplicate ? 'Y' : 'N' }
  );
}

/** Builds the stored item from the search result and (when available) the page. */
function buildItem(result, page) {
  const title = page?.title || result.title;
  return makeItem({
    title,
    url: result.url,
    publisher: page?.publisher || result.publisher || result.domain,
    author: page?.author || null,
    publishedAt: page?.publishedAt || result.publishedAt || null,
    snippet: page?.text || page?.description || result.snippet,
    unknownDate: 'null',
  });
}

/**
 * Runs a complete investigation. Returns the summary. `onStart(runId)` is
 * called as soon as the run row exists (used by the async API mode).
 */
export async function investigateWeb(rawQuery, { onStart } = {}) {
  const query = cleanText(rawQuery, 300);
  if (!query || query.length < 2) {
    throw new ValidationError('Enter a claim, person, event or topic to investigate.');
  }
  if (activeRuns >= MAX_ACTIVE_RUNS) {
    throw new HttpError(429, 'BUSY', 'Another web investigation is still running. Try again in a few seconds.');
  }

  activeRuns += 1;
  const runId = await startRun(query).catch((e) => {
    activeRuns -= 1;
    throw e;
  });
  const counts = {
    resultsReceived: 0, pagesFetched: 0, pagesFailed: 0, sourcesInserted: 0,
    duplicatesSkipped: 0, claimsMatched: 0, claimsCreated: 0, referencesFound: 0, itemErrors: 0,
  };
  const state = {
    searchRunId: runId, query, status: 'RUNNING', stage: null, stageIndex: -1,
    stages: STAGES, counts, startedAt: new Date().toISOString(), webSearchAvailable: isWebSearchConfigured(),
  };
  progress.set(runId, state);
  onStart?.(runId);

  let status = 'SUCCESS';
  let error = null;
  try {
    // 2. Search
    setStage(state, 'SEARCHING');
    const results = await searchWeb(query);
    counts.resultsReceived = results.length;

    // 3. Normalise + in-batch duplicates
    setStage(state, 'NORMALISING');
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      const url = normaliseUrl(r.url);
      if (!url) continue;
      if (seen.has(url)) {
        counts.duplicatesSkipped += 1;
        continue;
      }
      seen.add(url);
      unique.push({ ...r, url });
    }

    // 4. Already stored in Oracle -> link to this run only
    setStage(state, 'DEDUPLICATING');
    const fresh = [];
    const claimIds = new Set();
    await withConnection(async (db) => {
      for (const r of unique) {
        const row = await db.one(`SELECT find_source_id(:u) AS id FROM dual`, { u: r.url });
        if (row?.id) r.existingId = row.id;
      }
    });
    for (const r of unique) {
      if (!r.existingId) {
        fresh.push(r);
        continue;
      }
      counts.duplicatesSkipped += 1;
      await withTransaction((db) => linkResult(db, runId, r.existingId, r, true)).catch(() => {});
    }

    // 5 + 6. Fetch and extract new pages
    setStage(state, 'FETCHING');
    const pages = await mapLimit(fresh, config.webSearch.fetchConcurrency, async (r) => {
      const res = await fetchPage(r.url);
      if (!res.ok) {
        counts.pagesFailed += 1;
        return { failed: res.reason };
      }
      counts.pagesFetched += 1;
      try {
        return extractPage(res.html, res.finalUrl || r.url);
      } catch (e) {
        return { failed: `Extraction failed: ${e.message}` };
      }
    });

    // 7. One transaction per result
    setStage(state, 'MATCHING');
    let dictionary = await withConnection((db) => loadDictionary(db, { force: true }));
    const platforms = await withConnection((db) => db.rows('SELECT platform_id, platform_name FROM platforms'));
    const platformId = (name) => (platforms.find((p) => p.platform_name === name) || platforms.find((p) => p.platform_name === 'Web Page'))?.platform_id;
    const general = await withConnection((db) => db.one(`SELECT category_id FROM categories WHERE category_name = 'General'`));
    const stored = [];

    for (let i = 0; i < fresh.length; i += 1) {
      const r = fresh[i];
      const page = pages[i] && !pages[i].failed && !pages[i].error ? pages[i] : null;
      const item = buildItem(r, page);
      if (!item) continue;
      item.canonicalUrl = page?.canonicalUrl || null;
      item.outboundLinks = page?.outboundLinks || [];
      try {
        const res = await withTransaction(async (db) => {
          const out = await processSourceItem(db, item, {
            platformId: platformId(platformNameFor(item.url, page)),
            categoryId: general?.category_id || 9,
            origin: 'WEB_SEARCH',
            originLabel: 'live web search',
            dictionary,
            requireClaimSignal: true,
          });
          if (out.status === 'SKIPPED') {
            // Stored meanwhile (or same canonical URL): link the stored row
            const row = await db.one(`SELECT find_source_id(:u, :c) AS id FROM dual`, { u: item.url, c: item.canonicalUrl });
            if (row?.id) await linkResult(db, runId, row.id, r, true);
          } else {
            await linkResult(db, runId, out.sourceId, r, false);
          }
          return out;
        });
        if (res.status === 'SKIPPED') {
          counts.duplicatesSkipped += 1;
          continue;
        }
        counts.sourcesInserted += 1;
        counts.referencesFound += res.referencesAdded || 0;
        if (res.claimId) {
          if (res.newClaim) {
            counts.claimsCreated += 1;
            // the new claim's keywords must be visible to the next results
            dictionary = await withConnection((db) => loadDictionary(db, { force: true }));
          }
          else if (!claimIds.has(res.claimId)) counts.claimsMatched += 1;
          claimIds.add(res.claimId);
        }
        stored.push({ sourceId: res.sourceId, item });
      } catch (e) {
        counts.itemErrors += 1;
        error = error || `Result ${r.rank} (${domainOf(r.url)}): ${e.message.split('\n')[0]}`;
        if (e.code === 'DB_UNAVAILABLE') throw e;
      }
    }

    // 8. Links between pages that were stored in this same run
    setStage(state, 'RELATIONSHIPS');
    for (const s of stored) {
      if (!s.item.outboundLinks.length && !s.item.canonicalUrl) continue;
      try {
        await withTransaction(async (db) => {
          const added = await recordReferences(db, s.sourceId, {
            links: s.item.outboundLinks, canonicalUrl: s.item.canonicalUrl, url: s.item.url,
          });
          if (added) {
            counts.referencesFound += added;
            await refreshLineage(db, s.sourceId);
          }
        });
      } catch (e) {
        error = error || `Relationship pass: ${e.message.split('\n')[0]}`;
      }
    }

    // Failed pages still produce sources (search title + snippet), so the run is PARTIAL
    if (counts.itemErrors || counts.pagesFailed) status = 'PARTIAL';
  } catch (e) {
    status = 'FAILED';
    error = e instanceof WebSearchUnavailableError || e.code === 'DB_UNAVAILABLE' ? e.message : `Investigation failed: ${e.message}`;
    if (!(e instanceof WebSearchUnavailableError)) console.error('[web-search]', e);
  } finally {
    activeRuns -= 1;
  }

  await finishRun(runId, counts, status, error).catch((e) => console.error('[web-search] could not close run', e.message));
  state.status = status;
  state.error = error;
  state.stage = 'COMPLETE';
  state.stageIndex = STAGES.length;
  state.completedAt = new Date().toISOString();
  console.log(`[web-search] run ${runId} "${query}": ${status} - ${counts.resultsReceived} results, ${counts.sourcesInserted} new, ${counts.duplicatesSkipped} duplicates, ${counts.pagesFailed} pages failed${error ? ` (${error})` : ''}`);
  // Forget progress after 15 minutes; the run itself stays in Oracle.
  setTimeout(() => progress.delete(runId), 15 * 60 * 1000).unref?.();
  return { searchRunId: runId, query, status, error, ...counts };
}
