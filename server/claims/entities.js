/**
 * Helpers over the ENTITIES / ENTITY_ALIASES dictionary (loaded from Oracle by
 * entityMatcher.loadDictionary). Matching uses the same name key as the Oracle
 * NAME_KEY function, so "VIT", "VIT University" and
 * "Vellore Institute of Technology" all resolve to entity VIT.
 */
import { nameKey, acronymOf } from './names.js';

const ORG_WORDS = /\b(?:university|institute|institution|college|school|inc|ltd|limited|corp|corporation|company|co|group|ministry|government|department|agency|council|board|bank|foundation|trust|society|association|commission|authority|organisation|organization|party|court|police|hospital|news|times|post|tv|media|labs?|technologies|systems|motors|airlines?)\b/i;

export function makeEntityHelpers(dictionary, hypothesis = null) {
  const byKey = new Map();      // name key -> entity
  const aliasesById = new Map(); // entity id -> [alias text]
  for (const a of dictionary?.aliases || []) {
    const entity = { id: a.entityId, name: a.name, type: a.type };
    byKey.set(nameKey(a.alias), entity);
    byKey.set(nameKey(a.name), entity);
    if (!aliasesById.has(a.entityId)) aliasesById.set(a.entityId, new Set([a.name]));
    aliasesById.get(a.entityId).add(a.alias);
  }

  const lookup = (text) => {
    if (!text) return null;
    return byKey.get(nameKey(text)) || null;
  };

  /** Canonical entity name for a query fragment ("vit" -> "VIT"), or null. */
  const entityName = (text) => lookup(text)?.name || null;

  /** All known spellings of a name (entity aliases, the name itself, its acronym). */
  const aliasesFor = (name) => {
    const out = new Set([name]);
    const e = lookup(name);
    if (e) for (const a of aliasesById.get(e.id) || []) out.add(a);
    const acr = acronymOf(name);
    if (acr) out.add(acr);
    return [...out].filter((a) => a && a.length >= 2);
  };

  const qualifierKeys = new Set(hypothesis?.qualifier ? aliasesFor(hypothesis.qualifier).map(nameKey) : []);

  /** Organisation known to the dictionary or investigated by the user. */
  const knownOrg = (text) => {
    const e = lookup(text);
    if (e && (e.type === 'ORGANISATION' || e.type === 'EVENT')) return { name: e.name, id: e.id };
    if (qualifierKeys.has(nameKey(text))) return { name: hypothesis.qualifier };
    return null;
  };

  /**
   * The organisation a page speaks for: the investigated organisation when the
   * page's title / publisher / address names it, otherwise a known organisation
   * named in the title or publisher. Used only for role lines that state no
   * organisation themselves ("Dr. G. V. Selvam, Vice President").
   */
  const contextOrgFor = ({ title, publisher, url }) => {
    const hay = `${title || ''} | ${publisher || ''} | ${url || ''}`;
    if (hypothesis?.qualifier) {
      for (const a of aliasesFor(hypothesis.qualifier)) {
        if (new RegExp(`(?:^|[^A-Za-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z0-9]|$)`, 'i').test(hay)) {
          return entityName(hypothesis.qualifier) || hypothesis.qualifier;
        }
      }
    }
    for (const part of [publisher, ...(String(title || '').split(/\s*[|–—:-]\s*/))]) {
      const e = lookup(part);
      if (e && e.type === 'ORGANISATION') return e.name;
    }
    return null;
  };

  /** Entity type for a new subject: person-like names vs organisations. */
  const guessType = (text, fallback) => {
    const known = lookup(text);
    if (known) return known.type;
    if (fallback === 'PERSON' || fallback === 'LOCATION') return fallback;
    const t = String(text || '');
    if (/^[A-Z0-9&.-]{2,8}$/.test(t) || ORG_WORDS.test(t)) return 'ORGANISATION';
    return /^(?:[A-Z]\.\s?)*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(t) ? 'PERSON' : 'ORGANISATION';
  };

  return { lookup, entityName, aliasesFor, knownOrg, contextOrgFor, guessType };
}
