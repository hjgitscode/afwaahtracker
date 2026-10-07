/**
 * Automated ingestion pipeline.
 *
 * For each enabled INGESTION_SOURCES row:
 *   1. START_INGESTION_RUN  opens an INGESTION_LOG row          (COMMIT)
 *   2. adapter fetches + normalises items (GDELT / Hacker News / RSS)
 *   3. per item, in ONE transaction:
 *        INGEST_SOURCE      deduplicated insert (0 = duplicate -> skipped)
 *        rule-based analysis (entities, keywords, certainty, action)
 *        FIND best claim    candidate retrieval in SQL, weighted score
 *        ADD_CLAIM_VARIANT  attach to an existing claim or a new CANDIDATE claim
 *        link entities / keywords / entity candidates
 *      COMMIT, or ROLLBACK if anything fails for that item
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
import { loadDictionary, detectEntities, detectKnownKeywords, detectEntityCandidates } from './entityMatcher.js';
import { detectCertainty, detectAction, detectQuantity, frequentTerms, findBestClaim, classify, describeBreakdown } from './matcher.js';

const ADAPTERS = {
  GDELT: fetchGdelt,
  HACKER_NEWS: fetchHackerNews,
  RSS: fetchRss,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function analyseItem(item, dictionary) {
  // Entities and keywords come from the headline only; snippets are often
  // boilerplate and would add unrelated entities to the comparison.
  const entities = detectEntities(item.title, dictionary);
  const keywords = detectKnownKeywords(item.title, dictionary);
  const firstOf = (type) => entities.find((e) => e.type === type)?.name || null;
  return {
    title: item.title,
    publishedAt: item.publishedAt,
    entities,
    keywords,
    certainty: detectCertainty(item.title),
    action: detectAction(item.title),
    quantity: detectQuantity(item.title),
    actor: firstOf('PERSON') || firstOf('ORGANISATION'),
    location: firstOf('LOCATION'),
    event: firstOf('EVENT'),
    autoTerms: frequentTerms(item.title, entities.map((e) => e.alias).concat(keywords.map((k) => k.text))),
    candidates: detectEntityCandidates(item.title, entities),
  };
}

async function processItem(source, item, dictionary) {
  return withTransaction(async (db) => {
    // 1. Deduplicated insert (PL/SQL function, bind variables only)
    const ins = await db.exec(
      `BEGIN
         :id := ingest_source(:platform_id, :ingestion_source_id, :publisher, :author, :title,
                              :url, :linked_url, :external_id, :published_at, :snippet, :engagement);
       END;`,
      {
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        platform_id: source.platform_id,
        ingestion_source_id: source.ingestion_source_id,
        publisher: item.publisher,
        author: item.author,
        title: item.title,
        url: item.url,
        linked_url: item.linkedUrl,
        external_id: item.externalId,
        published_at: { val: item.publishedAt, type: oracledb.DATE },
        snippet: item.snippet,
        engagement: item.engagement,
      }
    );
    const sourceId = ins.outBinds.id;
    if (!sourceId) return { status: 'SKIPPED' };

    // 2. Deterministic analysis + 3. rule-based matching
    const analysis = analyseItem(item, dictionary);
    const best = await findBestClaim(db, analysis);
    const bestScore = best ? best.score.total : 0;
    const method = best ? classify(bestScore) : 'NEW_CLAIM';

    let claimId;
    let parentVariantId = null;
    let lineageBasis = 'NONE';
    let breakdown;

    if (method === 'NEW_CLAIM') {
      const created = await db.exec(
        `INSERT INTO claims (canonical_claim, category_id, status, claim_origin, summary)
         VALUES (:text, :category_id, 'CANDIDATE', 'AUTOMATED', :summary)
         RETURNING claim_id INTO :claim_id`,
        {
          text: item.title.slice(0, 500),
          category_id: source.default_category_id,
          summary: `Candidate claim created automatically from ${source.source_name}.`,
          claim_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }
      );
      claimId = created.outBinds.claim_id[0];
      // Only fields that can be inferred deterministically are filled;
      // sentiment, emotional hook and manipulation marker stay NULL.
      await db.exec(
        `INSERT INTO fingerprints (claim_id, core_assertion, source_pattern, notes, is_curated)
         VALUES (:claim_id, :core, :pattern, :notes, 'N')`,
        {
          claim_id: claimId,
          core: item.title.slice(0, 500),
          pattern: `Automatically ingested from ${source.source_type.replace('_', ' ')}`,
          notes: 'Not yet curated. Only deterministic fields were filled automatically.',
        }
      );
      breakdown = best
        ? `New claim. Best existing match was claim #${best.claimId} at ${bestScore} (${describeBreakdown(best.score.parts)}).`
        : 'New claim. No existing claim shared an entity or keyword.';
    } else {
      claimId = best.claimId;
      breakdown = describeBreakdown(best.score.parts);
      // Wording lineage for automated matches is anchored to the claim's
      // earliest variant (documented as AUTO_ROOT, not as copying).
      const root = await db.one(
        `SELECT v.variant_id
           FROM claim_variants v
           JOIN sources s ON s.source_id = v.source_id
          WHERE v.claim_id = :claim_id
          ORDER BY s.published_at, v.variant_id
          FETCH FIRST 1 ROWS ONLY`,
        { claim_id: claimId }
      );
      if (root) {
        parentVariantId = root.variant_id;
        lineageBasis = 'AUTO_ROOT';
      }
    }

    // 4. Variant via PL/SQL procedure (trigger generates the Mutation Ledger)
    await db.exec(
      `BEGIN
         add_claim_variant(
           p_claim_id => :claim_id, p_source_id => :source_id, p_parent_variant_id => :parent_id,
           p_variant_text => :text, p_actor => :actor, p_action => :action,
           p_target_object => NULL, p_location_name => :location, p_event_name => :event,
           p_claimed_date => NULL, p_quantity_value => :quantity, p_certainty => :certainty,
           p_attribution => :attribution, p_match_score => :score, p_match_method => :method,
           p_lineage_basis => :basis, p_match_breakdown => :breakdown, o_variant_id => :variant_id);
       END;`,
      {
        claim_id: claimId,
        source_id: sourceId,
        parent_id: parentVariantId,
        text: item.title.slice(0, 1000),
        actor: analysis.actor,
        action: analysis.action,
        location: analysis.location,
        event: analysis.event,
        quantity: analysis.quantity,
        certainty: analysis.certainty,
        attribution: item.publisher,
        score: bestScore,
        method,
        basis: lineageBasis,
        breakdown: breakdown.slice(0, 400),
        variant_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );

    // 5. Entity / keyword links (MERGE procedures) and unknown-entity candidates
    for (const ent of analysis.entities) {
      await db.exec(`BEGIN link_claim_entity(:claim_id, :entity_id, 'DICTIONARY'); END;`, { claim_id: claimId, entity_id: ent.entityId });
    }
    const keywordTexts = new Set(analysis.keywords.map((k) => k.text));
    if (method === 'NEW_CLAIM') analysis.autoTerms.forEach((t) => keywordTexts.add(t));
    for (const kw of keywordTexts) {
      await db.exec(`BEGIN link_claim_keyword(:claim_id, :kw, 'AUTO'); END;`, { claim_id: claimId, kw });
    }
    for (const cand of analysis.candidates) {
      await db.exec(`BEGIN record_entity_candidate(:text, :source_id); END;`, { text: cand, source_id: sourceId });
    }

    return { status: 'INSERTED', matched: method !== 'NEW_CLAIM', sourceId, claimId, method, score: bestScore };
  });
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

    const dictionary = await withConnection((db) => loadDictionary(db));
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
          if (res.matched) counts.matched += 1;
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
