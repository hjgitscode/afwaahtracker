/**
 * Dictionary-based entity recognition (no AI).
 *
 * Every alias in ENTITY_ALIASES is compared with the normalised text of an
 * incoming item using whole-word phrase matching. Short all-capital aliases
 * (VIT, WHO, AI, EU ...) are matched case-sensitively against the original
 * text so that ordinary words such as "who" are not mistaken for them.
 *
 * Capitalised multi-word phrases that are not in the dictionary are returned
 * as "entity candidates"; their type is deliberately not guessed.
 */
import { normaliseText, STOP_WORDS } from './normalizer.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { loadedAt: 0, aliases: [], keywords: [] };

export async function loadDictionary(db, { force = false } = {}) {
  if (!force && Date.now() - cache.loadedAt < CACHE_TTL_MS && cache.aliases.length) return cache;

  const aliasRows = await db.rows(
    `SELECT e.entity_id, e.entity_name, e.entity_type, a.alias_text
       FROM entity_aliases a
       JOIN entities e ON e.entity_id = a.entity_id`
  );
  const keywordRows = await db.rows(`SELECT keyword_id, keyword_text FROM keywords`);

  const aliases = aliasRows
    .map((r) => {
      const caseSensitive = /^[A-Z0-9]{2,5}s?$/.test(r.alias_text);
      return {
        entityId: r.entity_id,
        name: r.entity_name,
        type: r.entity_type,
        alias: r.alias_text,
        norm: normaliseText(r.alias_text),
        caseSensitive,
        regex: caseSensitive ? new RegExp(`(^|[^A-Za-z0-9])${r.alias_text}([^A-Za-z0-9]|$)`) : null,
      };
    })
    .filter((a) => a.norm.length > 1)
    // Longer aliases first so "VIT Vellore" is preferred over "VIT"
    .sort((a, b) => b.norm.length - a.norm.length);

  const keywords = keywordRows.map((k) => ({ id: k.keyword_id, text: k.keyword_text, norm: normaliseText(k.keyword_text) }));

  cache = { loadedAt: Date.now(), aliases, keywords };
  return cache;
}

export function invalidateDictionary() {
  cache.loadedAt = 0;
}

function containsPhrase(normText, phrase) {
  if (!phrase) return false;
  return ` ${normText} `.includes(` ${phrase} `);
}

/** Returns unique entities found in the text: [{entityId, name, type, alias}] */
export function detectEntities(text, dictionary) {
  const normText = normaliseText(text);
  const found = new Map();
  for (const a of dictionary.aliases) {
    if (found.has(a.entityId)) continue;
    const hit = a.caseSensitive ? a.regex.test(text) : containsPhrase(normText, a.norm);
    if (hit) found.set(a.entityId, { entityId: a.entityId, name: a.name, type: a.type, alias: a.alias });
  }
  return [...found.values()];
}

// Regular inflections accepted after a keyword stem: launch -> launches, launched, launching
const INFLECTIONS = ['s', 'es', 'ed', 'd', 'ing'];

/** Known dictionary keywords present in the text (whole-word, inflection-tolerant). */
export function detectKnownKeywords(text, dictionary) {
  const normText = normaliseText(text);
  const out = [];
  for (const k of dictionary.keywords) {
    if (containsPhrase(normText, k.norm)
        || (k.norm.length > 3 && INFLECTIONS.some((suffix) => containsPhrase(normText, `${k.norm}${suffix}`)))) {
      out.push(k);
    }
  }
  return out;
}

/**
 * Capitalised phrases (2-4 words) that are not covered by any known alias.
 * Stored in ENTITY_CANDIDATES for later curation; type is not inferred.
 */
export function detectEntityCandidates(title, knownEntities) {
  const known = knownEntities.map((e) => normaliseText(e.alias));
  const out = new Set();
  const re = /\b([A-Z][a-zA-Z0-9&.-]+(?:\s+(?:of|the|and|de|for)?\s*[A-Z][a-zA-Z0-9&.-]+){1,3})/g;
  let m;
  while ((m = re.exec(title)) !== null) {
    const phrase = m[1].replace(/\s+/g, ' ').trim();
    const norm = normaliseText(phrase);
    const words = norm.split(' ');
    if (words.length < 2 || words.every((w) => STOP_WORDS.has(w))) continue;
    if (/^(show|ask|tell|launch) hn$/.test(norm)) continue;
    if (known.some((k) => norm.includes(k) || k.includes(norm))) continue;
    out.add(phrase.slice(0, 200));
    if (out.size >= 3) break;
  }
  return [...out];
}
