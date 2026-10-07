/**
 * GDELT DOC 2.0 API adapter (article list mode, JSON).
 * https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist&format=json
 * GDELT returns title, URL, domain and "seendate" (no body text).
 */
import { fetchJson } from './http.js';
import { makeItem } from './normalizer.js';

function parseSeenDate(value) {
  // Format: 20261007T121500Z
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export async function fetchGdelt(source) {
  const url = new URL(source.endpoint_url);
  url.searchParams.set('format', 'json');
  url.searchParams.set('mode', url.searchParams.get('mode') || 'artlist');
  url.searchParams.set('maxrecords', String(Math.min(source.max_items || 25, 250)));

  const data = await fetchJson(url.toString());
  const articles = Array.isArray(data?.articles) ? data.articles : [];

  return articles
    .filter((a) => !a.language || /english/i.test(a.language))
    .slice(0, source.max_items || 25)
    .map((a) =>
      makeItem({
        externalId: null,
        title: a.title,
        url: a.url,
        publisher: a.domain,
        publishedAt: parseSeenDate(a.seendate),
        snippet: a.sourcecountry ? `Source country: ${a.sourcecountry}` : null,
        engagement: 0,
      })
    )
    .filter(Boolean);
}
