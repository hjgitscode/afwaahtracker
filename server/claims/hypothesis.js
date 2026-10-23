/**
 * Investigation hypothesis: what the user is asking about, parsed from the
 * query with fixed patterns (no AI). A hypothesis is NOT a claim and is
 * never stored as a claim family; sources decide which claims exist.
 *
 *   "Is GV Selvam director of VIT?"   -> CLAIM_QUERY  G. V. Selvam | HOLDS_ROLE | Director | VIT
 *   "Did Apple launch iPhone 17?"     -> CLAIM_QUERY  Apple | LAUNCHED | iPhone 17
 *   "US imposed tariffs on India"     -> CLAIM_QUERY  United States | IMPOSED | tariffs | India
 *   "VIT located in Vellore"          -> CLAIM_QUERY  VIT | LOCATED_IN | Vellore
 *   "Who is Sundar Pichai?"           -> ENTITY_QUERY Sundar Pichai
 *   "AI education India"              -> TOPIC_SEARCH (no proposition is invented)
 */
import { ROLE_SURFACES, canonicalRole, VERB_SURFACES, VERB_LOOKUP, CLAIM_TYPE_OF, canonicalActor, actionTarget, rejectsVerb, isNonObject } from './lexicon.js';
import { cleanEventObject } from './propositions.js';
import { displayPersonName, displayOrgName } from './names.js';
import { canonicalText } from './canonical.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROLE_ALT = ROLE_SURFACES.map((r) => r.split(' ').map(esc).join('[\\s-]+')).join('|');
const VERB_ALT = VERB_SURFACES.map((v) => v.split(' ').map(esc).join('\\s+')).join('|');
const ART = '(?:(?:the|a|an)\\s+)?(?:(?:current|former|present)\\s+)?';

const PATTERNS = [
  // Is/Was X (the) ROLE of/at Y ?   |   X is (the) ROLE of Y
  ['ROLE', new RegExp(`^(?:is|was|are|were)\\s+(?<subj>.+?)\\s+${ART}(?<role>${ROLE_ALT})\\s+(?:of|at|for|in)\\s+(?<org>.+?)$`, 'i')],
  ['ROLE', new RegExp(`^(?<subj>.+?)\\s+(?:is|was|became|serves\\s+as|served\\s+as)\\s+${ART}(?<role>${ROLE_ALT})\\s+(?:of|at|for|in)\\s+(?<org>.+?)$`, 'i')],
  ['ROLE', new RegExp(`^(?<subj>.+?)\\s+(?<role>${ROLE_ALT})\\s+(?:of|at)\\s+(?<org>.+?)$`, 'i')],
  // "GV Selvam vice president VIT": accepted only when the last part is a known organisation
  ['ROLE_KNOWN_ORG', new RegExp(`^(?<subj>.+?)\\s+(?:is\\s+)?${ART}(?<role>${ROLE_ALT})\\s+(?<org>.+?)$`, 'i')],
  // Location
  ['LOCATION', new RegExp('^(?:is|was|are)\\s+(?<subj>.+?)\\s+(?:located|situated|based|headquartered)\\s+in\\s+(?<obj>.+?)$', 'i')],
  ['LOCATION', new RegExp('^(?<subj>.+?)\\s+(?:is\\s+|are\\s+)?(?:located|situated|based|headquartered)\\s+in\\s+(?<obj>.+?)$', 'i')],
  // Founded by
  ['FOUNDED', new RegExp('^(?:was|is)\\s+(?<subj>.+?)\\s+(?:founded|established)\\s+by\\s+(?<obj>.+?)$', 'i')],
  ['FOUNDED', new RegExp('^(?:who\\s+founded)\\s+(?<subj>.+?)$', 'i')],
  ['FOUNDED', new RegExp('^(?<subj>.+?)\\s+(?:was\\s+)?(?:founded|established)\\s+by\\s+(?<obj>.+?)$', 'i')],
  // Events: Did/Does/Has/Will X VERB Y ?   |   X (will) VERB Y
  ['EVENT', new RegExp(`^(?:did|does|do|has|have|had|will|is|are|was)\\s+(?<subj>.+?)\\s+(?<verb>${VERB_ALT})\\s+(?<obj>.+?)$`, 'i')],
  ['EVENT', new RegExp(`^(?<subj>.+?)\\s+(?:will\\s+|has\\s+|have\\s+|to\\s+|may\\s+|might\\s+)?(?<verb>${VERB_ALT})\\s+(?<obj>.+?)$`, 'i')],
  // Who / what is X ?
  ['ENTITY', new RegExp('^(?:who|what)\\s+(?:is|was|are|were)\\s+(?<subj>.+?)$', 'i')],
];

/** Keep the user's capitalisation when it looks deliberate, otherwise title-case. */
function tidyName(text, person) {
  const t = String(text || '').replace(/^(?:the)\s+/i, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (person) {
    // "gv selvam" -> "GV Selvam" -> "G. V. Selvam": short lower-case words are initials
    const words = t.split(' ').map((w) => {
      if (w !== w.toLowerCase()) return w;
      return w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
    });
    return displayPersonName(words.join(' '));
  }
  if (t === t.toLowerCase()) {
    return t.split(' ').map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }
  return displayOrgName(t);
}

/**
 * @param {string} query
 * @param {{ entityName?: (text) => string|null }} opts  resolves dictionary
 *        aliases to their canonical entity name (e.g. "vit" -> "VIT")
 */
export function parseQuery(query, opts = {}) {
  const raw = String(query || '').replace(/\s+/g, ' ').trim();
  const q = raw.replace(/[?.!]+$/, '').trim();
  const known = (text, person) => opts.entityName?.(text) || tidyName(text, person);
  const topic = { queryType: 'TOPIC_SEARCH', queryText: raw, subject: null, predicate: null, object: null, qualifier: null, claimType: null, text: null };

  for (const [kind, re] of PATTERNS) {
    const m = re.exec(q);
    if (!m) continue;
    const g = m.groups;
    if (kind === 'ROLE' || kind === 'ROLE_KNOWN_ORG') {
      if (kind === 'ROLE_KNOWN_ORG' && !opts.entityName?.(g.org)) continue;
      const role = canonicalRole(g.role);
      if (!role || g.subj.split(' ').length > 6 || g.org.split(' ').length > 8) continue;
      const h = { queryType: 'CLAIM_QUERY', queryText: raw, claimType: 'ROLE_RELATION', subject: known(g.subj, true), subjectType: 'PERSON', predicate: 'HOLDS_ROLE', object: role, qualifier: known(g.org, false), qualifierType: 'ORGANISATION' };
      return { ...h, text: canonicalText(h) };
    }
    if (kind === 'LOCATION') {
      const h = { queryType: 'CLAIM_QUERY', queryText: raw, claimType: 'LOCATION_RELATION', subject: known(g.subj, false), subjectType: 'ORGANISATION', predicate: 'LOCATED_IN', object: known(g.obj, false), objectType: 'LOCATION', qualifier: null };
      return { ...h, text: canonicalText(h) };
    }
    if (kind === 'FOUNDED') {
      if (!g.obj) return { ...topic, queryType: 'ENTITY_QUERY', subject: known(g.subj, false), subjectType: 'ORGANISATION' };
      const h = { queryType: 'CLAIM_QUERY', queryText: raw, claimType: CLAIM_TYPE_OF('FOUNDED_BY'), subject: known(g.subj, false), subjectType: 'ORGANISATION', predicate: 'FOUNDED_BY', object: known(g.obj, true), objectType: 'PERSON', qualifier: null };
      return { ...h, text: canonicalText(h) };
    }
    if (kind === 'EVENT') {
      // Same action registry, targets and safeguards as the evidence extractor
      const verb = VERB_LOOKUP.get(g.verb.toLowerCase().replace(/\s+/g, ' '));
      if (!verb || g.subj.split(' ').length > 5 || rejectsVerb(verb, g.obj, ` ${g.obj}`)) continue;
      const object = cleanEventObject(g.obj) || g.obj.replace(/^(?:a|an|the)\s+/i, '');
      if (isNonObject(g.obj, object)) continue;
      const target = actionTarget(verb, ` ${g.obj}`);
      const actor = canonicalActor(g.subj);
      const h = {
        queryType: 'CLAIM_QUERY', queryText: raw, claimType: 'EVENT_ACTION',
        subject: actor !== g.subj.replace(/^the\s+/i, '').trim() ? actor : known(g.subj, false), subjectType: 'ORGANISATION',
        predicate: verb.code, verbPast: verb.past, verbBase: verb.base, object,
        qualifier: target, qualifierType: target ? 'LOCATION' : null,
      };
      return { ...h, text: canonicalText(h) };
    }
    if (kind === 'ENTITY') {
      return { ...topic, queryType: 'ENTITY_QUERY', subject: known(g.subj, /^[a-z]/i.test(g.subj) && g.subj.split(' ').length <= 4), subjectType: null };
    }
  }
  return topic;
}
