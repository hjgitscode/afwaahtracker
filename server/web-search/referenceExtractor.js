/**
 * Outbound hyperlinks of a page, normalised the same way stored source URLs
 * are, so a link can be resolved to a stored source with an index lookup.
 * Links are only CANDIDATE evidence: sourceProcessor.recordReferences turns a
 * link into a SOURCE_REFERENCES row only when it equals a stored source URL.
 * Same-topic pages without a link are never treated as references.
 */
import { normaliseUrl } from '../ingestion/normalizer.js';

const MAX_LINKS = 250;
const SKIP = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mp3|mp4|zip)(\?|$)/i;

export function extractOutboundLinks($, pageUrl) {
  const base = (() => {
    try {
      return new URL(pageUrl);
    } catch {
      return null;
    }
  })();
  if (!base) return [];
  const self = normaliseUrl(base.toString());
  const scope = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  const out = new Set();
  scope.find('a[href]').each((_, el) => {
    if (out.size >= MAX_LINKS) return false;
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return undefined;
    let abs;
    try {
      abs = new URL(href, base).toString();
    } catch {
      return undefined;
    }
    if (SKIP.test(abs)) return undefined;
    const norm = normaliseUrl(abs);
    if (norm && norm !== self) out.add(norm);
    return undefined;
  });
  return [...out];
}
