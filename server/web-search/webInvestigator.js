/**
 * Live web investigation (on-demand "INVESTIGATE WEB").
 *
 *   1. START_WEB_SEARCH_RUN + investigation hypothesis        (COMMIT)
 *      ("Is GV Selvam director of VIT?" -> G. V. Selvam | HOLDS_ROLE |
 *      Director | VIT). The hypothesis is never stored as a claim.
 *   2. web search provider (Tavily) -> one request -> publicly indexed results
 *   3. normalise URLs, drop duplicates inside the batch
 *   4. duplicates already in Oracle are linked to the run, not re-stored or
 *      refetched; their stored text is re-read for this hypothesis
 *   5. fetch new public pages (bounded concurrency, timeout, size limit);
 *      a failed page falls back to the search title + snippet
 *   6. extract title / publisher / author / date / text / canonical / links
 *   7. per result, ONE transaction: store source, evidence sentences,
 *      structured proposition, claim family, variant, Mutation Ledger,
 *      references (see ingestion/sourceProcessor.js)
 *   8. provenance pass over every source of the run: hyperlinks, canonical
 *      links and "according to / via / reported by / citing X" attributions
 *      -> SOURCE_REFERENCES (only to a stored source in the same family)
 *   8b. FINALISE_CLAIM_LINEAGE per touched family: known upstream sources,
 *      wording parents in publication order, Mutation Ledger rebuilt
 *   9. RECORD_SEARCH_CLAIM_MATCHES: how each claim family found relates to
 *      the hypothesis (EXACT / DIFFERENT_VALUE / RELATED / TOPICAL)
 *  10. FINISH_WEB_SEARCH_RUN with the counts                  (COMMIT)
 * Every stage writes one SEARCH_RUN_STAGES row (items examined, rows written)
 * so a zero can be told apart from a stage that never ran.
 *
 * Without TAVILY_API_KEY the run is recorded as FAILED with a clear
 * message, and the caller still shows the sources stored in Oracle.
 */
import { withConnection, withTransaction, oracledb } from '../db/pool.js';
import config from '../config/index.js';
import { HttpError, ValidationError } from '../middleware/errors.js';
import { mapLimit } from '../ingestion/http.js';
import { normaliseUrl, makeItem, domainOf, cleanText, dateFromUrl } from '../ingestion/normalizer.js';
import { loadDictionary } from '../ingestion/entityMatcher.js';
import { processSourceItem, analyseStoredSource, recordReferences, refreshLineage, recordStatedAttribution } from '../ingestion/sourceProcessor.js';
import { parseQuery } from '../claims/hypothesis.js';
import { makeScorer, detectAttributionPhrases } from '../claims/evidence.js';
import { makeEntityHelpers } from '../claims/entities.js';
import { roleCode } from '../claims/lexicon.js';
import { eventObjectKey } from '../claims/canonical.js';
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

async function saveHypothesis(runId, h) {
  await withTransaction((db) =>
    db.exec(
      `UPDATE web_search_runs
          SET query_type = :qt, hypothesis_text = :txt, hypothesis_claim_type = :ct,
              hypothesis_subject = :subj, hypothesis_predicate = :pred,
              hypothesis_object = :obj, hypothesis_qualifier = :qual
        WHERE search_run_id = :id`,
      {
        id: runId, qt: h.queryType, txt: h.text, ct: h.claimType,
        subj: h.subject, pred: h.predicate, obj: h.object, qual: h.qualifier,
      }
    )
  );
}

/**
 * After the run: resolve the hypothesis to entity keys (now that the run may
 * have created entities from evidence) and let Oracle relate every claim
 * family found to it (RECORD_SEARCH_CLAIM_MATCHES).
 */
async function recordClaimMatches(runId, h) {
  await withTransaction(async (db) => {
    const key = async (text, type, acronym) => {
      if (!text) return null;
      const r = await db.exec(`BEGIN :id := resolve_entity(:t, :ty, 'N', :acr); END;`, {
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }, t: text, ty: type, acr: acronym || null,
      });
      return r.outBinds.id ? `E${r.outBinds.id}` : null;
    };
    const subjectKey = await key(h.subject, h.subjectType || 'PERSON');
    const qualifierKey = await key(h.qualifier, h.qualifierType || 'ORGANISATION', h.qualifier);
    let objectKey = null;
    if (h.predicate === 'HOLDS_ROLE') objectKey = roleCode(h.object);
    else if (h.objectType) objectKey = (await key(h.object, h.objectType)) || eventObjectKey(h.object);
    else if (h.object) objectKey = eventObjectKey(h.object);
    await db.exec(
      `UPDATE web_search_runs
          SET hypothesis_subject_key = :sk, hypothesis_object_key = :ok, hypothesis_qualifier_key = :qk
        WHERE search_run_id = :id`,
      { id: runId, sk: subjectKey, ok: objectKey, qk: qualifierKey }
    );
    await db.exec(`BEGIN record_search_claim_matches(:id); END;`, { id: runId });
  });
}

/** One SEARCH_RUN_STAGES row: what a stage examined and what it wrote. */
async function recordStage(runId, stage, examined, written, detail = null) {
  await withTransaction((db) =>
    db.exec(`BEGIN record_run_stage(:id, :stage, :ex, :wr, :detail); END;`, {
      id: runId, stage, ex: examined || 0, wr: written || 0, detail,
    })
  ).catch((e) => console.error('[web-search] stage', stage, e.message));
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
    publishedAt: page?.publishedAt || result.publishedAt || dateFromUrl(result.url),
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
  let hypothesis = null;
  try {
    // 1b. What is being investigated (deterministic query parsing)
    let dictionary = await withConnection((db) => loadDictionary(db, { force: true }));
    hypothesis = parseQuery(query, { entityName: makeEntityHelpers(dictionary).entityName });
    state.hypothesis = hypothesis;
    await saveHypothesis(runId, hypothesis);

    // 2. Search
    setStage(state, 'SEARCHING');
    const results = await searchWeb(query);
    counts.resultsReceived = results.length;
    await recordStage(runId, 'SEARCH', 1, results.length, `${providerName()} returned ${results.length} results`);

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
    await withConnection(async (db) => {
      for (const r of unique) {
        const row = await db.one(`SELECT find_source_id(:u) AS id FROM dual`, { u: r.url });
        if (row?.id) r.existingId = row.id;
      }
    });
    for (const r of unique) {
      if (!r.existingId) fresh.push(r);
      else counts.duplicatesSkipped += 1;
    }
    await recordStage(runId, 'NORMALISE', results.length, unique.length,
      `${unique.length} unique URLs; ${unique.length - fresh.length} already stored in Oracle`);

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

    await recordStage(runId, 'FETCH', fresh.length, counts.pagesFetched,
      `${counts.pagesFetched} pages fetched; ${counts.pagesFailed} fell back to the search title and snippet`);

    // 7. One transaction per result
    setStage(state, 'MATCHING');
    const tally = { sources: 0, evidence: 0, sentences: 0, propositions: 0, variants: 0, superseded: 0, linkRefs: 0 };
    const runSources = []; // every source of this run, for the provenance pass
    const addTally = (res) => {
      tally.sources += 1;
      tally.evidence += res.evidenceCount || 0;
      tally.sentences += res.sentencesExamined || 0;
      tally.propositions += res.propositions || 0;
      tally.variants += res.variantsAdded || 0;
      tally.superseded += res.superseded || 0;
    };
    const helpers = makeEntityHelpers(dictionary, hypothesis);
    const scorer = makeScorer({ hypothesis, query, aliasesFor: helpers.aliasesFor });
    const claimIds = new Set();
    const noteClaims = async (claims) => {
      for (const c of claims || []) {
        if (c.newClaim) counts.claimsCreated += 1;
        else if (!claimIds.has(c.claimId)) counts.claimsMatched += 1;
        claimIds.add(c.claimId);
      }
      // entities created from evidence must be visible to the next results
      if ((claims || []).some((c) => c.newClaim)) dictionary = await withConnection((db) => loadDictionary(db, { force: true }));
    };
    const platforms = await withConnection((db) => db.rows('SELECT platform_id, platform_name FROM platforms'));
    const platformId = (name) => (platforms.find((p) => p.platform_name === name) || platforms.find((p) => p.platform_name === 'Web Page'))?.platform_id;
    const general = await withConnection((db) => db.one(`SELECT category_id FROM categories WHERE category_name = 'General'`));
    const baseOptions = () => ({
      categoryId: general?.category_id || 9,
      originLabel: 'live web search',
      dictionary,
      runId,
      hypothesis,
      scorer,
    });

    // Already stored sources: linked to this run and re-read for this hypothesis
    for (const r of unique.filter((u) => u.existingId)) {
      try {
        const res = await withTransaction(async (db) => {
          await linkResult(db, runId, r.existingId, r, true);
          return analyseStoredSource(db, r.existingId, { ...baseOptions(), searchSnippet: r.snippet });
        });
        addTally(res);
        runSources.push({ sourceId: r.existingId, item: null, searchSnippet: r.snippet });
        await noteClaims(res.claims);
      } catch (e) {
        counts.itemErrors += 1;
        error = error || `Stored result ${r.rank}: ${e.message.split('\n')[0]}`;
        if (e.code === 'DB_UNAVAILABLE') throw e;
      }
    }

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
            ...baseOptions(),
            platformId: platformId(platformNameFor(item.url, page)),
            origin: 'WEB_SEARCH',
            page,
            searchSnippet: r.snippet,
          });
          if (out.status === 'SKIPPED') {
            // Stored meanwhile (or same canonical URL): link and re-read the stored row
            const row = await db.one(`SELECT find_source_id(:u, :c) AS id FROM dual`, { u: item.url, c: item.canonicalUrl });
            if (row?.id) {
              await linkResult(db, runId, row.id, r, true);
              Object.assign(out, await analyseStoredSource(db, row.id, { ...baseOptions(), searchSnippet: r.snippet }), { sourceId: row.id });
            }
          } else {
            await linkResult(db, runId, out.sourceId, r, false);
          }
          return out;
        });
        await noteClaims(res.claims);
        addTally(res);
        tally.linkRefs += res.linkReferences || 0;
        if (res.status === 'SKIPPED') {
          counts.duplicatesSkipped += 1;
          if (res.sourceId) runSources.push({ sourceId: res.sourceId, item: null, searchSnippet: r.snippet });
          continue;
        }
        counts.sourcesInserted += 1;
        counts.referencesFound += res.referencesAdded || 0;
        runSources.push({ sourceId: res.sourceId, item, searchSnippet: r.snippet });
      } catch (e) {
        counts.itemErrors += 1;
        error = error || `Result ${r.rank} (${domainOf(r.url)}): ${e.message.split('\n')[0]}`;
        if (e.code === 'DB_UNAVAILABLE') throw e;
      }
    }

    await recordStage(runId, 'EVIDENCE', tally.sources, tally.evidence,
      `${tally.evidence} evidence sentences selected from ${tally.sources} sources (SOURCE_EVIDENCE)`);
    await recordStage(runId, 'PROPOSITIONS', tally.sentences, tally.propositions,
      `${tally.propositions} structured propositions extracted from ${tally.sentences} evidence sentences`);
    await recordStage(runId, 'VARIANTS', tally.propositions, tally.variants,
      `${tally.variants} new claim variants; ${claimIds.size} claim families touched`);
    await recordStage(runId, 'SUPERSEDE', tally.sources, tally.superseded,
      `${tally.superseded} variants moved out of older title-made families`);

    // 8. Provenance for EVERY source of the run (new and already stored):
    //    hyperlinks and canonical links between pages stored in this run, and
    //    "according to X" / "via X" / "reported by X" ... in the stored page
    //    text, the search snippet and the title, now that the whole run is in
    //    Oracle (a credited publisher may have been stored after the citing page)
    setStage(state, 'RELATIONSHIPS');
    let refsAdded = tally.linkRefs;
    let attributionNames = 0;
    for (const s of runSources) {
      try {
        await withTransaction(async (db) => {
          let added = 0;
          if (s.item && (s.item.outboundLinks.length || s.item.canonicalUrl)) {
            added += await recordReferences(db, s.sourceId, {
              links: s.item.outboundLinks, canonicalUrl: s.item.canonicalUrl, url: s.item.url,
            });
          }
          const src = await db.one('SELECT source_title, snippet FROM sources WHERE source_id = :id', { id: s.sourceId });
          const credits = detectAttributionPhrases([src?.source_title, src?.snippet, s.searchSnippet].filter(Boolean).join('\n'));
          attributionNames += credits.length;
          for (const a of credits) added += await recordStatedAttribution(db, s.sourceId, a, runId);
          if (added) {
            refsAdded += added;
            counts.referencesFound += added;
            await refreshLineage(db, s.sourceId);
          }
        });
      } catch (e) {
        error = error || `Relationship pass: ${e.message.split('\n')[0]}`;
      }
    }
    const refRows = await withConnection((db) => db.one(
      `SELECT COUNT(*) AS n FROM source_references
        WHERE from_source_id IN (SELECT source_id FROM search_result_links WHERE search_run_id = :id)`,
      { id: runId }
    )).catch(() => null);
    await recordStage(runId, 'REFERENCES', runSources.length, refRows ? refRows.n : refsAdded,
      `Hyperlinks, canonical links and ${attributionNames} attribution phrases examined; `
      + `${refRows ? refRows.n : refsAdded} SOURCE_REFERENCES rows from this run's sources (${refsAdded} added in this pass)`);

    // 8b. Per touched claim family, in Oracle (FINALISE_CLAIM_LINEAGE):
    //     known upstream sources -> wording parents in publication order ->
    //     Mutation Ledger rebuilt from the final parent links
    const touched = [...claimIds];
    for (const claimId of touched) {
      await withTransaction((db) => db.exec('BEGIN finalise_claim_lineage(:id); END;', { id: claimId }))
        .catch((e) => { error = error || `Lineage pass: ${e.message.split('\n')[0]}`; });
    }
    if (touched.length) {
      const list = `SELECT column_value FROM TABLE(sys.odcinumberlist(${touched.map(Number).join(',')}))`;
      const fam = await withConnection(async (db) => ({
        ...(await db.one(
          `SELECT COUNT(DISTINCT v.source_id) AS sources,
                  COUNT(DISTINCT CASE WHEN s.derived_from_source_id IS NOT NULL THEN v.source_id END) AS upstream,
                  COUNT(CASE WHEN v.parent_variant_id IS NOT NULL THEN 1 END) AS parents,
                  COUNT(DISTINCT CASE WHEN s.published_at IS NOT NULL THEN v.source_id END) AS dated
             FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
            WHERE v.claim_id IN (${list})`
        )),
        mutations: (await db.one(`SELECT COUNT(*) AS n FROM claim_mutations WHERE claim_id IN (${list})`)).n,
      })).catch((e) => {
        error = error || `Stage counts: ${e.message.split('\n')[0]}`;
        return null;
      });
      if (fam) {
        await recordStage(runId, 'PROVENANCE', fam.sources, fam.upstream,
          `${fam.upstream} of ${fam.sources} sources in the touched families have a known upstream source`);
        await recordStage(runId, 'LINEAGE', touched.length, fam.parents,
          `${fam.parents} variants have a parent; ${fam.dated} of ${fam.sources} sources have a publication date`);
        await recordStage(runId, 'MUTATIONS', touched.length, fam.mutations,
          `GENERATE_MUTATION_LEDGER rebuilt for ${touched.length} claim families`);
      }
    } else {
      await recordStage(runId, 'PROVENANCE', 0, 0, 'No claim family was touched by this run');
      await recordStage(runId, 'LINEAGE', 0, 0, 'No claim family was touched by this run');
      await recordStage(runId, 'MUTATIONS', 0, 0, 'No claim family was touched by this run');
    }

    // 9. Relate the claim families found to what was asked (in Oracle)
    await recordClaimMatches(runId, hypothesis);
    const m = await withConnection((db) => db.one('SELECT COUNT(*) AS n FROM search_claim_matches WHERE search_run_id = :id', { id: runId }))
      .catch(() => null);
    await recordStage(runId, 'MATCHES', touched.length, m?.n || 0, `${m?.n || 0} SEARCH_CLAIM_MATCHES rows`);

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
  return { searchRunId: runId, query, status, error, hypothesis, ...counts };
}
