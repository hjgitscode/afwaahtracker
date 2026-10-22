/**
 * Evidence sentence selection: from a page's readable text, pick the 1-3
 * sentences that best state something about the investigated claim.
 *
 * Priority of evidence (spec): page sentence > meta description > search
 * snippet > page title (final fallback only).
 *
 * Score (0-100, deterministic):
 *   +35 investigated subject (alias-tolerant: "Dr. G. V. Selvam" = "GV Selvam")
 *   +15 investigated organisation / qualifier (or one of its aliases)
 *   +15 relation words (any role / event verb), +10 more for the exact role/verb asked
 *   +20 x share of query words present
 *   +5  a dictionary entity present
 *   +5  early on the page
 *   -15 / -30 too short or too long, -40 navigation / boilerplate
 */
import { ROLE_SURFACES, VERB_SURFACES, BOILERPLATE } from './lexicon.js';
import { flexibleNamePattern } from './names.js';
import { looksLikePersonName, looksLikeRoleLabel } from './propositions.js';
import { significantTokens } from '../ingestion/normalizer.js';

const ABBREV = /(?:\b(?:Dr|Mr|Mrs|Ms|Prof|St|No|Inc|Ltd|Co|Jr|Sr|vs|etc|Gen|Govt|Dept|Univ|approx|Rs|Mt|Ft)|\b[A-Z])\.$/;

/** Split text into sentences without breaking "Dr. G. V. Selvam" or "U.S." */
export function splitSentences(text) {
  const out = [];
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  let start = 0;
  const re = /[.!?]+["”’)]?\s+(?=["“(]?[A-Z0-9])/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = m.index + m[0].trimEnd().length;
    const piece = src.slice(start, end);
    if (ABBREV.test(piece.trimEnd().replace(/["”’)]$/, ''))) continue;
    out.push(piece.trim());
    start = m.index + m[0].length;
  }
  if (start < src.length) out.push(src.slice(start).trim());
  return out.filter((s) => s.length >= 3);
}

/**
 * Turn page blocks (headings, paragraphs, list items, short leaf elements)
 * into candidate sentences. Profile and leadership pages often show a name
 * and a title as separate short blocks ("Dr. G. V. Selvam" / "Vice President").
 * Such pairs are joined into one line ("Dr. G. V. Selvam, Vice President").
 * Pairing walks the page top-down and consumes both blocks of a pair, so an
 * alternating list (title, name, title, name ...) can never attach a title to
 * the wrong neighbour.
 */
export function candidateSentences(blocks) {
  const list = (blocks || []).map((b) => String(b || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    const next = list[i + 1];
    if (next && t.length < 70 && next.length < 70) {
      if (looksLikePersonName(t) && looksLikeRoleLabel(next)) {
        out.push(`${t}, ${next}`);
        i += 1;
        continue;
      }
      if (looksLikeRoleLabel(t) && looksLikePersonName(next)) {
        out.push(`${t}, ${next}`);
        i += 1;
        continue;
      }
    }
    out.push(...splitSentences(t));
  }
  return out;
}

const RELATION_RE = new RegExp(`\\b(?:${[...ROLE_SURFACES, ...VERB_SURFACES].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')).join('|')}|located|headquartered|founded|member)\\b`, 'i');

/** Builds a scorer for one investigation. */
export function makeScorer({ hypothesis, query, aliasesFor }) {
  const queryTokens = [...new Set(significantTokens(query || ''))];
  const subjectRe = hypothesis?.subject ? new RegExp(`\\b${flexibleNamePattern(hypothesis.subject)}\\b`, 'i') : null;
  const qualifierAliases = hypothesis?.qualifier ? aliasesFor(hypothesis.qualifier) : [];
  const qualRe = qualifierAliases.length
    ? new RegExp(`\\b(?:${qualifierAliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')
    : null;
  const objectRe = hypothesis?.object && hypothesis.predicate === 'HOLDS_ROLE'
    ? new RegExp(`\\b${hypothesis.object.replace(/ /g, '[\\s-]+')}\\b`, 'i')
    : hypothesis?.object ? new RegExp(`\\b${significantTokens(hypothesis.object).slice(0, 1).join('')}`, 'i') : null;

  return function score(sentence, order = 0, hasEntity = false) {
    const s = String(sentence || '');
    const words = s.split(/\s+/).filter(Boolean).length;
    let total = 0;
    const subjectHit = subjectRe ? subjectRe.test(s) : false;
    if (subjectHit) total += 35;
    if (subjectHit && subjectRe.exec(s)?.index <= 5) total += 5; // the sentence is about the subject
    if (qualRe && qualRe.test(s)) total += 15;
    if (RELATION_RE.test(s)) total += 15;
    if (objectRe && objectRe.test(s)) total += 10;
    if (queryTokens.length) {
      const toks = new Set(significantTokens(s));
      total += 20 * (queryTokens.filter((t) => toks.has(t)).length / queryTokens.length);
    }
    if (hasEntity) total += 5;
    // A bare name or label ("Dr G V Selvam", "Leadership") states nothing
    if (words < 5 && !RELATION_RE.test(s)) return { score: 0, subjectHit };
    if (order < 5) total += 5;
    if (words < 4) total -= 30;
    else if (words < 6) total -= 10;
    if (words > 60) total -= 15;
    if (words > 90) total -= 30;
    if (BOILERPLATE.test(s) || (s.match(/[|»›]/g) || []).length >= 2) total -= 40;
    return { score: Math.max(0, Math.min(100, Math.round(total * 10) / 10)), subjectHit };
  };
}

export const EVIDENCE_THRESHOLD = 25;

/**
 * Select evidence for one source.
 * input: { blocks, text, description, snippet, title }
 * hasClaim(text): true when a structured proposition can be extracted.
 * returns [{ text, order, score, type, method }] (max 3), best first
 *
 * The highest tier with a relevant sentence supplies the evidence. When none
 * of its sentences states an extractable relationship (e.g. a video page whose
 * body is a sidebar), the first relationship-bearing sentence from a lower
 * tier (meta description, search snippet, title) is added, so a page whose
 * title says "Dr. G. V. Selvam, Vice President of VIT" is not lost.
 */
export function selectEvidence(input, scorer, { entityTest = () => false, max = 3, hasClaim = null } = {}) {
  const tiers = [
    ['PAGE_SENTENCE', input.blocks?.length ? candidateSentences(input.blocks) : splitSentences(input.text)],
    ['META_DESCRIPTION', splitSentences(input.description)],
    ['SEARCH_SNIPPET', splitSentences(input.snippet)],
    ['TITLE_FALLBACK', input.title ? [input.title] : []],
  ];
  const typed = (e) => ({
    ...e,
    type: e.method === 'TITLE_FALLBACK' ? 'TITLE' : e.method === 'SEARCH_SNIPPET' ? 'SNIPPET_FALLBACK'
      : /\b(?:said|says|according to|told|stated)\b/i.test(e.text) ? 'ATTRIBUTED_STATEMENT' : 'DIRECT_STATEMENT',
  });
  let chosen = null;
  for (const [method, sentences] of tiers) {
    const seen = new Set();
    const scored = [];
    sentences.slice(0, 400).forEach((text, order) => {
      const key = text.toLowerCase();
      if (seen.has(key) || text.length > 700) return;
      seen.add(key);
      const { score } = scorer(text, order, entityTest(text));
      if (score >= EVIDENCE_THRESHOLD) scored.push({ text: text.slice(0, 1000), order, score, method });
    });
    if (!scored.length) continue;
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    if (!chosen) {
      chosen = scored.slice(0, max);
      if (!hasClaim || chosen.some((e) => hasClaim(e.text))) return chosen.map(typed);
      // Keep the best sentence; prefer a relationship-bearing one from the same tier
      const inTier = scored.slice(max).find((e) => hasClaim(e.text));
      if (inTier) return [...chosen.slice(0, max - 1), inTier].map(typed);
      continue;
    }
    const withClaim = scored.find((e) => hasClaim(e.text) && !chosen.some((c) => c.text.toLowerCase() === e.text.toLowerCase()));
    if (withClaim) return [...chosen.slice(0, max - 1), withClaim].map(typed);
  }
  return (chosen || []).map(typed);
}

// "according to Reuters", "reported by ANI", "via PTI", "(Reuters)", "Source: The Hindu"
const ATTRIBUTION_RES = [
  /\b[Aa]ccording\s+to\s+(?:a\s+report\s+(?:by|in)\s+|reports?\s+(?:by|in)\s+)?(?:the\s+)?(?<name>[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,4})/,
  /\b(?:[Rr]eported|[Ff]irst\s+reported|[Oo]riginally\s+published|[Pp]ublished)\s+(?:by|in)\s+(?:the\s+)?(?<name>[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,4})/,
  /\b(?:[Aa]s\s+reported\s+by|[Cc]iting|[Vv]ia|[Cc]ourtesy(?:\s+of)?)\s+(?:the\s+)?(?<name>[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,4})/,
  /\b[Ss]ource\s*:\s*(?:the\s+)?(?<name>[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,4})/,
  /\((?<name>Reuters|AP|AFP|ANI|PTI|IANS|Bloomberg)\)/,
  /\b(?<name>Reuters|ANI|PTI|IANS|AFP)\s+reported\b/,
];

/** Publisher names a text explicitly attributes its information to. */
export function detectAttributions(text) {
  const found = new Set();
  for (const re of ATTRIBUTION_RES) {
    const g = new RegExp(re.source, 'g');
    for (let m = g.exec(String(text || '')); m; m = g.exec(String(text || ''))) {
      const name = m.groups.name.replace(/[.,]+$/, '').trim();
      if (name.length >= 2 && !/^(?:The|A|An|He|She|They|It|This|Sources?)$/.test(name)) found.add(name);
    }
  }
  return [...found].slice(0, 5);
}
