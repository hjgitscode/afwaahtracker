/**
 * One code path for storing and analysing a single source, shared by the
 * background feeds (GDELT / Hacker News / RSS) and live web investigation.
 * The caller wraps each call in ONE transaction (withTransaction), so a
 * failure rolls back only that item.
 *
 *   1. INGEST_SOURCE            deduplicated insert (0 = already stored)
 *   2. explicit references      hyperlinks / canonical URL that point at
 *                               stored sources -> SOURCE_REFERENCES
 *   3. rule-based analysis      entities, keywords, certainty, action ...
 *   4. FIND best claim          weighted score 40/30/10/10/5/5
 *   5. CHOOSE_VARIANT_PARENT    explicit reference > inferred predecessor > none
 *   6. ADD_CLAIM_VARIANT        trigger writes the Mutation Ledger
 *   7. APPLY_SOURCE_DEPENDENCE  known upstream source, explicit evidence only
 *   8. entity / keyword links (new claims and strong matches only)
 */
import { oracledb } from '../db/pool.js';
import { detectEntities, detectKnownKeywords, detectEntityCandidates } from './entityMatcher.js';
import {
  detectCertainty, detectAction, detectQuantity, frequentTerms, findBestClaim, classify, describeBreakdown,
} from './matcher.js';
import { significantTokens } from './normalizer.js';

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

/**
 * Does a headline state something specific enough to start a claim family?
 * Used for web results so that broad explainers ("What is climate change?")
 * are stored as related sources instead of being forced into new claims.
 * Rule: an action verb, a quantity or a stated certainty, plus at least one
 * dictionary entity or three significant words.
 */
export function hasClaimSignal(analysis) {
  const structure = Boolean(analysis.action || analysis.quantity || analysis.certainty !== 'UNSTATED');
  const subject = analysis.entities.length > 0 || significantTokens(analysis.title).length >= 3;
  return structure && subject;
}

/** Resolve normalised URLs to stored SOURCE_IDs (one indexed query per 100 URLs). */
export async function resolveStoredUrls(db, urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  const found = new Map();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const binds = {};
    const list = chunk.map((u, j) => {
      binds[`u${j}`] = u;
      return `:u${j}`;
    }).join(', ');
    const rows = await db.rows(
      `SELECT source_id, source_url, canonical_url FROM sources
        WHERE source_url IN (${list}) OR canonical_url IN (${list})`,
      binds
    );
    for (const r of rows) {
      if (chunk.includes(r.source_url)) found.set(r.source_url, r.source_id);
      if (r.canonical_url && chunk.includes(r.canonical_url)) found.set(r.canonical_url, r.source_id);
    }
  }
  return found;
}

/**
 * Records explicit references from `sourceId`:
 *   HYPERLINK            an outbound link on the page equals a stored source URL
 *   CANONICAL_REFERENCE  the page's canonical URL is a different stored source
 * Topical similarity never creates a reference. Returns the number of new rows.
 */
export async function recordReferences(db, sourceId, { links = [], canonicalUrl = null, url = null }) {
  const targets = [];
  const stored = await resolveStoredUrls(db, [...links, canonicalUrl]);
  for (const link of links) {
    const to = stored.get(link);
    if (to && to !== sourceId) targets.push({ to, type: 'HYPERLINK', basis: `Page links to ${link.slice(0, 300)}` });
  }
  if (canonicalUrl && canonicalUrl !== url) {
    const to = stored.get(canonicalUrl);
    if (to && to !== sourceId) targets.push({ to, type: 'CANONICAL_REFERENCE', basis: `Canonical URL is ${canonicalUrl.slice(0, 300)}` });
  }
  let added = 0;
  for (const t of targets) {
    const r = await db.exec(
      `BEGIN :n := record_source_reference(:from_id, :to_id, :type, :basis); END;`,
      { n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }, from_id: sourceId, to_id: t.to, type: t.type, basis: t.basis }
    );
    added += r.outBinds.n || 0;
  }
  return added;
}

async function chooseParent(db, claimId, sourceId, text) {
  const r = await db.exec(
    `BEGIN choose_variant_parent(p_claim_id => :claim_id, p_source_id => :source_id, p_variant_text => :text,
                                 o_parent_variant_id => :parent, o_basis => :basis, o_similarity => :sim); END;`,
    {
      claim_id: claimId,
      source_id: sourceId,
      text,
      parent: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      basis: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 20 },
      sim: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );
  return { parentId: r.outBinds.parent, basis: r.outBinds.basis || 'NONE', similarity: r.outBinds.sim };
}

export async function applySourceDependence(db, sourceId) {
  const r = await db.exec(`BEGIN :up := apply_source_dependence(:id); END;`, {
    up: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    id: sourceId,
  });
  return r.outBinds.up;
}

/** Re-evaluate one stored source after new references were found for it. */
export async function refreshLineage(db, sourceId) {
  const upstream = await applySourceDependence(db, sourceId);
  const variants = await db.rows(
    `SELECT variant_id, claim_id, variant_text, parent_variant_id, lineage_basis
       FROM claim_variants
      WHERE source_id = :id AND lineage_basis IN ('NONE','LEXICAL_PREDECESSOR','AUTO_ROOT')`,
    { id: sourceId }
  );
  for (const v of variants) {
    const choice = await chooseParent(db, v.claim_id, sourceId, v.variant_text);
    if (choice.basis === 'EXPLICIT_REFERENCE' && choice.parentId !== v.parent_variant_id && choice.parentId !== v.variant_id) {
      await db.exec(
        `UPDATE claim_variants SET parent_variant_id = :p, lineage_basis = 'EXPLICIT_REFERENCE' WHERE variant_id = :v`,
        { p: choice.parentId, v: v.variant_id }
      );
    }
  }
  return upstream;
}

/**
 * Store and analyse one normalised item.
 *
 * options:
 *   platformId, ingestionSourceId, categoryId
 *   origin              'AUTOMATED' (feeds) | 'WEB_SEARCH'
 *   originLabel         text used in the fingerprint / audit, e.g. "Hacker News"
 *   dictionary          from loadDictionary()
 *   requireClaimSignal  when true, a weak headline that matches no claim is
 *                       stored as a related source without a claim family
 */
export async function processSourceItem(db, item, options) {
  const {
    platformId, ingestionSourceId = null, categoryId, origin = 'AUTOMATED',
    originLabel = 'automated source', dictionary, requireClaimSignal = false,
  } = options;

  const ins = await db.exec(
    `BEGIN
       :id := ingest_source(:platform_id, :ingestion_source_id, :publisher, :author, :title,
                            :url, :linked_url, :external_id, :published_at, :snippet, :engagement,
                            :origin, :canonical_url);
     END;`,
    {
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      platform_id: platformId,
      ingestion_source_id: ingestionSourceId,
      publisher: item.publisher,
      author: item.author,
      title: item.title,
      url: item.url,
      linked_url: item.linkedUrl,
      external_id: item.externalId,
      published_at: { val: item.publishedAt || null, type: oracledb.DATE },
      snippet: item.snippet,
      engagement: item.engagement,
      origin,
      canonical_url: item.canonicalUrl || null,
    }
  );
  const sourceId = ins.outBinds.id;
  if (!sourceId) return { status: 'SKIPPED' };

  // Explicit references to sources that are already stored
  const referencesAdded = await recordReferences(db, sourceId, {
    links: item.outboundLinks || [],
    canonicalUrl: item.canonicalUrl,
    url: item.url,
  });

  const analysis = analyseItem(item, dictionary);
  const best = await findBestClaim(db, analysis);
  const bestScore = best ? best.score.total : 0;
  const method = best ? classify(bestScore) : 'NEW_CLAIM';

  if (method === 'NEW_CLAIM' && requireClaimSignal && !hasClaimSignal(analysis)) {
    // Stored and searchable, but not forced into a claim family.
    for (const cand of analysis.candidates) {
      await db.exec(`BEGIN record_entity_candidate(:text, :source_id); END;`, { text: cand, source_id: sourceId });
    }
    return { status: 'INSERTED', sourceId, claimId: null, method: 'UNMATCHED', score: bestScore, referencesAdded };
  }

  let claimId;
  let breakdown;
  if (method === 'NEW_CLAIM') {
    const created = await db.exec(
      `INSERT INTO claims (canonical_claim, category_id, status, claim_origin, summary)
       VALUES (:text, :category_id, 'CANDIDATE', 'AUTOMATED', :summary)
       RETURNING claim_id INTO :claim_id`,
      {
        text: item.title.slice(0, 500),
        category_id: categoryId,
        summary: `Candidate claim created automatically from ${originLabel}.`.slice(0, 1000),
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
        pattern: `First retrieved from ${originLabel}`.slice(0, 200),
        notes: 'Not yet curated. Only deterministic fields were filled automatically.',
      }
    );
    breakdown = best
      ? `New claim. Best existing match was claim #${best.claimId} at ${bestScore} (${describeBreakdown(best.score.parts)}).`
      : 'New claim. No existing claim shared an entity or keyword.';
  } else {
    claimId = best.claimId;
    breakdown = describeBreakdown(best.score.parts);
  }

  // Wording parent: explicit reference > inferred (lexical) predecessor > none
  const parent = method === 'NEW_CLAIM'
    ? { parentId: null, basis: 'NONE' }
    : await chooseParent(db, claimId, sourceId, item.title.slice(0, 1000));

  const added = await db.exec(
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
      parent_id: parent.parentId,
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
      basis: parent.basis,
      breakdown: breakdown.slice(0, 400),
      variant_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );

  // Known upstream source (explicit evidence in the same claim family only)
  const upstream = await applySourceDependence(db, sourceId);

  // Only new claims and strong matches extend the claim's entities/keywords.
  // A candidate match is attached but must not widen the family, otherwise
  // loosely related items would gradually pull more unrelated items in.
  if (method !== 'RULE_CANDIDATE') {
    for (const ent of analysis.entities) {
      await db.exec(`BEGIN link_claim_entity(:claim_id, :entity_id, 'DICTIONARY'); END;`, { claim_id: claimId, entity_id: ent.entityId });
    }
    const keywordTexts = new Set(analysis.keywords.map((k) => k.text));
    if (method === 'NEW_CLAIM') analysis.autoTerms.forEach((t) => keywordTexts.add(t));
    for (const kw of keywordTexts) {
      await db.exec(`BEGIN link_claim_keyword(:claim_id, :kw, 'AUTO'); END;`, { claim_id: claimId, kw });
    }
  }
  for (const cand of analysis.candidates) {
    await db.exec(`BEGIN record_entity_candidate(:text, :source_id); END;`, { text: cand, source_id: sourceId });
  }

  return {
    status: 'INSERTED',
    sourceId,
    claimId,
    variantId: added.outBinds.variant_id,
    method,
    score: bestScore,
    newClaim: method === 'NEW_CLAIM',
    lineageBasis: parent.basis,
    upstreamSourceId: upstream || null,
    referencesAdded,
  };
}
