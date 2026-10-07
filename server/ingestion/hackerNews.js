/**
 * Official Hacker News Firebase API adapter.
 * https://hacker-news.firebaseio.com/v0/topstories.json  -> [ids]
 * https://hacker-news.firebaseio.com/v0/item/<id>.json   -> story
 */
import { fetchJson, mapLimit } from './http.js';
import { makeItem, cleanText, domainOf } from './normalizer.js';

export async function fetchHackerNews(source) {
  const listUrl = source.endpoint_url;
  const base = listUrl.replace(/\/[^/]+\.json(\?.*)?$/, '');
  const ids = await fetchJson(listUrl);
  if (!Array.isArray(ids)) throw new Error('Hacker News returned an unexpected story list.');

  const wanted = ids.slice(0, source.max_items || 30);
  const stories = await mapLimit(wanted, 6, (id) => fetchJson(`${base}/item/${encodeURIComponent(id)}.json`));

  return stories
    .filter((s) => s && !s.error && s.type === 'story' && !s.deleted && !s.dead && s.title)
    .map((s) => {
      const domain = s.url ? domainOf(s.url) : null;
      const text = s.text ? cleanText(s.text, 600) : '';
      const snippet = [domain ? `Submitted link: ${domain}` : 'Ask/Show HN discussion', text].filter(Boolean).join(' - ');
      return makeItem({
        externalId: String(s.id),
        title: s.title,
        url: `https://news.ycombinator.com/item?id=${s.id}`,
        linkedUrl: s.url || null,
        publisher: 'Hacker News',
        author: s.by,
        publishedAt: s.time ? new Date(s.time * 1000) : null,
        snippet,
        engagement: (s.score || 0) + (s.descendants || 0),
      });
    })
    .filter(Boolean);
}
