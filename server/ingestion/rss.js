/**
 * RSS / Atom adapter using rss-parser. Feeds are configured in the
 * INGESTION_SOURCES registry (source_type = 'RSS').
 */
import Parser from 'rss-parser';
import { fetchText } from './http.js';
import { makeItem } from './normalizer.js';

const parser = new Parser({
  customFields: { item: [['dc:creator', 'dcCreator'], ['media:description', 'mediaDescription']] },
});

export async function fetchRss(source) {
  const xml = await fetchText(source.endpoint_url, {
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  });
  let feed;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    throw new Error(`Feed could not be parsed as RSS/Atom (${err.message})`);
  }
  const publisher = (feed.title || source.source_name || '').trim();

  return (feed.items || [])
    .slice(0, source.max_items || 20)
    .map((it) => {
      const link = it.link || (typeof it.guid === 'string' && /^https?:/.test(it.guid) ? it.guid : null);
      return makeItem({
        // Feeds share the "News Website" platform, so GUIDs are not globally
        // unique; duplicates are detected by normalised URL instead.
        externalId: null,
        title: it.title,
        url: link,
        publisher,
        author: it.creator || it.dcCreator || it.author || null,
        publishedAt: it.isoDate || it.pubDate,
        snippet: it.contentSnippet || it.summary || it.mediaDescription || null,
        engagement: 0,
      });
    })
    .filter(Boolean);
}
