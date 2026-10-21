/**
 * Canonical wording and normalised signatures for structured propositions.
 *
 * signature = SUBJECT_KEY | PREDICATE | OBJECT_KEY | QUALIFIER_KEY | TEMPORAL
 *   SUBJECT/QUALIFIER keys: "E<entity_id>" once resolved in Oracle
 *   OBJECT key: role code (VICE_PRESIDENT), entity key, or the sorted
 *               significant words of an event object
 * Equal signatures = the same claim family. Director and Vice President give
 * different signatures and therefore different families.
 */
import { PREDICATE_LABEL, roleCode } from './lexicon.js';
import { significantTokens } from '../ingestion/normalizer.js';

export function eventObjectKey(text) {
  const toks = [...new Set(significantTokens(text))].sort();
  return toks.slice(0, 8).join('_').toUpperCase() || null;
}

export function objectKey(prop, objectEntityKey) {
  if (prop.predicate === 'HOLDS_ROLE') return roleCode(prop.object);
  if (objectEntityKey) return objectEntityKey;
  return eventObjectKey(prop.object);
}

export function signatureOf({ subjectKey, predicate, objectKey: ok, qualifierKey, temporal }) {
  return [subjectKey, predicate, ok || '-', qualifierKey || '-', temporal || 'CURRENT'].join('|').slice(0, 400);
}

/** Similarity of two event objects: overlap coefficient of their significant words. */
export function objectSimilarity(a, b) {
  const x = new Set(String(a || '').split('_').filter(Boolean));
  const y = new Set(String(b || '').split('_').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common += 1;
  return common / Math.min(x.size, y.size);
}

/** Neutral canonical sentence for a proposition. */
export function canonicalText(p) {
  const subj = p.subject;
  const past = p.temporal === 'PAST';
  switch (p.predicate) {
    case 'HOLDS_ROLE':
      return p.qualifier ? `${subj} ${past ? 'was' : 'is'} ${p.object} of ${p.qualifier}.` : `${subj} ${past ? 'was' : 'is'} ${p.object}.`;
    case 'LOCATED_IN':
      return `${subj} is located in ${p.object}.`;
    case 'FOUNDED_BY':
      return `${subj} was founded by ${p.object}.`;
    case 'MEMBER_OF':
      return `${subj} ${past ? 'was' : 'is'} a member of ${p.object}.`;
    case 'OWNS':
      return `${subj} owns ${p.object}.`;
    default: {
      const label = p.verbPast || PREDICATE_LABEL[p.predicate] || String(p.predicate).toLowerCase();
      // The wording keeps the certainty of the first evidence ("may launch")
      let base = label;
      if (p.verbBase && p.certainty === 'POSSIBLE') base = `may ${p.verbBase}`;
      else if (p.verbBase && (p.temporal === 'FUTURE' || p.certainty === 'EXPECTED')) base = `will ${p.verbBase}`;
      else if (p.verbBase && p.certainty === 'DENIED') base = `did not ${p.verbBase}`;
      const where = p.location ? ` in ${p.location}` : '';
      return `${subj} ${base} ${p.object}${where}.`.replace(/\s+/g, ' ');
    }
  }
}
