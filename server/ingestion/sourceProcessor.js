/**
 * One code path for storing and analysing a single source, shared by the
 * background feeds (GDELT / Hacker News / RSS) and live web investigation.
 * The caller wraps each call in ONE transaction (withTransaction), so a
 * failure rolls back only that item.
 *
 *   WEB PAGE -> EVIDENCE SENTENCE -> STRUCTURED PROPOSITION -> CLAIM FAMILY
 *
 *   1. INGEST_SOURCE              deduplicated insert (0 = already stored)
 *   2. explicit references        hyperlinks / canonical URL -> SOURCE_REFERENCES
 *   3. evidence sentences         page sentence > meta description > search
 *                                 snippet > title; RECORD_EVIDENCE (MERGE)
 *   4. structured proposition     subject | predicate | object | qualifier
 *   5. RESOLVE_ENTITY             aliases -> one entity per real name
 *   6. Oracle candidate claims    same subject + predicate + qualifier
 *      (CLAIM_PROPOSITIONS)       exact signature > similar object > new family
 *   7. CREATE_PROPOSITION_CLAIM   new family (CLAIMS + FINGERPRINTS + proposition)
 *   8. CHOOSE_VARIANT_PARENT      explicit reference > proposition predecessor
 *   9. ADD_CLAIM_VARIANT          evidence-linked variant; trigger -> Mutation Ledger
 *  10. attribution + dependence   "according to X" -> ATTRIBUTION reference,
 *                                 APPLY_SOURCE_DEPENDENCE (explicit evidence only)
 *  11. entity / keyword links
 * A source without an extractable proposition stays a related source. The
 * old headline scoring survives only as a fallback into older claim families
 * that have no proposition (demo / earlier data); it never creates a claim.
 */
import { oracledb } from '../db/pool.js';
import { detectEntities, detectKnownKeywords, detectEntityCandidates } from './entityMatcher.js';
import {
  detectCertainty, detectAction, detectQuantity, frequentTerms, findBestClaim, classify, describeBreakdown,
} from './matcher.js';
import { extractProposition, quantityOf } from '../claims/propositions.js';
import { selectEvidence, makeScorer, detectAttributions } from '../claims/evidence.js';
import { makeEntityHelpers } from '../claims/entities.js';
import { canonicalText, objectKey, signatureOf, objectSimilarity } from '../claims/canonical.js';
import { roleCode } from '../claims/lexicon.js';

/** Legacy headline analysis, used only for the fallback into older claim families. */
export function analyseItem(item, dictionary) {
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

async function chooseParent(db, claimId, sourceId, text, fields = {}) {
  const r = await db.exec(
    `BEGIN choose_variant_parent(p_claim_id => :claim_id, p_source_id => :source_id, p_variant_text => :text,
                                 o_parent_variant_id => :parent, o_basis => :basis, o_similarity => :sim,
                                 p_certainty => :certainty, p_claimed_date => :claimed_date, p_quantity => :quantity,
                                 p_location => :location, p_rel_object => :rel_object); END;`,
    {
      claim_id: claimId,
      source_id: sourceId,
      text,
      certainty: fields.certainty || null,
      claimed_date: fields.date || null,
      quantity: fields.quantity || null,
      location: fields.location || null,
      rel_object: fields.relObject || null,
      parent: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      basis: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 30 },
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
      WHERE source_id = :id AND lineage_basis IN ('NONE','LEXICAL_PREDECESSOR','PROPOSITION_PREDECESSOR','AUTO_ROOT')`,
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


const MAX_PROPOSITIONS_PER_SOURCE = 2;

async function resolveEntity(db, text, type, acronym = null) {
  if (!text) return null;
  const r = await db.exec(`BEGIN :id := resolve_entity(:t, :ty, 'Y', :acr); END;`, {
    id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    t: String(text).slice(0, 200),
    ty: type,
    acr: acronym,
  });
  if (!r.outBinds.id) return null;
  const row = await db.one('SELECT entity_id, entity_name FROM entities WHERE entity_id = :id', { id: r.outBinds.id });
  return row ? { id: row.entity_id, name: row.entity_name } : null;
}

async function recordEvidence(db, sourceId, runId, ev) {
  const r = await db.exec(
    `BEGIN :id := record_evidence(:src, :run, :txt, :ord, :score, :type, :method); END;`,
    {
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      src: sourceId, run: runId || null, txt: ev.text, ord: ev.order, score: ev.score, type: ev.type, method: ev.method,
    }
  );
  return r.outBinds.id;
}

/**
 * Oracle finds the candidate claim families: same subject, predicate,
 * qualifier and time scope (CLAIM_PROPOSITIONS, indexed). JavaScript only
 * compares the object of the few candidates returned.
 */
async function findPropositionClaim(db, keys) {
  const rows = await db.rows(
    `SELECT p.claim_id, p.normalized_signature, p.object_key
       FROM claim_propositions p
       JOIN claims c ON c.claim_id = p.claim_id
      WHERE p.subject_key = :sk
        AND p.predicate_code = :pred
        AND NVL(p.qualifier_key, '~') = NVL(:qk, '~')
        AND (p.claim_type = 'EVENT_ACTION' OR NVL(p.temporal_scope, 'CURRENT') = NVL(:ts, 'CURRENT'))
      ORDER BY CASE WHEN p.normalized_signature = :sig THEN 0 ELSE 1 END, p.claim_id
      FETCH FIRST 25 ROWS ONLY`,
    { sk: keys.subjectKey, pred: keys.predicate, qk: keys.qualifierKey, ts: keys.temporal, sig: keys.signature }
  );
  const exact = rows.find((r) => r.normalized_signature === keys.signature);
  if (exact) return { claimId: exact.claim_id, method: 'PROPOSITION_EXACT', score: 100 };
  // Event objects may be worded differently ("iPhone 17" / "the iPhone 17 lineup");
  // roles and locations must match exactly (Director is not Vice President).
  if (keys.claimType === 'EVENT_ACTION') {
    let best = null;
    for (const r of rows) {
      const sim = objectSimilarity(r.object_key, keys.objectKey);
      if (sim >= 0.6 && (!best || sim > best.sim)) best = { claimId: r.claim_id, sim };
    }
    if (best) return { claimId: best.claimId, method: 'PROPOSITION_SIMILAR', score: Math.round(60 + 40 * best.sim) };
  }
  return null;
}

/** Attach one extracted proposition (with its evidence) to a claim family. */
async function attachProposition(db, prop, ev, ctx) {
  const { sourceId, helpers, categoryId, originLabel, sentenceAnalysis } = ctx;
  const subjectType = helpers.guessType(prop.subject, prop.subjectType);
  const subject = await resolveEntity(db, prop.subject, subjectType);
  if (!subject) return null;
  const qualifier = prop.qualifier
    ? await resolveEntity(db, prop.qualifier, 'ORGANISATION', prop.qualifierAcronym || null)
    : null;
  // Remember the spellings actually used on the page as aliases of the same
  // entity ("Dr G V Selvam", "G.V. Selvam" -> G. V. Selvam)
  if (prop.subjectSurface && prop.subjectSurface !== prop.subject) await resolveEntity(db, prop.subjectSurface, subjectType);
  if (qualifier && prop.qualifierSurface && prop.qualifierSurface !== prop.qualifier) {
    await resolveEntity(db, String(prop.qualifierSurface).replace(/\s*\([A-Z]{2,8}\)$/, '').replace(/^the\s+/i, ''), 'ORGANISATION', prop.qualifierAcronym || null);
  }
  const objectEntity = prop.objectType === 'LOCATION' || prop.objectType === 'PERSON' || (prop.objectType === 'ORGANISATION')
    ? await resolveEntity(db, prop.object, prop.objectType)
    : null;

  const named = {
    ...prop,
    subject: subject.name,
    qualifier: qualifier ? qualifier.name : prop.qualifier,
    object: objectEntity ? objectEntity.name : prop.object,
  };
  const keys = {
    claimType: prop.claimType,
    subjectKey: `E${subject.id}`,
    predicate: prop.predicate,
    objectKey: objectKey(prop, objectEntity ? `E${objectEntity.id}` : null),
    qualifierKey: qualifier ? `E${qualifier.id}` : null,
    // "will launch" / "launched" are one event family: the variant's certainty
    // records the difference (and the Mutation Ledger the change). Roles keep
    // their temporal scope (a former Director is a different proposition).
    temporal: prop.claimType === 'EVENT_ACTION' ? null : prop.temporal || null,
  };
  keys.signature = signatureOf(keys);

  let match = await findPropositionClaim(db, keys);
  let claimId;
  let created = false;
  if (match) {
    claimId = match.claimId;
  } else {
    const r = await db.exec(
      `BEGIN create_proposition_claim(:canonical, :category, :ctype, :sid, :stext, :skey, :pred, :oid, :otext, :okey,
                                      :qid, :qtext, :qkey, :temporal, :sig, :origin, :claim_id, :created); END;`,
      {
        canonical: canonicalText(named), category: categoryId, ctype: prop.claimType,
        sid: subject.id, stext: subject.name, skey: keys.subjectKey, pred: prop.predicate,
        oid: objectEntity?.id || null, otext: named.object, okey: keys.objectKey,
        qid: qualifier?.id || null, qtext: named.qualifier || null, qkey: keys.qualifierKey,
        temporal: keys.temporal, sig: keys.signature, origin: originLabel,
        claim_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        created: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    claimId = r.outBinds.claim_id;
    created = r.outBinds.created === 1;
    match = { method: created ? 'NEW_CLAIM' : 'PROPOSITION_EXACT', score: created ? 0 : 100 };
  }

  // A source contributes one variant per claim family
  const existing = await db.one('SELECT variant_id FROM claim_variants WHERE claim_id = :c AND source_id = :s', { c: claimId, s: sourceId });
  if (existing) {
    // Already in this family (e.g. from an earlier run): still take it out of
    // any older title-made family it also sits in
    const superseded = await supersedeLegacy(db, sourceId);
    return { claimId, newClaim: false, method: match.method, variantId: existing.variant_id, reused: true, superseded };
  }

  const attributions = detectAttributions(ev.text);
  const fields = {
    certainty: prop.certainty,
    date: prop.date || null,
    quantity: quantityOf(ev.text),
    // A place is recorded for location relations and events only; for roles a
    // place inside an organisation's name ("Vellore Institute ...") is not one
    location: prop.predicate === 'LOCATED_IN' ? named.object
      // the place stated after the event ("in New Delhi"); a dictionary place
      // inside a name ("Indian Railways") is not where the event happened
      : prop.claimType === 'EVENT_ACTION' ? prop.location || null : null,
    relObject: named.object,
  };
  const parent = created ? { parentId: null, basis: 'NONE' } : await chooseParent(db, claimId, sourceId, ev.text, fields);
  const breakdown = created
    ? `New claim family from ${prop.basis} (${keys.signature}).`
    : `${match.method === 'PROPOSITION_EXACT' ? 'Same structured proposition' : 'Same subject and predicate, similar object'} (${keys.signature}); extracted by ${prop.basis}.`;

  const added = await db.exec(
    `BEGIN
       add_claim_variant(
         p_claim_id => :claim_id, p_source_id => :source_id, p_parent_variant_id => :parent_id,
         p_variant_text => :text, p_actor => :actor, p_action => :action,
         p_target_object => :target, p_location_name => :location, p_event_name => :event,
         p_claimed_date => :claimed_date, p_quantity_value => :quantity, p_certainty => :certainty,
         p_attribution => :attribution, p_match_score => :score, p_match_method => :method,
         p_lineage_basis => :basis, p_match_breakdown => :breakdown, o_variant_id => :variant_id,
         p_evidence_id => :evidence_id, p_rel_subject => :rs, p_rel_predicate => :rp,
         p_rel_object => :ro, p_rel_qualifier => :rq, p_extraction_basis => :eb);
     END;`,
    {
      claim_id: claimId,
      source_id: sourceId,
      parent_id: parent.parentId,
      text: ev.text,
      actor: subject.name,
      // the proposition's own verb for events; a role / location relation has
      // no separate action (a headline-verb guess would show as a false mutation)
      action: prop.claimType === 'EVENT_ACTION' && prop.verbBase
        ? prop.verbBase.charAt(0).toUpperCase() + prop.verbBase.slice(1)
        : null,
      // the event object is recorded once, as the structured relation object
      target: null,
      location: fields.location,
      event: prop.claimType === 'EVENT_ACTION' ? sentenceAnalysis.event : null,
      claimed_date: fields.date,
      quantity: fields.quantity,
      certainty: prop.certainty,
      // only what the text itself credits ("according to PTI"); the publisher
      // is the source, not an attribution, so it is never compared as one
      attribution: attributions.length ? attributions.join(', ') : null,
      score: match.score,
      method: match.method,
      basis: parent.basis,
      breakdown: breakdown.slice(0, 400),
      variant_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      evidence_id: ev.evidenceId,
      // canonical entity name: spelling variants are aliases, not mutations
      rs: subject.name,
      rp: prop.predicate,
      ro: named.object,
      rq: named.qualifier || null,
      eb: prop.basis,
    }
  );

  // The proposition object key of this variant (as in the family signature):
  // the Mutation Ledger compares objects by it, so rewording is not a mutation
  await db.exec('UPDATE claim_variants SET relation_object_key = :k WHERE variant_id = :v', {
    k: keys.objectKey, v: added.outBinds.variant_id,
  });

  // Provenance: attributions to a stored publisher in the same family, then
  // the known upstream source (explicit evidence only)
  let referencesAdded = 0;
  for (const name of attributions) {
    const r = await db.exec(`BEGIN :n := record_attribution_reference(:s, :p); END;`, {
      n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }, s: sourceId, p: name,
    });
    referencesAdded += r.outBinds.n || 0;
  }
  const upstream = await applySourceDependence(db, sourceId);
  const superseded = await supersedeLegacy(db, sourceId);

  // Entities: the proposition's own entities plus dictionary entities in the sentence
  const entityIds = new Set([subject.id, qualifier?.id, objectEntity?.id, ...sentenceAnalysis.entities.map((e) => e.entityId)].filter(Boolean));
  for (const id of entityIds) {
    await db.exec(`BEGIN link_claim_entity(:claim_id, :entity_id, 'DICTIONARY'); END;`, { claim_id: claimId, entity_id: id });
  }
  const keywordTexts = new Set(sentenceAnalysis.keywords.map((k) => k.text));
  if (created) {
    if (prop.predicate === 'HOLDS_ROLE') keywordTexts.add(roleCode(prop.object).toLowerCase().replace(/_/g, ' '));
    sentenceAnalysis.autoTerms.forEach((t) => keywordTexts.add(t));
  }
  for (const kw of keywordTexts) {
    await db.exec(`BEGIN link_claim_keyword(:claim_id, :kw, 'AUTO'); END;`, { claim_id: claimId, kw: kw.slice(0, 80) });
  }

  return {
    claimId,
    newClaim: created,
    method: match.method,
    variantId: added.outBinds.variant_id,
    lineageBasis: parent.basis,
    upstreamSourceId: upstream || null,
    referencesAdded,
    superseded,
  };
}

/**
 * Once a source belongs to a proposition-based family, its variants in older
 * title-made families are removed (SUPERSEDE_LEGACY_VARIANTS); a family left
 * without variants is kept as MERGED with merged_into_claim_id.
 */
export async function supersedeLegacy(db, sourceId) {
  const r = await db.exec(`BEGIN :n := supersede_legacy_variants(:id); END;`, {
    n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }, id: sourceId,
  });
  return r.outBinds.n || 0;
}

/**
 * Evidence + propositions for one stored source (new or already stored).
 *
 * ctx = { sourceId, runId, input: { blocks, text, description, snippet, title },
 *         page: { title, publisher, url }, hypothesis, scorer, dictionary,
 *         categoryId, originLabel, publisher }
 */
export async function analyseSourceEvidence(db, ctx) {
  const helpers = makeEntityHelpers(ctx.dictionary, ctx.hypothesis);
  const scorer = ctx.scorer || makeScorer({ hypothesis: ctx.hypothesis, query: ctx.input.title, aliasesFor: helpers.aliasesFor });
  const entityTest = (t) => detectEntities(t, ctx.dictionary).length > 0;
  const extractCtx = {
    knownOrg: helpers.knownOrg,
    contextOrg: helpers.contextOrgFor(ctx.page),
  };
  const hasClaim = (t) => Boolean(extractProposition(t, extractCtx));
  const evidence = selectEvidence(ctx.input, scorer, { entityTest, hasClaim });

  // Stage counters (recorded per run in SEARCH_RUN_STAGES)
  const result = {
    evidenceCount: evidence.length, claims: [], referencesAdded: 0,
    sentencesExamined: 0, propositions: 0, variantsAdded: 0, superseded: 0,
  };
  if (!evidence.length) return result;

  for (const ev of evidence) ev.evidenceId = await recordEvidence(db, ctx.sourceId, ctx.runId, ev);

  const seen = new Set();
  for (const ev of evidence) {
    if (result.claims.length >= MAX_PROPOSITIONS_PER_SOURCE) break;
    result.sentencesExamined += 1;
    const prop = extractProposition(ev.text, extractCtx);
    if (!prop) continue;
    result.propositions += 1;
    const sig = `${prop.subject}|${prop.predicate}|${prop.object}|${prop.qualifier}`.toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    const sentenceAnalysis = analyseItem({ title: ev.text, publishedAt: null }, ctx.dictionary);
    const out = await attachProposition(db, prop, ev, { ...ctx, helpers, sentenceAnalysis });
    if (out) {
      result.claims.push(out);
      result.referencesAdded += out.referencesAdded || 0;
      result.superseded += out.superseded || 0;
      if (!out.reused) result.variantsAdded += 1;
    }
  }

  // Fallback (low priority): older claim families without a proposition may
  // still receive a strong headline/entity match. Never creates a claim.
  if (!result.claims.length) {
    const best = evidence[0];
    const analysis = analyseItem({ title: best.text, publishedAt: ctx.publishedAt || null }, ctx.dictionary);
    const match = await findBestClaim(db, analysis);
    if (match && classify(match.score.total) === 'RULE_STRONG') {
      const legacy = await db.one(
        `SELECT c.claim_id FROM claims c
          WHERE c.claim_id = :id
            AND NOT EXISTS (SELECT 1 FROM claim_propositions p WHERE p.claim_id = c.claim_id)
            AND NOT EXISTS (SELECT 1 FROM claim_variants v WHERE v.claim_id = c.claim_id AND v.source_id = :src)`,
        { id: match.claimId, src: ctx.sourceId }
      );
      if (legacy) {
        const parent = await chooseParent(db, match.claimId, ctx.sourceId, best.text);
        const added = await db.exec(
          `BEGIN
             add_claim_variant(p_claim_id => :claim_id, p_source_id => :source_id, p_parent_variant_id => :parent_id,
               p_variant_text => :text, p_actor => :actor, p_action => :action, p_location_name => :location,
               p_event_name => :event, p_quantity_value => :quantity, p_certainty => :certainty,
               p_attribution => :attribution, p_match_score => :score, p_match_method => 'RULE_STRONG',
               p_lineage_basis => :basis, p_match_breakdown => :breakdown, o_variant_id => :variant_id,
               p_evidence_id => :evidence_id, p_extraction_basis => 'HEADLINE_FALLBACK');
           END;`,
          {
            claim_id: match.claimId, source_id: ctx.sourceId, parent_id: parent.parentId, text: best.text,
            actor: analysis.actor, action: analysis.action, location: analysis.location, event: analysis.event,
            quantity: analysis.quantity, certainty: analysis.certainty, attribution: detectAttributions(best.text).join(', ') || null,
            score: match.score.total, basis: parent.basis, breakdown: describeBreakdown(match.score.parts),
            variant_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }, evidence_id: best.evidenceId,
          }
        );
        await applySourceDependence(db, ctx.sourceId);
        result.claims.push({ claimId: match.claimId, newClaim: false, method: 'RULE_STRONG', variantId: added.outBinds.variant_id });
        result.variantsAdded += 1;
      }
    }
  }
  return result;
}

/**
 * Store a newly fetched item and analyse it.
 *
 * options: platformId, ingestionSourceId, categoryId, origin ('AUTOMATED' feeds |
 *          'WEB_SEARCH'), originLabel, dictionary, runId, hypothesis, scorer,
 *          page (extracted page or null), searchSnippet
 */
export async function processSourceItem(db, item, options) {
  const {
    platformId, ingestionSourceId = null, categoryId, origin = 'AUTOMATED',
    originLabel = 'automated source', dictionary, runId = null, hypothesis = null, scorer = null,
    page = null, searchSnippet = null,
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

  const referencesAdded = await recordReferences(db, sourceId, {
    links: item.outboundLinks || [],
    canonicalUrl: item.canonicalUrl,
    url: item.url,
  });

  const analysis = await analyseSourceEvidence(db, {
    sourceId,
    runId,
    input: {
      blocks: page?.blocks || null,
      // feeds: the item's own description; web results without a fetched page:
      // only the search snippet (labelled SEARCH_SNIPPET, not page text)
      text: page || searchSnippet ? null : item.snippet,
      description: page?.description || null,
      snippet: searchSnippet,
      title: item.title,
    },
    page: { title: item.title, publisher: item.publisher, url: item.url },
    hypothesis,
    scorer,
    dictionary,
    categoryId,
    originLabel,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
  });

  return {
    status: 'INSERTED',
    sourceId,
    claims: analysis.claims,
    ...analysis,
    linkReferences: referencesAdded,
    referencesAdded: referencesAdded + analysis.referencesAdded,
  };
}

/** Re-read an already stored source for a new investigation (no refetch). */
export async function analyseStoredSource(db, sourceId, options) {
  const src = await db.one(
    `SELECT source_id, source_title, source_url, publisher, snippet, published_at FROM sources WHERE source_id = :id`,
    { id: sourceId }
  );
  if (!src) return { claims: [], evidenceCount: 0, referencesAdded: 0, sentencesExamined: 0, propositions: 0, variantsAdded: 0, superseded: 0 };
  const lines = String(src.snippet || '').split('\n').filter(Boolean);
  // When a page could not be fetched, the stored text IS the search snippet:
  // it is then offered (and labelled) as SEARCH_SNIPPET, not as page text
  const flat = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const storedIsSnippet = Boolean(src.snippet) && Boolean(options.searchSnippet) && flat(src.snippet) === flat(options.searchSnippet);
  return analyseSourceEvidence(db, {
    sourceId,
    runId: options.runId,
    input: {
      blocks: !storedIsSnippet && lines.length > 1 ? lines : null,
      text: storedIsSnippet || lines.length > 1 ? null : src.snippet,
      description: null,
      snippet: options.searchSnippet || (storedIsSnippet ? src.snippet : null),
      title: src.source_title,
    },
    page: { title: src.source_title, publisher: src.publisher, url: src.source_url },
    hypothesis: options.hypothesis,
    scorer: options.scorer,
    dictionary: options.dictionary,
    categoryId: options.categoryId,
    originLabel: options.originLabel,
    publisher: src.publisher,
    publishedAt: src.published_at,
  });
}
