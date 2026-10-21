/**
 * Deterministic metadata and text extraction from an HTML page (cheerio).
 * Priority order for every field is fixed and documented below; when a field
 * cannot be found it is returned as null ("Not determined"), never guessed.
 *
 *   title        og:title > twitter:title > JSON-LD headline > first <h1> > <title>
 *   publisher    og:site_name > JSON-LD publisher.name > application-name
 *   author       JSON-LD author.name > meta[name=author] > article:author > rel=author
 *   published    article:published_time > JSON-LD datePublished > meta date fields
 *                > first <time datetime>
 *   canonical    <link rel=canonical>  (falls back to og:url)
 *   blocks/text  readable blocks inside <article>, else <main>, else <body>
 */
import * as cheerio from 'cheerio';
import { cleanText, normaliseUrl, toDate } from '../ingestion/normalizer.js';
import { extractOutboundLinks } from './referenceExtractor.js';

const NEWS_TYPES = /^(NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|Article|BlogPosting|LiveBlogPosting|OpinionNewsArticle)$/;

function jsonLdNodes($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const n = stack.shift();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray(n['@graph'])) stack.push(...n['@graph']);
        nodes.push(n);
      }
    } catch {
      /* malformed JSON-LD is ignored */
    }
  });
  return nodes;
}

const nameOf = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(nameOf).filter(Boolean).join(', ') || null;
  return v.name || null;
};

function validDate(value) {
  const d = toDate(value);
  if (!d) return null;
  // Reject placeholders and dates in the future (beyond clock skew)
  if (d.getFullYear() < 1995 || d.getTime() > Date.now() + 36 * 3600 * 1000) return null;
  return d;
}

export function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = (selector) => {
    const v = $(selector).first().attr('content');
    return v && v.trim() ? v.trim() : null;
  };
  const ld = jsonLdNodes($);
  const article = ld.find((n) => [].concat(n['@type'] || []).some((t) => NEWS_TYPES.test(t))) || null;
  const articleType = article ? [].concat(article['@type'])[0] : null;

  const title = cleanText(
    meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || article?.headline
      || $('h1').first().text() || $('title').first().text(),
    1000
  ) || null;

  const publisher = cleanText(
    meta('meta[property="og:site_name"]') || nameOf(article?.publisher) || meta('meta[name="application-name"]') || '',
    200
  ) || null;

  const author = cleanText(
    nameOf(article?.author) || meta('meta[name="author"]') || meta('meta[property="article:author"]')
      || $('a[rel="author"]').first().text() || '',
    200
  ) || null;

  const publishedAt = validDate(meta('meta[property="article:published_time"]'))
    || validDate(article?.datePublished)
    || validDate(meta('meta[name="date"]') || meta('meta[name="pubdate"]') || meta('meta[name="publish-date"]')
      || meta('meta[itemprop="datePublished"]') || meta('meta[name="dc.date"]') || meta('meta[name="DC.date.issued"]'))
    || validDate($('time[datetime]').first().attr('datetime'))
    || null;

  const canonicalRaw = $('link[rel="canonical"]').first().attr('href') || meta('meta[property="og:url"]');
  let canonicalUrl = null;
  if (canonicalRaw) {
    try {
      canonicalUrl = normaliseUrl(new URL(canonicalRaw, pageUrl).toString());
    } catch {
      canonicalUrl = null;
    }
  }

  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const outboundLinks = extractOutboundLinks($, pageUrl);

  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg').remove();
  const scope = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');

  // Readable blocks in document order: headings, paragraphs, list items,
  // table cells and short leaf elements. Profile pages often put a name and a
  // title in separate small elements ("Dr. G. V. Selvam" / "Vice President"),
  // which paragraph-only extraction would lose. Blocks feed evidence selection.
  const BLOCK = 'h1,h2,h3,h4,h5,p,li,dt,dd,td,th,blockquote,figcaption,div,span,strong,b';
  const CONTAINER = 'h1,h2,h3,h4,h5,p,li,dl,ul,ol,table,tr,blockquote,figure,div,section,article';
  const blocks = [];
  scope.find(BLOCK).each((_, el) => {
    if (blocks.length >= 300) return false;
    const node = $(el);
    const tag = el.tagName?.toLowerCase();
    // Containers are represented by their children; inline tags only when they stand alone
    if (node.find(CONTAINER).length) return undefined;
    if ((tag === 'span' || tag === 'strong' || tag === 'b') && node.parent().closest(BLOCK).length) return undefined;
    const t = cleanText(node.text(), 1200);
    if (!t || (blocks.length && blocks[blocks.length - 1] === t)) return undefined;
    blocks.push(t);
    return undefined;
  });
  // Stored with line breaks so a later investigation can re-read the blocks
  const text = blocks.join('\n').slice(0, 3900) || null;

  const ogType = meta('meta[property="og:type"]');
  return {
    title,
    publisher,
    author,
    publishedAt,
    canonicalUrl,
    description: description ? cleanText(description, 1000) : null,
    text,
    blocks,
    outboundLinks,
    isArticle: Boolean(articleType && articleType !== 'BlogPosting') || ogType === 'article',
    isBlogPosting: articleType === 'BlogPosting',
  };
}
