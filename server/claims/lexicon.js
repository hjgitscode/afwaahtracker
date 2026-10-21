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

// Event verbs: every inflection -> [predicate code, base verb, past form]
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
  ['OPENED', 'open', 'opened', ['open', 'opens', 'opened', 'opening', 'inaugurate', 'inaugurates', 'inaugurated']],
  ['CLOSED', 'close', 'closed', ['close', 'closes', 'closed', 'closing', 'shut', 'shuts', 'shut down', 'shuts down']],
  ['APPROVED', 'approve', 'approved', ['approve', 'approves', 'approved', 'approving']],
  ['REJECTED', 'reject', 'rejected', ['reject', 'rejects', 'rejected', 'rejecting']],
  ['SIGNED', 'sign', 'signed', ['sign', 'signs', 'signed', 'signing']],
  ['RESIGNED_FROM', 'resign from', 'resigned from', ['resign from', 'resigns from', 'resigned from', 'quit', 'quits', 'steps down from', 'stepped down from']],
];

export const VERB_LOOKUP = new Map();
for (const [code, base, past, forms] of EVENT_VERBS) {
  for (const f of forms) VERB_LOOKUP.set(f, { code, base, past });
}
export const VERB_SURFACES = [...VERB_LOOKUP.keys()].sort((a, b) => b.length - a.length);

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
