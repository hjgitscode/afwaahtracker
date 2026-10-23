/**
 * Small, explicit dictionaries for deterministic claim extraction.
 * Nothing here is learned or inferred by a model; every rule is readable.
 */

// Roles: surface forms -> canonical role. Longer forms are matched first, so
// "Vice President" never becomes "President" and "Executive Director" never
// becomes "Director". Different roles are never merged.
const ROLE_FORMS = {
  'Vice President': ['vice president', 'vice-president', 'vice presidents', 'vp'],
  'Executive Vice President': ['executive vice president', 'executive vice-president'],
  'Senior Vice President': ['senior vice president', 'senior vice-president'],
  President: ['president'],
  'Vice Chancellor': ['vice chancellor', 'vice-chancellor'],
  'Pro Vice Chancellor': ['pro vice chancellor', 'pro vice-chancellor', 'pro-vice-chancellor'],
  Chancellor: ['chancellor'],
  'Managing Director': ['managing director'],
  'Executive Director': ['executive director'],
  Director: ['director'],
  Registrar: ['registrar'],
  Dean: ['dean'],
  Principal: ['principal'],
  Founder: ['founder'],
  'Co-founder': ['co-founder', 'cofounder', 'co founder'],
  CEO: ['ceo', 'chief executive officer', 'chief executive'],
  CTO: ['cto', 'chief technology officer'],
  CFO: ['cfo', 'chief financial officer'],
  COO: ['coo', 'chief operating officer'],
  Chair: ['chairman', 'chairperson', 'chairwoman', 'chair'],
  'Vice Chair': ['vice chairman', 'vice-chairman', 'vice chairperson', 'vice chair'],
  'Prime Minister': ['prime minister'],
  'Chief Minister': ['chief minister'],
  Minister: ['minister'],
  Governor: ['governor'],
  Mayor: ['mayor'],
  Secretary: ['secretary'],
  'General Secretary': ['general secretary'],
  Treasurer: ['treasurer'],
  Professor: ['professor'],
  'Head of Department': ['head of department', 'hod'],
  Captain: ['captain'],
  Coach: ['head coach', 'coach'],
  Editor: ['editor-in-chief', 'editor in chief', 'editor'],
  Spokesperson: ['spokesperson', 'spokesman', 'spokeswoman'],
  Ambassador: ['ambassador'],
  'Chief Justice': ['chief justice'],
  Trustee: ['trustee'],
};

export const ROLE_LOOKUP = new Map();
for (const [canon, forms] of Object.entries(ROLE_FORMS)) {
  for (const f of forms) ROLE_LOOKUP.set(f, canon);
}
// Longest first so alternation prefers "vice president" over "president"
export const ROLE_SURFACES = [...ROLE_LOOKUP.keys()].sort((a, b) => b.length - a.length);

export function canonicalRole(surface) {
  const key = String(surface || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return ROLE_LOOKUP.get(key) || ROLE_LOOKUP.get(key.replace(/s$/, '')) || null;
}

/** Role code used in signatures: "Vice President" -> "VICE_PRESIDENT". */
export const roleCode = (role) => String(role || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

// ---------------------------------------------------------------------------
// ACTION / PREDICATE REGISTRY: the single source of event verbs for the query
// parser (hypothesis.js), the evidence scorer (evidence.js) and the
// proposition extractor (propositions.js). Every inflection maps to one
// canonical predicate code; different actions are never merged (RAISED is not
// IMPOSED, CUT is not REMOVED). Near-synonyms of the SAME action share a code
// (raise / increase / hike -> RAISED).
//
// [code, base verb, past form, surface forms, rules]
//   rules.target      the action has a target introduced by "on" / "against"
//                     ("imposed tariffs ON INDIA") that becomes the qualifier
//   rules.needsOn     forms valid only when that "on" target is stated
//                     ("slapped tariffs on India" -> IMPOSED; "slapped" alone is not)
//   rules.notObject   objects that mean a different sense of the verb
//                     ("fired missiles" is not DISMISSED, "passed away" is not PASSED)
// Present participles that are usually nouns ("meeting", "warning",
// "opening", "passing", "winning") are deliberately not listed.
// ---------------------------------------------------------------------------
const EVENT_VERBS = [
  ['LAUNCHED', 'launch', 'launched', ['launch', 'launches', 'launched', 'launching', 'unveil', 'unveils', 'unveiled', 'unveiling']],
  ['ANNOUNCED', 'announce', 'announced', ['announce', 'announces', 'announced', 'announcing']],
  ['CANCELLED', 'cancel', 'cancelled', ['cancel', 'cancels', 'cancelled', 'canceled', 'cancelling', 'canceling', 'scrap', 'scraps', 'scrapped', 'call off', 'called off', 'calls off']],
  ['POSTPONED', 'postpone', 'postponed', ['postpone', 'postpones', 'postponed', 'postponing', 'delay', 'delays', 'delayed', 'delaying', 'defer', 'defers', 'deferred', 'reschedule', 'reschedules', 'rescheduled']],
  ['VISITED', 'visit', 'visited', ['visit', 'visits', 'visited', 'visiting']],
  ['PERFORMED_AT', 'perform at', 'performed at', ['perform at', 'performs at', 'performed at', 'performing at', 'headline', 'headlines', 'headlined']],
  ['RELEASED', 'release', 'released', ['release', 'releases', 'released', 'releasing', 'ship', 'ships', 'shipped']],
  ['ACQUIRED', 'acquire', 'acquired', ['acquire', 'acquires', 'acquired', 'acquiring', 'buy', 'buys', 'bought']],
  ['BANNED', 'ban', 'banned', ['ban', 'bans', 'banned', 'banning', 'prohibit', 'prohibits', 'prohibited']],
  ['OPENED', 'open', 'opened', ['open', 'opens', 'opened', 'inaugurate', 'inaugurates', 'inaugurated']],
  ['CLOSED', 'close', 'closed', ['close', 'closes', 'closed', 'shut', 'shuts', 'shut down', 'shuts down']],
  ['APPROVED', 'approve', 'approved', ['approve', 'approves', 'approved', 'approving']],
  ['REJECTED', 'reject', 'rejected', ['reject', 'rejects', 'rejected', 'rejecting']],
  ['SIGNED', 'sign', 'signed', ['sign', 'signs', 'signed', 'signing']],
  ['RESIGNED_FROM', 'resign from', 'resigned from', ['resign from', 'resigns from', 'resigned from', 'quit', 'quits', 'steps down from', 'stepped down from']],
  // trade, tax and policy measures
  ['IMPOSED', 'impose', 'imposed', ['impose', 'imposes', 'imposed', 'imposing', 'levy', 'levies', 'levied', 'levying', 'slap', 'slaps', 'slapped', 'slapping'],
    { target: true, needsOn: ['slap', 'slaps', 'slapped', 'slapping'] }],
  ['RAISED', 'raise', 'raised', ['raise', 'raises', 'raised', 'raising', 'increase', 'increases', 'increased', 'increasing', 'hike', 'hikes', 'hiked', 'hiking'], { target: true }],
  ['CUT', 'cut', 'cut', ['cut', 'cuts', 'cutting', 'reduce', 'reduces', 'reduced', 'reducing', 'slash', 'slashes', 'slashed', 'slashing'], { target: true }],
  ['EXTENDED', 'extend', 'extended', ['extend', 'extends', 'extended', 'extending'], { target: true }],
  ['SUSPENDED', 'suspend', 'suspended', ['suspend', 'suspends', 'suspended', 'suspending'], { target: true }],
  ['WITHDREW', 'withdraw', 'withdrew', ['withdraw', 'withdraws', 'withdrew', 'withdrawn', 'withdrawing']],
  ['REMOVED', 'remove', 'removed', ['remove', 'removes', 'removed', 'removing'], { target: true }],
  ['LIFTED', 'lift', 'lifted', ['lift', 'lifts', 'lifted', 'lifting'], { target: true }],
  ['PASSED', 'pass', 'passed', ['pass', 'passes', 'passed'], { notObject: /^(?:away|out|by|through|on)\b/i }],
  ['INTRODUCED', 'introduce', 'introduced', ['introduce', 'introduces', 'introduced', 'introducing']],
  // law and order
  ['ARRESTED', 'arrest', 'arrested', ['arrest', 'arrests', 'arrested', 'arresting']],
  ['DETAINED', 'detain', 'detained', ['detain', 'detains', 'detained', 'detaining']],
  ['CHARGED', 'charge', 'charged', ['charge', 'charges', 'charged'], { notObject: /^(?:a\s+fee|fees?|rs|₹|\$|money|interest|batter(?:y|ies))\b/i }],
  ['CONVICTED', 'convict', 'convicted', ['convict', 'convicts', 'convicted']],
  ['ACQUITTED', 'acquit', 'acquitted', ['acquit', 'acquits', 'acquitted']],
  ['SUED', 'sue', 'sued', ['sue', 'sues', 'sued', 'suing']],
  ['FINED', 'fine', 'fined', ['fines', 'fined', 'fining']],
  // contests and offices
  ['WON', 'win', 'won', ['win', 'wins', 'won']],
  ['LOST', 'lose', 'lost', ['lose', 'loses', 'lost']],
  ['ELECTED', 'elect', 'elected', ['elect', 'elects', 'elected']],
  ['APPOINTED', 'appoint', 'appointed', ['appoint', 'appoints', 'appointed', 'appointing']],
  ['DISMISSED', 'dismiss', 'dismissed', ['dismiss', 'dismisses', 'dismissed', 'fire', 'fires', 'fired', 'sack', 'sacks', 'sacked'],
    { notObject: /\b(?:missiles?|shots?|rockets?|bullets?|rounds?|guns?|tear\s+gas|weapons?|salvos?|shells?|drones?|warning\s+shots?)\b/i }],
  // statements and meetings
  ['MET', 'meet', 'met', ['meet', 'meets', 'met']],
  ['WARNED', 'warn', 'warned', ['warn', 'warns', 'warned']],
  ['CONFIRMED', 'confirm', 'confirmed', ['confirm', 'confirms', 'confirmed']],
  ['DENIED', 'deny', 'denied', ['deny', 'denies', 'denied', 'denying']],
];

export const VERB_LOOKUP = new Map();
for (const [code, base, past, forms, rules = {}] of EVENT_VERBS) {
  for (const f of forms) VERB_LOOKUP.set(f, { code, base, past, surface: f, ...rules });
}
export const VERB_SURFACES = [...VERB_LOOKUP.keys()].sort((a, b) => b.length - a.length);
export const PREDICATE_CODES = [...new Set(EVENT_VERBS.map(([code]) => code))];

// Statement verbs: the verb itself is not a certainty marker for the claim
// ("The minister denied the allegation" is a stated denial, not a denied claim)
export const STATEMENT_PREDICATES = new Set(['CONFIRMED', 'DENIED']);

// Actors named by their capital in news copy ("Washington slapped tariffs")
// and country short forms. Applied to the SUBJECT only; "visited New Delhi"
// keeps New Delhi as the place.
const ACTOR_ALIASES = {
  'United States': ['us', 'u.s.', 'u.s', 'usa', 'u.s.a.', 'united states', 'united states of america', 'america', 'washington'],
  'United Kingdom': ['uk', 'u.k.', 'britain', 'great britain', 'united kingdom'],
  China: ['china', 'beijing'],
  Russia: ['russia', 'moscow'],
  India: ['india', 'new delhi'],
  'European Union': ['eu', 'e.u.', 'european union', 'brussels'],
};
const ACTOR_LOOKUP = new Map(Object.entries(ACTOR_ALIASES).flatMap(([canon, forms]) => forms.map((f) => [f, canon])));
/** "The US" / "Washington" -> "United States"; anything else unchanged. */
export function canonicalActor(text) {
  const t = String(text || '').replace(/^the\s+/i, '').trim();
  return ACTOR_LOOKUP.get(t.toLowerCase()) || t;
}

// Demonyms in targets: "tariffs on Indian goods" -> target India
const DEMONYMS = {
  indian: 'India', chinese: 'China', american: 'United States', us: 'United States', 'u.s.': 'United States',
  russian: 'Russia', canadian: 'Canada', mexican: 'Mexico', japanese: 'Japan', brazilian: 'Brazil',
  british: 'United Kingdom', european: 'European Union', pakistani: 'Pakistan', bangladeshi: 'Bangladesh',
  german: 'Germany', french: 'France', korean: 'South Korea', vietnamese: 'Vietnam', turkish: 'Turkey',
  australian: 'Australia', iranian: 'Iran', israeli: 'Israel', ukrainian: 'Ukraine', swiss: 'Switzerland',
};
const TARGET_RE = /\b(?:on|against)\s+(?:the\s+)?(?:(?:imports?|goods|products|exports|shipments|steel|cars|vehicles)\s+(?:from|of)\s+)?(?<t>[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,2})/;
const NOT_TARGET = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/;

/**
 * Target of a targeted action, read from the text right after the verb:
 * "tariffs on Indian imports" -> "India", "sanctions against Russia" -> "Russia".
 * Returns null when the action takes no target or none is stated.
 */
export function actionTarget(verb, textAfterVerb) {
  if (!verb?.target) return null;
  const m = TARGET_RE.exec(String(textAfterVerb || ''));
  if (!m || NOT_TARGET.test(m.groups.t)) return null;
  const words = m.groups.t.replace(/\.+$/, '').split(/\s+/);
  const demonym = DEMONYMS[words[0].toLowerCase()];
  if (demonym) return demonym;
  return canonicalActor(words.join(' '));
}

/**
 * Text that cannot be the object of an action: a time or place phrase
 * ("meet on Tuesday", "increased in March") or a bare adverb ("increased
 * sharply"). Shared by the query parser and the proposition extractor.
 */
export function isNonObject(objectText, cleanedObject) {
  const raw = String(objectText || '');
  if (/^\s*(?:for|as|with|of|about|into|from|by|on|in|at|over|after|before|during|until|since|next|this|today|tomorrow|yesterday)\b/i.test(raw)) return true;
  return /^[a-z]+ly$/i.test(String(cleanedObject ?? raw).trim());
}

/** Verb-specific safeguards: true when this verb reading must be rejected. */
export function rejectsVerb(verb, objectText, textAfterVerb) {
  if (!verb) return true;
  if (verb.needsOn?.includes(verb.surface) && !TARGET_RE.test(String(textAfterVerb || ''))) return true;
  if (verb.notObject && verb.notObject.test(String(objectText || '').trim())) return true;
  return false;
}

export const PREDICATE_LABEL = {
  HOLDS_ROLE: 'holds role',
  LOCATED_IN: 'located in',
  MEMBER_OF: 'member of',
  FOUNDED_BY: 'founded by',
  OWNS: 'owns',
  ...Object.fromEntries(EVENT_VERBS.map(([code, , past]) => [code, past])),
};

export const CLAIM_TYPE_OF = (predicate) => {
  if (predicate === 'HOLDS_ROLE') return 'ROLE_RELATION';
  if (predicate === 'LOCATED_IN') return 'LOCATION_RELATION';
  if (['MEMBER_OF', 'FOUNDED_BY', 'OWNS'].includes(predicate)) return 'ORGANISATION_RELATION';
  return 'EVENT_ACTION';
};

// Text that marks navigation, menus and boilerplate rather than statements
export const BOILERPLATE = /\b(home|login|log in|sign in|sign up|subscribe|newsletter|cookie|cookies|privacy policy|terms of use|all rights reserved|copyright|click here|read more|skip to|menu|follow us|share this|advertisement|download app)\b/i;
