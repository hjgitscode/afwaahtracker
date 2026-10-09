/**
 * Deterministic rule-based claim matching (no AI, no embeddings).
 *
 * For an incoming item the pipeline extracts entities, keywords, a certainty
 * level and an action verb using fixed dictionaries/rules, then scores every
 * candidate claim that shares at least one entity or keyword:
 *
 *   ENTITY OVERLAP     40   overlap coefficient: shared entities / size of the smaller set
 *   KEYWORD OVERLAP    30   overlap coefficient: shared keywords / size of the smaller set
 *   LOCATION MATCH     10   a shared LOCATION entity
 *   EVENT MATCH        10   a shared EVENT entity
 *   DATE/TIME CONTEXT   5   published within 7 days (5) / 30 days (3) of the claim's latest source
 *   TITLE SIMILARITY    5   Oracle UTL_MATCH.JARO_WINKLER_SIMILARITY of title vs canonical claim
 *                     ---
 *                     100
 *
 * >= strong threshold (default 75)     strong automatic match
 * >= candidate threshold (default 55)  candidate match (attached, flagged)
 * <  candidate threshold               new candidate claim
 */
import config from '../config/index.js';
import { normaliseText, significantTokens, STOP_WORDS } from './normalizer.js';

export const WEIGHTS = { entity: 40, keyword: 30, location: 10, event: 10, date: 5, title: 5 };

// ---------- certainty: fixed hedge / booster vocabularies ----------
const CERTAINTY_RULES = [
  { level: 'DENIED', re: /\b(denies|denied|deny|debunk(ed|s)?|fake|false|hoax|no evidence|not true|rumou?rs? (are )?false|clarif(y|ies|ied|ication)|myth)\b/ },
  { level: 'QUESTIONED', re: /(\?\s*$|\b(is it true|really|fact check|fact-check)\b)/ },
  { level: 'CONFIRMED', re: /\b(confirm(s|ed)?|official(ly)?|announce(s|d)?|approved|launch(es|ed)?|signed|released?)\b/ },
  { level: 'EXPECTED', re: /\b(expected|likely|set to|to be|plans? to|will|poised|scheduled|upcoming)\b/ },
  { level: 'POSSIBLE', re: /\b(may|might|could|possibl[ey]|reportedly|rumou?r(ed|s)?|consider(s|ing)?|mulls?|weighs?|sources say|allegedly)\b/ },
];

export function detectCertainty(text) {
  const t = String(text || '').toLowerCase();
  for (const rule of CERTAINTY_RULES) if (rule.re.test(t)) return rule.level;
  return 'UNSTATED';
}

// ---------- action: small verb dictionary -> canonical action ----------
const ACTIONS = {
  Visit: ['visit', 'visits', 'visiting', 'visited'],
  Perform: ['perform', 'performs', 'performing', 'performed', 'headline', 'headlines'],
  Launch: ['launch', 'launches', 'launched', 'launching', 'unveil', 'unveils', 'unveiled'],
  Announce: ['announce', 'announces', 'announced'],
  Ban: ['ban', 'bans', 'banned', 'banning', 'prohibit', 'prohibits', 'block', 'blocks', 'blocked'],
  Cancel: ['cancel', 'cancels', 'cancelled', 'canceled', 'scrap', 'scraps', 'scrapped'],
  Postpone: ['postpone', 'postpones', 'postponed', 'delay', 'delays', 'delayed', 'reschedule', 'rescheduled'],
  Release: ['release', 'releases', 'released', 'ship', 'ships', 'shipped'],
  Acquire: ['acquire', 'acquires', 'acquired', 'buy', 'buys', 'bought'],
  Sue: ['sue', 'sues', 'sued', 'lawsuit'],
  Warn: ['warn', 'warns', 'warned', 'warning'],
  Approve: ['approve', 'approves', 'approved'],
  Reject: ['reject', 'rejects', 'rejected'],
  Hack: ['hack', 'hacked', 'breach', 'breached', 'leak', 'leaked', 'leaks'],
  Raise: ['raise', 'raises', 'raised', 'hike', 'hikes', 'hiked'],
  Cut: ['cut', 'cuts', 'slash', 'slashes', 'layoff', 'layoffs', 'lay'],
  Discover: ['discover', 'discovers', 'discovered', 'find', 'finds', 'found'],
  Predict: ['predict', 'predicts', 'predicted', 'forecast', 'forecasts'],
  Kill: ['kill', 'kills', 'killed'],
  Cure: ['cure', 'cures', 'cured'],
};
const ACTION_LOOKUP = new Map(Object.entries(ACTIONS).flatMap(([canon, forms]) => forms.map((f) => [f, canon])));

export function detectAction(text) {
  for (const tok of normaliseText(text).split(' ')) {
    if (ACTION_LOOKUP.has(tok)) return ACTION_LOOKUP.get(tok);
  }
  return null;
}

/** Numbers with an optional unit ("5 minutes", "80%", "$2 billion"). */
export function detectQuantity(text) {
  const m = /(\$?\d[\d,.]*\s*(%|percent|per cent|minutes?|hours?|days?|weeks?|months?|years?|million|billion|crore|lakh|people|users|students|employees|times)?)/i.exec(String(text || ''));
  return m && m[1].trim().length > 1 ? m[1].trim().slice(0, 80) : null;
}

/** Top frequent significant tokens - used as AUTO keywords for new claims. */
export function frequentTerms(text, exclude = [], limit = 3) {
  const skip = new Set(exclude.flatMap((e) => normaliseText(e).split(' ')));
  const counts = new Map();
  for (const t of significantTokens(text)) {
    if (t.length < 4 || skip.has(t) || STOP_WORDS.has(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([t]) => t);
}

// Overlap (Szymkiewicz-Simpson) coefficient: |A n B| / min(|A|, |B|)
const overlapCoefficient = (overlap, a, b) => (Math.min(a, b) === 0 ? 0 : overlap / Math.min(a, b));
const round2 = (n) => Math.round(n * 100) / 100;

export function scoreCandidate(analysis, row) {
  const srcEntities = analysis.entities.length;
  const srcKeywords = analysis.keywords.length;
  const hasLocation = analysis.entities.some((e) => e.type === 'LOCATION');
  const hasEvent = analysis.entities.some((e) => e.type === 'EVENT');

  const entity = WEIGHTS.entity * Math.min(1, overlapCoefficient(row.entity_overlap, srcEntities, row.claim_entity_count));
  const keyword = WEIGHTS.keyword * Math.min(1, overlapCoefficient(row.keyword_overlap, srcKeywords, row.claim_keyword_count));
  const location = hasLocation && row.location_overlap > 0 ? WEIGHTS.location : 0;
  const event = hasEvent && row.event_overlap > 0 ? WEIGHTS.event : 0;

  let date = 0;
  if (row.latest_seen && analysis.publishedAt) {
    const days = Math.abs(analysis.publishedAt - new Date(row.latest_seen)) / 86400000;
    date = days <= 7 ? WEIGHTS.date : days <= 30 ? 3 : 0;
  }
  const title = WEIGHTS.title * Math.max(0, Math.min(100, Number(row.title_similarity) || 0)) / 100;

  const parts = { entity: round2(entity), keyword: round2(keyword), location, event, date, title: round2(title) };
  const total = round2(Object.values(parts).reduce((s, v) => s + v, 0));
  return { total, parts };
}

export function describeBreakdown(parts) {
  return `entity ${parts.entity}/40, keyword ${parts.keyword}/30, location ${parts.location}/10, event ${parts.event}/10, date ${parts.date}/5, title ${parts.title}/5`;
}

/** Build ":p0, :p1, ..." placeholders and the matching bind object. */
function inList(prefix, values) {
  const list = values.length ? values : [-1];
  const binds = {};
  const sql = list.map((v, i) => {
    binds[`${prefix}${i}`] = v;
    return `:${prefix}${i}`;
  }).join(', ');
  return { sql, binds };
}

/**
 * Candidate retrieval and overlap counting happen in Oracle; only the final
 * weighting is applied here so the breakdown can be shown transparently.
 */
export async function findBestClaim(db, analysis) {
  const entityIds = analysis.entities.map((e) => e.entityId);
  const keywordIds = analysis.keywords.map((k) => k.id);
  if (!entityIds.length && !keywordIds.length) return null;

  const e = inList('e', entityIds);
  const k = inList('k', keywordIds);

  const rows = await db.rows(
    `SELECT o.claim_id,
            o.canonical_claim,
            o.latest_seen,
            (SELECT COUNT(*) FROM claim_entities ce WHERE ce.claim_id = o.claim_id) AS claim_entity_count,
            (SELECT COUNT(*) FROM claim_entities ce
              WHERE ce.claim_id = o.claim_id AND ce.entity_id IN (${e.sql}))     AS entity_overlap,
            (SELECT COUNT(*) FROM claim_keywords ck WHERE ck.claim_id = o.claim_id) AS claim_keyword_count,
            (SELECT COUNT(*) FROM claim_keywords ck
              WHERE ck.claim_id = o.claim_id AND ck.keyword_id IN (${k.sql}))    AS keyword_overlap,
            (SELECT COUNT(*) FROM claim_entities ce JOIN entities en ON en.entity_id = ce.entity_id
              WHERE ce.claim_id = o.claim_id AND en.entity_type = 'LOCATION'
                AND ce.entity_id IN (${e.sql}))                                  AS location_overlap,
            (SELECT COUNT(*) FROM claim_entities ce JOIN entities en ON en.entity_id = ce.entity_id
              WHERE ce.claim_id = o.claim_id AND en.entity_type = 'EVENT'
                AND ce.entity_id IN (${e.sql}))                                  AS event_overlap,
            UTL_MATCH.JARO_WINKLER_SIMILARITY(LOWER(o.canonical_claim), :title)  AS title_similarity
       FROM vw_claim_overview o
      WHERE o.claim_id IN (SELECT ce.claim_id FROM claim_entities ce WHERE ce.entity_id IN (${e.sql})
                           UNION
                           SELECT ck.claim_id FROM claim_keywords ck WHERE ck.keyword_id IN (${k.sql}))
      ORDER BY entity_overlap DESC, keyword_overlap DESC
      FETCH FIRST 25 ROWS ONLY`,
    { ...e.binds, ...k.binds, title: normaliseText(analysis.title).slice(0, 255) }
  );

  let best = null;
  for (const row of rows) {
    const score = scoreCandidate(analysis, row);
    if (!best || score.total > best.score.total) best = { claimId: row.claim_id, canonical: row.canonical_claim, score };
  }
  return best;
}

export function classify(score) {
  if (score >= config.matching.strongThreshold) return 'RULE_STRONG';
  if (score >= config.matching.candidateThreshold) return 'RULE_CANDIDATE';
  return 'NEW_CLAIM';
}
