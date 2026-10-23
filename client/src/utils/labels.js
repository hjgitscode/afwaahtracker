/**
 * Wording rules. Curated demonstration data keeps the plain terms
 * (Independent / Derived / Echo Ratio). Live data only knows the dependence it
 * could detect, so it says so: "No known upstream source", "Known derived",
 * "Known Echo Ratio".
 */
export const KNOWN_ECHO_TOOLTIP =
  'Known Echo Ratio measures observable source dependence among retrieved sources. Sources without a detected parent are not proven independent, and the ratio does not measure truthfulness.';
export const NO_UPSTREAM_NOTE = 'No explicit upstream dependencies were detected among these retrieved sources.';
export const DEMO_ECHO_TOOLTIP = 'Echo Ratio measures source dependence, not truthfulness.';

export const isDemo = (origin) => origin === 'DEMO';

export const echoLabel = (demo) => (demo ? 'Echo Ratio' : 'Known Echo Ratio');
export const echoTooltip = (demo) => (demo ? DEMO_ECHO_TOOLTIP : KNOWN_ECHO_TOOLTIP);

export function dependencyLabel(derived, demo) {
  if (demo) return derived ? 'Derived' : 'Independent';
  return derived ? 'Known derived' : 'No known upstream source';
}

export const RETRIEVAL_LABEL = {
  DEMO: 'Demo',
  AUTOMATED: 'Feed',
  FEED: 'Feed',
  WEB_SEARCH: 'Web search',
  MANUAL: 'Manual',
};

export const LINEAGE_BASIS_LABEL = {
  CURATED: 'Curated',
  MANUAL: 'Manual',
  EXPLICIT_REFERENCE: 'Known reference',
  ATTRIBUTION_REFERENCE: 'Known attribution',
  PROPOSITION_PREDECESSOR: 'Inferred predecessor',
  LEXICAL_PREDECESSOR: 'Inferred predecessor',
  AUTO_ROOT: 'Inferred predecessor',
  NONE: 'No known parent',
};

export const REFERENCE_TYPE_LABEL = {
  HYPERLINK: 'Hyperlink',
  SUBMITTED_LINK: 'Submitted link',
  CANONICAL_REFERENCE: 'Canonical reference',
  ATTRIBUTION: 'Attribution',
  MANUAL: 'Manual',
  KNOWN_UPSTREAM: 'Known upstream',
};

export const NOT_DETERMINED = 'Not determined';

/** How a claim family found relates to what was investigated (SEARCH_CLAIM_MATCHES). */
export const RELATIONSHIP_LABEL = {
  EXACT: ['Matches the searched relationship', 'green'],
  DIFFERENT_VALUE: ['Related claim found', 'amber'],
  RELATED: ['Same subject, different relationship', 'blue'],
  TOPICAL: ['Topically related', 'muted'],
};

export const PREDICATE_TEXT = {
  HOLDS_ROLE: 'holds role', LOCATED_IN: 'located in', MEMBER_OF: 'member of', FOUNDED_BY: 'founded by', OWNS: 'owns',
  ANNOUNCED: 'announced', LAUNCHED: 'launched', CANCELLED: 'cancelled', POSTPONED: 'postponed', VISITED: 'visited',
  PERFORMED_AT: 'performed at', RELEASED: 'released', ACQUIRED: 'acquired', BANNED: 'banned', OPENED: 'opened',
  CLOSED: 'closed', APPROVED: 'approved', REJECTED: 'rejected', SIGNED: 'signed', RESIGNED_FROM: 'resigned from',
  IMPOSED: 'imposed', RAISED: 'raised', CUT: 'cut', EXTENDED: 'extended', SUSPENDED: 'suspended', WITHDREW: 'withdrew',
  REMOVED: 'removed', LIFTED: 'lifted', PASSED: 'passed', INTRODUCED: 'introduced', ARRESTED: 'arrested', DETAINED: 'detained',
  CHARGED: 'charged', CONVICTED: 'convicted', ACQUITTED: 'acquitted', SUED: 'sued', FINED: 'fined', WON: 'won', LOST: 'lost',
  ELECTED: 'elected', APPOINTED: 'appointed', DISMISSED: 'dismissed', MET: 'met', WARNED: 'warned', CONFIRMED: 'confirmed', DENIED: 'denied',
};
