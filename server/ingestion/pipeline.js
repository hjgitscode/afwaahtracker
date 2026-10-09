/**
 * Automated ingestion pipeline.
 *
 * For each enabled INGESTION_SOURCES row:
 *   1. START_INGESTION_RUN  opens an INGESTION_LOG row          (COMMIT)
 *   2. adapter fetches + normalises items (GDELT / Hacker News / RSS)
 *   3. per item, in ONE transaction, the shared steps in sourceProcessor.js
 *      (deduplicated insert, rule-based matching, evidence-based lineage,
 *      Mutation Ledger via trigger), then COMMIT - or ROLLBACK of that item only
 *   4. FINISH_INGESTION_RUN closes the log row                 (COMMIT)
 *
 * If a source is unreachable the run is logged as FAILED and the
 * application keeps working with the data already stored in Oracle.
 */
import { withConnection, withTransaction, oracledb } from '../db/pool.js';
import { fetchGdelt } from './gdelt.js';
import { fetchHackerNews } from './hackerNews.js';
import { fetchRss } from './rss.js';
import { describeFetchError } from './http.js';
import { loadDictionary } from './entityMatcher.js';
import { processSourceItem } from './sourceProcessor.js';

const ADAPTERS = {
  GDELT: fetchGdelt,
  HACKER_NEWS: fetchHackerNews,
  RSS: fetchRss,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One feed item = one transaction (see sourceProcessor.js for the steps).
function processItem(source, item, dictionary) {
  return withTransaction((db) =>
    processSourceItem(db, item, {
      platformId: source.platform_id,
      ingestionSourceId: source.ingestion_source_id,
      categoryId: source.default_category_id,
      origin: 'AUTOMATED',
      originLabel: source.source_name,
      dictionary,
    })
  );
}

export async function runSource(source) {
  const startedAt = Date.now();
  const logId = await withTransaction(async (db) => {
    const r = await db.exec(`BEGIN :id := start_ingestion_run(:src); END;`, {
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      src: source.ingestion_source_id,
    });
    return r.outBinds.id;
  });

  const counts = { fetched: 0, inserted: 0, skipped: 0, matched: 0, errors: 0 };
  let status = 'SUCCESS';
  let errorMessage = null;

  try {
    const adapter = ADAPTERS[source.source_type];
    if (!adapter) throw new Error(`No adapter for source type ${source.source_type}`);

    const items = await adapter(source);
    counts.fetched = items.length;

    let dictionary = await withConnection((db) => loadDictionary(db));
    // Remove duplicates inside one batch before touching the database
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.url)) {
        counts.skipped += 1;
        continue;
      }
      seen.add(item.url);
      try {
        const res = await processItem(source, item, dictionary);
        if (res.status === 'SKIPPED') counts.skipped += 1;
        else {
          counts.inserted += 1;
          if (res.claimId && !res.newClaim) counts.matched += 1;
          // keywords of a newly created claim must be visible to the next items
          if (res.newClaim) dictionary = await withConnection((db) => loadDictionary(db, { force: true }));
        }
      } catch (err) {
        counts.errors += 1;
        errorMessage = errorMessage || `Item "${item.title.slice(0, 60)}": ${err.message.split('\n')[0]}`;
        if (err.code === 'DB_UNAVAILABLE') throw err;
      }
    }
    if (counts.errors) status = counts.inserted || counts.skipped ? 'PARTIAL' : 'FAILED';
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.code === 'DB_UNAVAILABLE' ? err.message : describeFetchError(err);
  }

  await withTransaction((db) =>
    db.exec(
      `BEGIN finish_ingestion_run(:log_id, :fetched, :inserted, :skipped, :matched, :status, :err); END;`,
      {
        log_id: logId,
        fetched: counts.fetched,
        inserted: counts.inserted,
        skipped: counts.skipped,
        matched: counts.matched,
        status,
        err: errorMessage ? errorMessage.slice(0, 1000) : null,
      }
    )
  ).catch((err) => console.error('[ingestion] could not close log row', err.message));

  const result = {
    ingestionSourceId: source.ingestion_source_id,
    sourceName: source.source_name,
    sourceType: source.source_type,
    logId,
    status,
    ...counts,
    error: errorMessage,
    durationMs: Date.now() - startedAt,
  };
  console.log(
    `[ingestion] ${source.source_name}: ${status} - ${counts.fetched} fetched, ${counts.inserted} new, ${counts.skipped} duplicates${errorMessage ? ` (${errorMessage})` : ''}`
  );
  return result;
}

/**
 * Run all enabled sources. With `force` every enabled source runs;
 * otherwise only those whose fetch interval has elapsed.
 */
export async function runIngestion({ force = false, sourceIds = null } = {}) {
  const sources = await withConnection((db) =>
    db.rows(
      `SELECT ingestion_source_id, source_name, source_type, endpoint_url, platform_id,
              default_category_id, max_items, fetch_interval_minutes, last_fetched_at
         FROM ingestion_sources
        WHERE enabled = 'Y'
          AND (:force = 1
               OR last_fetched_at IS NULL
               OR last_fetched_at <= SYSTIMESTAMP - NUMTODSINTERVAL(fetch_interval_minutes - 1, 'MINUTE'))
        ORDER BY source_type, ingestion_source_id`,
      { force: force ? 1 : 0 }
    )
  );

  const selected = sourceIds ? sources.filter((s) => sourceIds.includes(s.ingestion_source_id)) : sources;
  const results = [];
  let lastGdelt = 0;
  for (const source of selected) {
    // GDELT asks clients to leave ~5 seconds between requests
    if (source.source_type === 'GDELT') {
      const wait = 5500 - (Date.now() - lastGdelt);
      if (lastGdelt && wait > 0) await sleep(wait);
      lastGdelt = Date.now();
    }
    results.push(await runSource(source));
  }
  return results;
}
