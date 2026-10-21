/**
 * Deterministic text and URL normalisation used by the ingestion pipeline.
 * No AI / ML: lower-casing, punctuation removal, tokenising, a small
 * built-in stop-word list and a light singular/plural normalisation.
 */

export const STOP_WORDS = new Set(`
a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having
he her here hers herself him himself his how i if in into is it its itself just me more most my myself no
nor not now of off on once only or other our ours ourselves out over own same she should so some such than
that the their theirs them themselves then there these they this those through to too under until up very
was we were what when where which while who whom why will with would you your yours yourself yourselves
says said say new news via amid after over into per vs versus get gets got make makes made one two three
first last year years day days week weeks today yesterday tomorrow report reports reported according
may might must shall s t re ve ll d m
`.trim().split(/\s+/));

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8217': "'", '#8216': "'", '#8220': '"', '#8221': '"', '#8211': '-', '#8212': '-', hellip: '...', mdash: '-', ndash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };

export function decodeEntities(text) {
  return String(text || '').replace(/&(#?[a-z0-9]+);/gi, (m, key) => {
    const k = key.toLowerCase();
    if (HTML_ENTITIES[k] !== undefined) return HTML_ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(Number.parseInt(k.slice(2), 16) || 32);
    if (k.startsWith('#')) return String.fromCodePoint(Number.parseInt(k.slice(1), 10) || 32);
    return m;
  });
}

/** Strip HTML tags/entities and collapse whitespace. */
export function cleanText(text, maxLength = 4000) {
  const out = decodeEntities(String(text || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
}

/** Lower-case, remove accents and punctuation, collapse whitespace. */
export function normaliseText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Very small singular normalisation ("exams" -> "exam", "stories" -> "story"). */
export function singular(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(ch|sh|x|z|ss)es$/.test(token)) return token.slice(0, -2);
  if (/(ss|us|is|os|as)$/.test(token)) return token;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/** Tokenise normalised text and drop stop words / very short tokens. */
export function tokenize(text) {
  return normaliseText(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function significantTokens(text) {
  return tokenize(text).filter((t) => t.length >= 3 && !/^\d+$/.test(t)).map(singular);
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|ocid|at_medium|at_campaign|at_custom\d*)$/i;

/**
 * Normalise a URL so the same article fetched twice is stored once:
 * lower-case host, drop fragments and tracking parameters, drop trailing slash.
 * Returns null for anything that is not http(s).
 */
export function normaliseUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  let out = url.toString();
  if (url.pathname !== '/' && out.endsWith('/') && !url.search) out = out.slice(0, -1);
  if (out.length > 1000) return null;
  return out;
}

export function domainOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Canonical item shape produced by every adapter.
 */
export function makeItem({ externalId, title, url, linkedUrl, publisher, author, publishedAt, snippet, engagement, unknownDate = 'now' }) {
  const cleanTitle = cleanText(title, 1000);
  const normUrl = normaliseUrl(url);
  if (!cleanTitle || !normUrl) return null;
  // Feeds stamp an undated item with the fetch time; web pages keep an
  // unknown publication date as null ("Not determined").
  const published = toDate(publishedAt) || (unknownDate === 'now' ? new Date() : null);
  return {
    externalId: externalId ? String(externalId).slice(0, 100) : null,
    title: cleanTitle,
    url: normUrl,
    linkedUrl: normaliseUrl(linkedUrl),
    publisher: cleanText(publisher || domainOf(normUrl) || 'Unknown publisher', 200),
    author: author ? cleanText(author, 200) : null,
    // A publication time in the future is clamped to "now"
    publishedAt: published && published > new Date() ? new Date() : published,
    // Page text keeps one block per line (re-read by later investigations)
    snippet: snippet
      ? String(snippet).split('\n').map((l) => cleanText(l, 1200)).filter(Boolean).join('\n').slice(0, 3900) || null
      : null,
    engagement: Number.isFinite(Number(engagement)) ? Math.max(0, Math.round(Number(engagement))) : 0,
  };
}
