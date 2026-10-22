/**
 * Repairs LIVE (non-demo) data stored by earlier versions, using only what is
 * already in Oracle (no web requests, nothing reset, demo data untouched):
 *
 *   0. live sources without a publication date: a date written in the URL,
 *      else the page is fetched once more (same fetcher: robots.txt, timeout,
 *      size limit) and only its stated publication / upload date is kept.
 *      The fetch time is never used as a publication date. Skip the fetch
 *      with  npm run repair -- --no-fetch
 *   1. every live source that has no SOURCE_EVIDENCE, or still sits in an
 *      older title-made claim family (no proposition), is re-read from its
 *      stored page text / search snippet / title: evidence sentences,
 *      structured proposition, proposition-based claim family, variant
 *      (one transaction per source; a failure rolls back that source only)
 *   2. its variant in the title-made family is moved out
 *      (SUPERSEDE_LEGACY_VARIANTS); a family left empty becomes MERGED
 *   3. "according to / via / reported by / citing X" in the stored text of
 *      every live claim source -> ATTRIBUTION references
 *   4. FINALISE_CLAIM_LINEAGE for every live claim family: known upstream
 *      sources, wording parents, Mutation Ledger
 *   5. RECORD_SEARCH_CLAIM_MATCHES for every affected investigation
 *
 * Safe to run more than once: a second run finds nothing left to repair.
 *
 * Usage:  npm run repair            (from the server folder or the root)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initPool, closePool, withConnection, withTransaction, oracledb } from '../db/pool.js';
import { loadDictionary } from '../ingestion/entityMatcher.js';
import { analyseStoredSource, supersedeLegacy } from '../ingestion/sourceProcessor.js';
import { parseQuery } from '../claims/hypothesis.js';
import { makeScorer, detectAttributions } from '../claims/evidence.js';
import { makeEntityHelpers } from '../claims/entities.js';
import { roleCode } from '../claims/lexicon.js';
import { eventObjectKey } from '../claims/canonical.js';
import { dateFromUrl } from '../ingestion/normalizer.js';
import { mapLimit } from '../ingestion/http.js';
import { fetchPage } from '../web-search/pageFetcher.js';
import { extractPage } from '../web-search/pageExtractor.js';
import config from '../config/index.js';

const SNAPSHOT = `
  SELECT (SELECT COUNT(*) FROM claims WHERE claim_origin = 'AUTOMATED' AND status <> 'MERGED') AS live_claims,
         (SELECT COUNT(*) FROM claims c WHERE c.claim_origin = 'AUTOMATED' AND c.status <> 'MERGED'
             AND NOT EXISTS (SELECT 1 FROM claim_propositions p WHERE p.claim_id = c.claim_id)) AS title_made_claims,
         (SELECT COUNT(*) FROM claims WHERE status = 'MERGED') AS merged_claims,
         (SELECT COUNT(*) FROM source_evidence e JOIN sources s ON s.source_id = e.source_id
           WHERE s.origin_type <> 'DEMO') AS live_evidence,
         (SELECT COUNT(*) FROM claim_variants v JOIN claims c ON c.claim_id = v.claim_id
           WHERE c.claim_origin = 'AUTOMATED' AND v.relation_predicate IS NOT NULL) AS structured_variants,
         (SELECT COUNT(*) FROM claim_variants v JOIN claims c ON c.claim_id = v.claim_id
           WHERE c.claim_origin = 'AUTOMATED' AND v.parent_variant_id IS NOT NULL) AS variants_with_parent,
         (SELECT COUNT(*) FROM claim_mutations m JOIN claims c ON c.claim_id = m.claim_id
           WHERE c.claim_origin = 'AUTOMATED') AS live_mutations,
         (SELECT COUNT(*) FROM source_references r JOIN sources s ON s.source_id = r.from_source_id
           WHERE s.origin_type <> 'DEMO') AS live_references,
         (SELECT COUNT(*) FROM sources WHERE origin_type <> 'DEMO' AND derived_from_source_id IS NOT NULL) AS live_known_upstream,
         (SELECT COUNT(*) FROM claim_mutations m JOIN claims c ON c.claim_id = m.claim_id
           WHERE c.claim_origin = 'DEMO') AS demo_mutations
    FROM dual`;

function printSnapshot(label, s) {
  console.log(`\n${label}`);
  console.log(`  live claim families ............ ${s.live_claims} (title-made, no proposition: ${s.title_made_claims}; merged: ${s.merged_claims})`);
  console.log(`  live evidence sentences ........ ${s.live_evidence}`);
  console.log(`  structured live variants ....... ${s.structured_variants}`);
  console.log(`  live variants with a parent .... ${s.variants_with_parent}`);
  console.log(`  live Mutation Ledger rows ...... ${s.live_mutations}`);
  console.log(`  live source references ......... ${s.live_references}`);
  console.log(`  live sources, known upstream ... ${s.live_known_upstream}`);
  console.log(`  demo Mutation Ledger rows ...... ${s.demo_mutations} (unchanged by repair)`);
}

/** 0. Publication dates for undated live sources (URL, then the page's own metadata). */
async function recoverDates({ fetch = true, log }) {
  const undated = await withConnection((db) => db.rows(
    `SELECT source_id, source_url FROM sources
      WHERE origin_type <> 'DEMO' AND published_at IS NULL ORDER BY source_id`
  ));
  const found = await mapLimit(undated, config.webSearch.fetchConcurrency, async (s) => {
    const fromUrl = dateFromUrl(s.source_url);
    if (fromUrl) return { id: s.source_id, date: fromUrl, how: 'URL' };
    if (!fetch) return null;
    const res = await fetchPage(s.source_url).catch(() => ({ ok: false }));
    if (!res.ok) return null;
    try {
      const page = extractPage(res.html, res.finalUrl || s.source_url);
      return page.publishedAt ? { id: s.source_id, date: page.publishedAt, how: 'PAGE' } : null;
    } catch {
      return null;
    }
  });
  const dated = found.filter(Boolean);
  for (const d of dated) {
    await withTransaction((db) => db.exec(
      'UPDATE sources SET published_at = :d WHERE source_id = :id AND published_at IS NULL',
      { d: { val: d.date, type: oracledb.DATE }, id: d.id }
    ));
  }
  log(`Publication dates: ${undated.length} undated live sources; ${dated.filter((d) => d.how === 'URL').length} dated from the URL, `
    + `${dated.filter((d) => d.how === 'PAGE').length} from the page's own metadata${fetch ? '' : ' (page fetch skipped)'}; `
    + `${undated.length - dated.length} remain undated.`);
}

export async function repairLive({ log = console.log, fetch = true } = {}) {
  const before = await withConnection((db) => db.one(SNAPSHOT));
  await recoverDates({ fetch, log });
  let dictionary = await withConnection((db) => loadDictionary(db, { force: true }));

  // 1 + 2. Sources to re-read, with the investigation (query) that found them
  const todo = await withConnection((db) => db.rows(
    `SELECT s.source_id,
            (SELECT MAX(l.search_run_id) FROM search_result_links l WHERE l.source_id = s.source_id) AS run_id
       FROM sources s
      WHERE s.origin_type <> 'DEMO'
        AND (NOT EXISTS (SELECT 1 FROM source_evidence e WHERE e.source_id = s.source_id)
             OR EXISTS (SELECT 1 FROM claim_variants v JOIN claims c ON c.claim_id = v.claim_id
                         WHERE v.source_id = s.source_id
                           AND c.claim_origin = 'AUTOMATED' AND c.status <> 'MERGED'
                           AND NOT EXISTS (SELECT 1 FROM claim_propositions p WHERE p.claim_id = c.claim_id)))
      ORDER BY s.source_id`
  ));
  const general = await withConnection((db) => db.one(`SELECT category_id FROM categories WHERE category_name = 'General'`));
  const runs = new Map();
  const runContext = async (runId) => {
    if (!runId) return { hypothesis: null, query: null };
    if (!runs.has(runId)) {
      const r = await withConnection((db) => db.one('SELECT query_text FROM web_search_runs WHERE search_run_id = :id', { id: runId }));
      const hypothesis = r ? parseQuery(r.query_text, { entityName: makeEntityHelpers(dictionary).entityName }) : null;
      runs.set(runId, { hypothesis, query: r?.query_text || null });
    }
    return runs.get(runId);
  };

  const touchedClaims = new Set();
  const touchedRuns = new Set();
  const tally = { sources: 0, evidence: 0, propositions: 0, variants: 0, superseded: 0, failed: 0 };
  for (const row of todo) {
    const ctx = await runContext(row.run_id);
    try {
      const res = await withTransaction(async (db) => {
        const snippet = await db.one(
          `SELECT result_snippet AS snippet FROM search_result_links WHERE source_id = :id AND result_snippet IS NOT NULL
            ORDER BY search_run_id DESC FETCH FIRST 1 ROWS ONLY`,
          { id: row.source_id }
        );
        const helpers = makeEntityHelpers(dictionary, ctx.hypothesis);
        const scorer = ctx.query ? makeScorer({ hypothesis: ctx.hypothesis, query: ctx.query, aliasesFor: helpers.aliasesFor }) : null;
        return analyseStoredSource(db, row.source_id, {
          categoryId: general?.category_id || 9,
          originLabel: 'live data repair',
          dictionary,
          runId: row.run_id || null,
          hypothesis: ctx.hypothesis,
          scorer,
          searchSnippet: snippet?.snippet || null,
        });
      });
      tally.sources += 1;
      tally.evidence += res.evidenceCount || 0;
      tally.propositions += res.propositions || 0;
      tally.variants += res.variantsAdded || 0;
      tally.superseded += res.superseded || 0;
      for (const c of res.claims || []) touchedClaims.add(c.claimId);
      if (row.run_id) touchedRuns.add(row.run_id);
      if ((res.claims || []).some((c) => c.newClaim)) dictionary = await withConnection((db) => loadDictionary(db, { force: true }));
    } catch (e) {
      tally.failed += 1;
      log(`  source #${row.source_id}: rolled back (${e.message.split('\n')[0]})`);
    }
  }
  log(`Re-read ${tally.sources} stored live sources: ${tally.evidence} evidence sentences, ${tally.propositions} propositions, `
    + `${tally.variants} new variants, ${tally.superseded} title-made variants moved${tally.failed ? `, ${tally.failed} rolled back` : ''}.`);

  // 2a. Sources that already belong to a proposition-based family but still
  //     sit in a title-made family too (e.g. attached by an earlier run):
  //     selected in Oracle, independent of text extraction
  const doubled = await withConnection((db) => db.rows(
    `SELECT DISTINCT v.source_id
       FROM claim_variants v JOIN claims c ON c.claim_id = v.claim_id
      WHERE c.claim_origin = 'AUTOMATED' AND c.status <> 'MERGED'
        AND NOT EXISTS (SELECT 1 FROM claim_propositions p WHERE p.claim_id = v.claim_id)
        AND EXISTS (SELECT 1 FROM claim_variants v2 JOIN claim_propositions p2 ON p2.claim_id = v2.claim_id
                     WHERE v2.source_id = v.source_id)`
  ));
  let moved = 0;
  for (const d of doubled) {
    moved += await withTransaction((db) => supersedeLegacy(db, d.source_id))
      .catch((e) => { log(`  source #${d.source_id}: rolled back (${e.message.split('\n')[0]})`); return 0; });
  }
  if (doubled.length) log(`Moved ${moved} variants of ${doubled.length} sources out of title-made families they shared with a proposition-based family.`);

  // 2b. Proposition object keys for structured variants stored before
  //     migration 13 (the ledger compares objects by this key)
  const unkeyed = await withConnection((db) => db.rows(
    `SELECT variant_id, relation_predicate, relation_object FROM claim_variants
      WHERE relation_predicate IS NOT NULL AND relation_object IS NOT NULL AND relation_object_key IS NULL`
  ));
  for (const v of unkeyed) {
    const key = v.relation_predicate === 'HOLDS_ROLE' ? roleCode(v.relation_object) : eventObjectKey(v.relation_object);
    if (!key) continue;
    await withTransaction((db) => db.exec('UPDATE claim_variants SET relation_object_key = :k WHERE variant_id = :v',
      { k: key.slice(0, 200), v: v.variant_id }));
  }
  if (unkeyed.length) log(`Added proposition object keys to ${unkeyed.length} earlier structured variants.`);

  // 3. Attribution phrases in the stored text of every live claim source
  const claimSources = await withConnection((db) => db.rows(
    `SELECT DISTINCT s.source_id, s.source_title, s.snippet
       FROM sources s JOIN claim_variants v ON v.source_id = s.source_id
       JOIN claims c ON c.claim_id = v.claim_id
      WHERE s.origin_type <> 'DEMO' AND c.status <> 'MERGED'`
  ));
  let refs = 0;
  let phrases = 0;
  for (const s of claimSources) {
    const names = detectAttributions(`${s.source_title || ''}\n${s.snippet || ''}`);
    if (!names.length) continue;
    phrases += names.length;
    await withTransaction(async (db) => {
      for (const name of names) {
        const r = await db.exec(`BEGIN :n := record_attribution_reference(:s, :p); END;`, {
          n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }, s: s.source_id, p: name,
        });
        refs += r.outBinds.n || 0;
      }
    }).catch((e) => log(`  references of source #${s.source_id}: rolled back (${e.message.split('\n')[0]})`));
  }
  log(`Examined ${claimSources.length} live claim sources for attributions: ${phrases} phrases, ${refs} new ATTRIBUTION references.`);

  // 4. Provenance -> parents -> Mutation Ledger for every live family
  const liveClaims = await withConnection((db) => db.rows(
    `SELECT claim_id FROM claims WHERE claim_origin = 'AUTOMATED' AND status <> 'MERGED' ORDER BY claim_id`
  ));
  for (const c of liveClaims) touchedClaims.add(c.claim_id);
  for (const id of touchedClaims) {
    await withTransaction((db) => db.exec('BEGIN finalise_claim_lineage(:id); END;', { id }))
      .catch((e) => log(`  lineage of claim #${id}: rolled back (${e.message.split('\n')[0]})`));
  }
  log(`Finalised lineage and Mutation Ledger of ${touchedClaims.size} live claim families.`);

  // 5. Search-claim relationships of the affected investigations
  for (const runId of touchedRuns) {
    await withTransaction((db) => db.exec('BEGIN record_search_claim_matches(:id); END;', { id: runId }))
      .catch((e) => log(`  matches of run #${runId}: rolled back (${e.message.split('\n')[0]})`));
  }
  log(`Recomputed search-claim matches of ${touchedRuns.size} investigations.`);

  const after = await withConnection((db) => db.one(SNAPSHOT));
  return { before, after, tally, references: refs, claims: touchedClaims.size, runs: touchedRuns.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    await initPool();
    try {
      const out = await repairLive({ fetch: !process.argv.includes('--no-fetch') });
      printSnapshot('Before repair:', out.before);
      printSnapshot('After repair:', out.after);
    } finally {
      await closePool();
    }
  })().catch((err) => {
    console.error(`\nRepair failed: ${err.message}`);
    console.error('Run "npm run db:migrate" first, and check that Oracle is running.');
    process.exit(1);
  });
}
