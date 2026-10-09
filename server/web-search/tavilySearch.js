/**
 * Tavily Search API adapter (basic search depth, one request per investigation).
 *
 * The API key is read from server/.env (TAVILY_API_KEY) and is only ever sent
 * to Tavily in the Authorization header. It is never returned to the browser,
 * logged or stored in Oracle.
 *
 * Results are mapped to the common shape used by the investigation pipeline:
 *   { rank, title, url, snippet, domain, publisher, publishedAt, score, provider }
 * Tavily does not name the publisher, so it is derived from the hostname; a
 * publication date is only used when Tavily supplies one, otherwise it stays
 * null and the page extractor tries to find it on the page itself.
 */
import config from '../config/index.js';
import { cleanText, domainOf, toDate } from '../ingestion/normalizer.js';
import { WebSearchUnavailableError } from './searchErrors.js';

export const PROVIDER = 'TAVILY';

export function isConfigured() {
  return Boolean(config.webSearch.tavilyApiKey);
}

function friendlyHttpError(status) {
  if (status === 401 || status === 403) return 'The web search service rejected the API key. Check TAVILY_API_KEY in server/.env.';
  if (status === 429) return 'The web search rate limit was reached. Try again in a moment.';
  if (status === 432 || status === 433) return 'The web search plan limit has been reached for now.';
  if (status === 400) return 'The web search service could not process this query.';
  return `The web search service returned an error (HTTP ${status}).`;
}

export async function search(query) {
  if (!isConfigured()) {
    throw new WebSearchUnavailableError('Live web search unavailable — TAVILY_API_KEY is not set.');
  }
  const { tavilyApiKey, tavilyEndpoint, maxResults } = config.webSearch;

  let res;
  try {
    res = await fetch(tavilyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${tavilyApiKey}`,
        'User-Agent': config.ingestion.userAgent,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(config.ingestion.requestTimeoutMs),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'timed out' : (err.cause?.code || 'network error');
    throw new WebSearchUnavailableError(`The web search service could not be reached (${why}).`);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new WebSearchUnavailableError(friendlyHttpError(res.status));
  }
  const body = await res.json().catch(() => null);
  if (!body || (body.results !== undefined && !Array.isArray(body.results))) {
    throw new WebSearchUnavailableError('The web search service returned an unreadable response.');
  }

  const out = [];
  for (const r of body.results || []) {
    if (!r || typeof r.url !== 'string' || !r.url) continue;
    const domain = domainOf(r.url);
    out.push({
      rank: out.length + 1,
      title: cleanText(r.title || '', 1000),
      url: r.url,
      snippet: cleanText(r.content || '', 1000) || null,
      domain,
      publisher: domain,
      publishedAt: toDate(r.published_date) || null,
      score: Number.isFinite(Number(r.score)) ? Number(r.score) : null,
      provider: PROVIDER,
    });
  }
  return out;
}
