/**
 * Wording rules. Curated demonstration data keeps the plain terms
 * (Independent / Derived / Echo Ratio). Live data only knows the dependence it
 * could detect, so it says so: "No known upstream source", "Known derived",
 * "Known Echo Ratio".
 */
export const KNOWN_ECHO_TOOLTIP =
  'Known Echo Ratio measures detected source dependence among retrieved sources. It does not prove that sources without a known parent are independent, and it does not measure truthfulness.';
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
  EXPLICIT_REFERENCE: 'Explicit reference',
  LEXICAL_PREDECESSOR: 'Inferred predecessor',
  AUTO_ROOT: 'Inferred predecessor',
  NONE: 'No known parent',
};

export const REFERENCE_TYPE_LABEL = {
  HYPERLINK: 'Hyperlink',
  SUBMITTED_LINK: 'Submitted link',
  CANONICAL_REFERENCE: 'Canonical reference',
  MANUAL: 'Manual',
};

export const NOT_DETERMINED = 'Not determined';
