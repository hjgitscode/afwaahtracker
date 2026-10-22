/**
 * Deterministic proposition extraction: one sentence -> at most one
 * structured proposition { subject, predicate, object, qualifier }.
 *
 * Only explicit sentence patterns are recognised (regular expressions over
 * the role and verb dictionaries in lexicon.js). If no pattern fits, the
 * result is null and the sentence stays plain evidence; nothing is guessed.
 *
 * Patterns (extraction_basis):
 *   ROLE:IS            "X is / serves as / has been the Vice President of Y"
 *   ROLE:APPOINTED     "X was appointed (as) Director of Y"
 *   ROLE:APPOSITIVE    "X, Vice President of Y, said ..."
 *   ROLE:ORG_TITLE     "Y Vice President X ..."            (Y must be a known organisation)
 *   ROLE:TITLE_NAME    "Vice President of Y, X"  /  "Vice President X"
 *   ROLE:NAME_LINE     "X, Vice President"                 (profile/listing line)
 *   LOCATION:IN        "X is located / based / headquartered in Y"
 *   ORG:FOUNDED_BY     "X was founded by Y"
 *   ORG:MEMBER_OF      "X is a member of Y"
 *   ORG:OWNS           "X owns Y"  /  "Y is owned by X"
 *   EVENT:VERB         "X launched / postponed / visited ... Y"
 *   EVENT:PASSIVE      "Y was launched by X"
 * A role sentence without a stated organisation takes the organisation from
 * the page context (publisher / title) only when it is a known entity or the
 * investigated organisation; basis then ends in "+PAGE_QUALIFIER".
 */
import { ROLE_SURFACES, canonicalRole, VERB_SURFACES, VERB_LOOKUP, CLAIM_TYPE_OF } from './lexicon.js';
import { displayPersonName, displayOrgName } from './names.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Case-insensitive alternation for dictionary words inside case-sensitive patterns
const ci = (word) => word.split('').map((c) => (/[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : (c === ' ' ? '[\\s-]+' : esc(c)))).join('');

const ROLE = `(?<role>${ROLE_SURFACES.map(ci).join('|')})`;
const ROLE2 = ROLE.replace('?<role>', '?<role2>');
const HONOR = '(?:(?:Dr|Prof|Mr|Mrs|Ms|Shri|Sri|Smt|Sir)\\.?\\s+)?';
// Person: optional honorific, up to three initials ("G. V.", "GV", "G V"), then 1-3 capitalised words
const PERSON_CORE = `${HONOR}(?:(?:[A-Z]{1,2}\\.?\\s*){1,3}\\s*)?[A-Z][a-z][A-Za-z'’-]+(?:\\s+[A-Z][a-z][A-Za-z'’-]+){0,2}`;
const PERSON = `(?<person>${PERSON_CORE})`;
// Organisation / place: capitalised words with of/and/for connectors, optional "(ACRONYM)"
const ORG_CORE = `(?:[Tt]he\\s+)?[A-Z][A-Za-z0-9&'’.-]*(?:\\s+(?:of|and|for|&|de|on)\\s+[A-Z][A-Za-z0-9&'’.-]*|\\s+[A-Z][A-Za-z0-9&'’.-]*){0,6}(?:\\s*\\([A-Z]{2,8}\\))?`;
const ORG = `(?<org>${ORG_CORE})`;
const IS = "(?:,\\s*)?(?:who\\s+)?(?:is|was|has\\s+been|had\\s+been|serves\\s+as|served\\s+as|is\\s+serving\\s+as|currently\\s+serves\\s+as|is\\s+currently|is\\s+presently|works\\s+as|worked\\s+as|acts\\s+as|remains|became|continues\\s+as)";
const ART = '(?:(?:the|a|an)\\s+)?(?:(?:current|incumbent|former|founding|then|present|acting|newly\\s+appointed)\\s+)?';
const PREP = '(?:of|at|for|in)';

const ROLE_PATTERNS = [
  ['ROLE:IS', new RegExp(`${PERSON}\\s*${IS}\\s+${ART}${ROLE}\\s+${PREP}\\s+${ORG}`)],
  ['ROLE:APPOINTED', new RegExp(`${PERSON}\\s+(?:has\\s+been\\s+|was\\s+|is\\s+|were\\s+)?(?:appointed|named|elected|designated|promoted|nominated)\\s+(?:as\\s+|to\\s+the\\s+post\\s+of\\s+|to\\s+)?${ART}${ROLE}\\s+${PREP}\\s+${ORG}`)],
  ['ROLE:APPOSITIVE', new RegExp(`${PERSON},\\s+${ART}${ROLE}\\s+${PREP}\\s+${ORG}`)],
  ['ROLE:TITLE_NAME', new RegExp(`${ROLE}\\s+${PREP}\\s+${ORG},\\s+${PERSON}`)],
];
// "Director of VIT Dr. Ravi Kumar": no comma, so the organisation is accepted
// only as the longest known-organisation prefix of the words after the role
const TITLE_REST = new RegExp(`${ROLE}\\s+${PREP}\\s+(?<rest>[A-Z][^,;:!?]{2,90})`);
// Organisation-first form, accepted only when the organisation is a known entity
const ORG_TITLE = new RegExp(`(?<org>[A-Z][A-Za-z0-9&-]{1,40}(?:\\s+(?:of\\s+)?[A-Z][A-Za-z0-9&-]+){0,4}?)(?:'s|’s)?\\s+${ROLE}\\s+${PERSON}`, 'g');
// Role without organisation (organisation taken from page context)
const ROLE_NO_ORG = [
  ['ROLE:IS', new RegExp(`${PERSON}\\s*${IS}\\s+${ART}${ROLE}\\b(?!\\s+(?:of|at|for|in)\\s+[A-Z])`)],
  ['ROLE:APPOINTED', new RegExp(`${PERSON}\\s+(?:has\\s+been\\s+|was\\s+|is\\s+)?(?:appointed|named|elected|designated)\\s+(?:as\\s+)?${ART}${ROLE}\\b(?!\\s+(?:of|at|for|in)\\s+[A-Z])`)],
  ['ROLE:NAME_LINE', new RegExp(`^${PERSON}\\s*[,–—:-]\\s*${ART}${ROLE}\\s*(?:[,–—|-]\\s*${ORG})?\\s*\\.?$`)],
  ['ROLE:TITLE_NAME', new RegExp(`^${ROLE}\\s*[,:–—-]?\\s+${PERSON}\\s*\\.?$`)],
  ['ROLE:TITLE_NAME', new RegExp(`(?:^|[,;]\\s*|\\b(?:by|with|said|says|according\\s+to)\\s+)${ART}${ROLE2}\\s+${PERSON}`)],
];

const LOCATION_RE = new RegExp(`(?<subj>${ORG_CORE})\\s*,?\\s+(?:(?:is|are|was|remains)\\s+)?(?:located|situated|based|headquartered)\\s+in\\s+(?:the\\s+)?(?<place>[A-Z][A-Za-z.-]+(?:\\s+[A-Z][A-Za-z.-]+){0,3}(?:,\\s*[A-Z][A-Za-z.-]+(?:\\s+[A-Z][A-Za-z.-]+)?)?)`);
const FOUNDED_RE = new RegExp(`(?<subj>${ORG_CORE})\\s+(?:was|were|had\\s+been)\\s+(?:founded|established|set\\s+up|started)\\s+(?:in\\s+\\d{4}\\s+)?by\\s+(?<obj>${PERSON_CORE}|${ORG_CORE})`);
const MEMBER_RE = new RegExp(`(?<subj>${PERSON_CORE}|${ORG_CORE})\\s+(?:is|was|has\\s+been|became)\\s+(?:a|an)\\s+(?:\\w+\\s+)?member\\s+of\\s+(?:the\\s+)?(?<obj>${ORG_CORE})`);
const OWNS_RE = new RegExp(`(?<subj>${ORG_CORE})\\s+(?:owns|acquired\\s+ownership\\s+of)\\s+(?<obj>${ORG_CORE})`);
const OWNED_BY_RE = new RegExp(`(?<obj>${ORG_CORE})\\s+(?:is|was)\\s+owned\\s+by\\s+(?<subj>${ORG_CORE})`);

const VERB_ALT = VERB_SURFACES.map((v) => v.split(' ').map(esc).join('\\s+')).join('|');
const MODAL = '(?:(?:will|would|may|might|could|can|shall|to|plans\\s+to|plan\\s+to|set\\s+to|is\\s+set\\s+to|are\\s+set\\s+to|is\\s+expected\\s+to|are\\s+expected\\s+to|is\\s+likely\\s+to|has|have|had|is|are|was|were|reportedly|officially|finally|also|not|did\\s+not|does\\s+not|didn[’\']t|doesn[’\']t|has\\s+not|won[’\']t)\\s+){0,3}';
// "Zorbania council", "Delhi police": a proper name plus an institutional noun
const INSTITUTION = `[A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?(?:\\s+(?:city|state|national|district|local|high|state-run))?\\s+(?:council|government|police|court|board|ministry|university|college|company|team|officials|administration|authorities|committee|union|cabinet|parliament|airport|hospital|school|club|municipality|corporation)`;
const EVENT_RE = new RegExp(`(?<subj>${INSTITUTION}|${ORG_CORE}|${PERSON_CORE})\\s+${MODAL}(?<verb>${VERB_ALT})\\b\\s*(?<obj>[^,.;:!?]{2,90})?`);
const PASSIVE_RE = new RegExp(`(?<obj>(?:[Tt]he\\s+)?[A-Z][^,.;:!?]{1,70}?)\\s+(?:was|were|has\\s+been|have\\s+been|is|are|will\\s+be)\\s+(?<verb>${VERB_ALT})\\s+by\\s+(?<subj>${ORG_CORE}|${PERSON_CORE})`);

const STOP_OBJ = /\s+(?:again|soon|later|now|today|yet|too|once\s+more|as\s+well|in|at|on|for|to|after|before|amid|following|as|from|with|by|over|despite|until|during|this|next|last|which|that|who|while|because|said|says|according|and\s+(?:said|says|added))\b.*$/i;
const MONTHS_ALT = 'January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const PLACE_AFTER = new RegExp(`\\b(?:in|at)\\s+(?!(?:${MONTHS_ALT})\\b)(?<place>[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})`);
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const DATE_RE = new RegExp(`\\b(?:(?:on\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:,?\\s+\\d{4})?|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|(?:in\\s+)?(?:${MONTHS})\\s+\\d{4}|next\\s+(?:week|month|year)|this\\s+(?:week|month|year)|tomorrow|today|yesterday|(?:in\\s+)?(?:19|20)\\d{2})\\b`, 'i');
const PRONOUN_SUBJ = /^(?:it|he|she|they|we|i|you|this|that|these|those|there|here|the\s+company|the\s+university|the\s+institute)$/i;
const BAD_SUBJ = /^(?:The|A|An|In|On|At|For|With|After|Before|When|While|If|But|And|Or|So|However|Meanwhile|Also|Earlier|Today|Yesterday|Now|Last|Next|This|That)$/;

function cleanOrg(text) {
  let t = displayOrgName(text).replace(/\s*\(([A-Z]{2,8})\)$/, '');
  t = t.replace(/\s+(?:and|of|for|the)$/i, '');
  return t;
}

function acronymInParens(text) {
  const m = /\(([A-Z]{2,8})\)\s*$/.exec(String(text || ''));
  return m ? m[1] : null;
}

function isPlausibleName(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 60) return false;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  return !BAD_SUBJ.test(words[0]);
}

// PAST only when the matched relation itself is in the past ("former Director",
// "X was / served as Director"), never because some other clause uses "was".
function temporalOf(matchText, sentence, role) {
  if (role && new RegExp(`\\b(?:former|formerly|ex-|previously|erstwhile)\\s*(?:the\\s+)?${esc(role)}`, 'i').test(sentence)) return 'PAST';
  if (/\b(?:was|were|served\s+as|had\s+been|worked\s+as|until)\b/i.test(matchText) && !/\b(?:appointed|named|elected)\b/i.test(matchText)) return 'PAST';
  return null;
}

/**
 * Certainty of the stated proposition (modal-aware). Explicit wording only:
 * DENIED > QUESTIONED > POSSIBLE > EXPECTED > CONFIRMED > UNSTATED.
 */
export function certaintyOf(sentence) {
  const t = String(sentence || '').toLowerCase();
  if (/\b(?:denies|denied|deny|not true|false|fake|hoax|no evidence|did not|does not|didn['’]t|doesn['’]t|has not|won['’]t)\b/.test(t)) return 'DENIED';
  if (/\?\s*$/.test(t) || /\b(?:is it true|fact check|fact-check)\b/.test(t)) return 'QUESTIONED';
  if (/\b(?:may|might|could|possibly|reportedly|rumou?red|allegedly|sources say|is said to|are said to|likely)\b/.test(t)) return 'POSSIBLE';
  if (/\b(?:will|expected to|set to|plans? to|scheduled|upcoming|poised to)\b/.test(t)) return 'EXPECTED';
  if (/\b(?:confirm(?:s|ed)?|officially|official statement)\b/.test(t)) return 'CONFIRMED';
  return 'UNSTATED';
}

// "The university was founded by ..." -> the page's own organisation
const GENERIC_SUBJECT = /^(?:the\s+)(?:university|institute|institution|college|school|company|firm|organisation|organization|group|trust|society|campus)\b/i;

function eventTemporal(sentence) {
  return /\b(?:will|to\s+be|set\s+to|plans?\s+to|is\s+expected\s+to|are\s+expected\s+to|upcoming|scheduled)\b/i.test(sentence) ? 'FUTURE' : null;
}

function cleanEventObject(raw) {
  if (!raw) return null;
  let t = raw.replace(STOP_OBJ, '').trim();
  t = t.replace(/^(?:a|an|the|its|their|his|her)\s+/i, '').replace(/\s+/g, ' ');
  const words = t.split(' ').filter(Boolean).slice(0, 8);
  t = words.join(' ').replace(/[\s'"“”‘’-]+$/, '');
  return t.length >= 2 ? t : null;
}

/**
 * Extract one proposition from a sentence.
 * ctx = {
 *   knownOrg(text) -> { name } | null    (dictionary / investigated organisation)
 *   contextOrg: string | null            (organisation named by the page itself)
 *   subjectPattern: RegExp | null         (investigated subject, alias-tolerant)
 * }
 */
export function extractProposition(sentence, ctx = {}) {
  let s = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (s.length < 8 || s.length > 600) return null;
  if (ctx.contextOrg && GENERIC_SUBJECT.test(s)) s = s.replace(GENERIC_SUBJECT, ctx.contextOrg);
  const certainty = certaintyOf(s);

  const role = (m, basis, orgText, qualifierFromContext = false) => {
    const roleName = canonicalRole(m.groups.role || m.groups.role2);
    const person = (m.groups.person || '').trim();
    if (!roleName || !isPlausibleName(person)) return null;
    let qualifier = orgText ? cleanOrg(orgText) : null;
    if (qualifier && !isPlausibleName(qualifier)) qualifier = null;
    return {
      claimType: 'ROLE_RELATION',
      predicate: 'HOLDS_ROLE',
      subject: displayPersonName(person),
      subjectSurface: person,
      subjectType: 'PERSON',
      object: roleName,
      qualifier,
      qualifierSurface: orgText || null,
      qualifierAcronym: acronymInParens(orgText),
      qualifierType: 'ORGANISATION',
      temporal: temporalOf(m[0], s, roleName),
      certainty,
      basis: qualifierFromContext ? `${basis}+PAGE_QUALIFIER` : basis,
    };
  };

  // 1. Role relations with an explicit organisation
  for (const [basis, re] of ROLE_PATTERNS) {
    const m = re.exec(s);
    if (m) {
      const p = role(m, basis, m.groups.org);
      if (p && p.qualifier) return p;
    }
  }
  const tr = TITLE_REST.exec(s);
  if (tr && ctx.knownOrg) {
    const words = tr.groups.rest.split(/\s+/);
    for (let n = Math.min(6, words.length - 1); n >= 1; n -= 1) {
      const org = ctx.knownOrg(words.slice(0, n).join(' '));
      if (!org) continue;
      const pm = new RegExp(`^${PERSON}`).exec(words.slice(n).join(' '));
      if (pm) {
        const p = role({ groups: { role: tr.groups.role, person: pm.groups.person }, 0: tr[0] }, 'ROLE:TITLE_NAME', org.name);
        if (p) return p;
      }
      break;
    }
  }
  // "VIT Vice President Dr G V Selvam": the organisation must be a known one
  if (ctx.knownOrg) {
    ORG_TITLE.lastIndex = 0;
    for (let ot = ORG_TITLE.exec(s); ot; ot = ORG_TITLE.exec(s)) {
      const words = ot.groups.org.split(/\s+/);
      for (let i = 0; i < words.length; i += 1) {
        const org = ctx.knownOrg(words.slice(i).join(' '));
        if (org) {
          const p = role(ot, 'ROLE:ORG_TITLE', org.name);
          if (p) return p;
        }
      }
    }
  }
  // 2. Role relations whose organisation comes from the page itself
  for (const [basis, re] of ROLE_NO_ORG) {
    const m = re.exec(s);
    if (!m) continue;
    if (m.groups.org) {
      const p = role(m, basis, m.groups.org);
      if (p) return p;
    }
    if (ctx.contextOrg) {
      const p = role(m, basis, ctx.contextOrg, true);
      if (p) return p;
    }
    // A bare "X is Vice President" without any organisation is too vague
  }

  // 3. Location
  const loc = LOCATION_RE.exec(s);
  if (loc) {
    const subj = cleanOrg(loc.groups.subj);
    const place = displayOrgName(loc.groups.place);
    if (isPlausibleName(subj) && !PRONOUN_SUBJ.test(subj) && place) {
      return {
        claimType: 'LOCATION_RELATION', predicate: 'LOCATED_IN', subject: subj, subjectSurface: loc.groups.subj,
        subjectType: 'ORGANISATION', object: place, objectType: 'LOCATION', qualifier: null, temporal: null,
        certainty, basis: 'LOCATION:IN',
      };
    }
  }

  // 4. Organisation relations
  for (const [re, predicate, basis, objType] of [
    [FOUNDED_RE, 'FOUNDED_BY', 'ORG:FOUNDED_BY', 'PERSON'],
    [MEMBER_RE, 'MEMBER_OF', 'ORG:MEMBER_OF', 'ORGANISATION'],
    [OWNED_BY_RE, 'OWNS', 'ORG:OWNS', 'ORGANISATION'],
    [OWNS_RE, 'OWNS', 'ORG:OWNS', 'ORGANISATION'],
  ]) {
    const m = re.exec(s);
    if (!m) continue;
    const subj = cleanOrg(m.groups.subj);
    const obj = objType === 'PERSON' ? displayPersonName(m.groups.obj) : cleanOrg(m.groups.obj);
    if (!isPlausibleName(subj) || PRONOUN_SUBJ.test(subj) || !obj) continue;
    return {
      claimType: CLAIM_TYPE_OF(predicate), predicate, subject: subj, subjectSurface: m.groups.subj,
      subjectType: predicate === 'MEMBER_OF' && /^[A-Z][a-z]+\s+[A-Z]/.test(subj) ? 'PERSON' : 'ORGANISATION',
      object: obj, objectType: objType, qualifier: null, temporal: null, certainty, basis,
    };
  }

  // 5. Events (actor + action + object)
  for (const [re, basis] of [[PASSIVE_RE, 'EVENT:PASSIVE'], [EVENT_RE, 'EVENT:VERB']]) {
    const m = re.exec(s);
    if (!m) continue;
    const verb = VERB_LOOKUP.get(m.groups.verb.toLowerCase().replace(/\s+/g, ' '));
    const subj = cleanOrg(m.groups.subj);
    if (!verb || !isPlausibleName(subj) || PRONOUN_SUBJ.test(subj) || BAD_SUBJ.test(subj)) continue;
    // "announced for receiving the Doctorate": the verb has no direct object
    if (/^\s*(?:for|as|with|of|about|into|from|by)\b/i.test(m.groups.obj || '')) continue;
    let object = cleanEventObject(m.groups.obj);
    // "perform at VIT" / "visited Mumbai": the place is the object
    if (!object && (verb.code === 'VISITED' || verb.code === 'PERFORMED_AT')) continue;
    if (!object) continue;
    if (/^(?:to|that|it|this|them|him|her|us|up|out|down|back)\b/i.test(object)) continue;
    const after = s.slice(m.index + m[0].length - (m.groups.obj ? m.groups.obj.length : 0));
    const place = PLACE_AFTER.exec(after)?.groups.place || null;
    return {
      claimType: 'EVENT_ACTION',
      predicate: verb.code,
      verbBase: verb.base,
      verbPast: verb.past,
      subject: /^[A-Z]{2,}$/.test(subj) || subj.split(' ').length > 3 ? subj : displayOrgName(subj),
      subjectSurface: m.groups.subj,
      subjectType: 'ORGANISATION',
      object,
      qualifier: null,
      location: place,
      date: DATE_RE.exec(s)?.[0]?.replace(/^(?:on|in)\s+/i, '') || null,
      temporal: eventTemporal(s),
      certainty,
      basis,
    };
  }
  return null;
}

export { DATE_RE };

// A quantity needs a unit or a sign; a bare year ("2026") is a date, not a quantity
const QUANTITY_RE = /(?:[$₹€£]\s?\d[\d,.]*(?:\s*(?:million|billion|crore|lakh|thousand))?|\b\d[\d,.]*\s*(?:%|percent|per\s+cent|minutes?|hours?|days?|weeks?|months?|years?|million|billion|crore|lakh|thousand|people|users|students|employees|graduates|times|km|kg|tonnes?)\b)/i;
export function quantityOf(sentence) {
  const m = QUANTITY_RE.exec(String(sentence || ''));
  return m ? m[0].replace(/[,.]+$/, '').trim().slice(0, 80) : null;
}

const PERSON_ONLY = new RegExp(`^${PERSON_CORE}\\.?$`);
const ROLE_ONLY = new RegExp(`^${ART}${ROLE}(?:\\s*(?:&|and|,)\\s*[A-Z][A-Za-z ]{2,30})?\\.?$`);
/** A short block that is just a person's name ("Dr. G. V. Selvam"). */
export const looksLikePersonName = (t) => PERSON_ONLY.test(String(t || '').trim()) && !ROLE_ONLY.test(String(t || '').trim());
/** A short block that is just a job title ("Vice President", "Founder & Chancellor"). */
export const looksLikeRoleLabel = (t) => ROLE_ONLY.test(String(t || '').trim());
