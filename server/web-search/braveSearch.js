/**
 * Brave Search API client (standard Web Search endpoint).
 *
 * The API key is read from server/.env (BRAVE_SEARCH_API_KEY) and is only ever
 * sent to Brave in the X-Subscription-Token header. It is never returned to
 * the browser, logged or stored in Oracle.
 *
 * Results are "publicly indexed sources": title, URL, snippet, domain, rank and
 * Brave's page age when it has one. Nothing here scrapes a search engine.
 */
import config from '../config/index.js';
import { cleanText, domainOf } from '../ingestion/normalizer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WebSearchUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'WEB_SEARCH_UNAVAILABLE';
  }
}

export function isWebSearchConfigured() {
  return Boolean(config.webSearch.braveApiKey);
}

async function requestPage(query, offset) {
  const { braveApiKey, braveEndpoint, resultsPerPage, country } = config.webSearch;
  const url = new URL(braveEndpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(resultsPerPage));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('result_filter', 'web');
  if (country) url.searchParams.set('country', country);

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': braveApiKey,
        'User-Agent': config.ingestion.userAgent,
      },
      signal: AbortSignal.timeout(config.ingestion.requestTimeoutMs),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'timed out' : (err.cause?.code || err.message);
    throw new WebSearchUnavailableError(`Brave Search could not be reached (${why}).`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new WebSearchUnavailableError('Brave Search rejected the API key. Check BRAVE_SEARCH_API_KEY in server/.env.');
  }
  if (res.status === 429) {
    throw new WebSearchUnavailableError('Brave Search rate limit reached. Try again in a moment.');
  }
  if (!res.ok) {
    throw new WebSearchUnavailableError(`Brave Search returned HTTP ${res.status}.`);
  }
  const body = await res.json().catch(() => null);
  if (!body) throw new WebSearchUnavailableError('Brave Search returned an unreadable response.');
  return {
    results: Array.isArray(body.web?.results) ? body.web.results : [],
    more: Boolean(body.query?.more_results_available),
  };
}

/**
 * Returns up to pages * resultsPerPage results as
 * { rank, title, url, snippet, domain, publisher, pageAge }.
 */
export async function braveWebSearch(query) {
  if (!isWebSearchConfigured()) {
    throw new WebSearchUnavailableError('Live web search unavailable — BRAVE_SEARCH_API_KEY is not set.');
  }
  const out = [];
  for (let page = 0; page < config.webSearch.pages; page += 1) {
    // The free Brave plan allows one request per second.
    if (page > 0) await sleep(1100);
    let res;
    try {
      res = await requestPage(query, page);
    } catch (err) {
      if (page === 0) throw err;
      break; // keep the results of earlier pages
    }
    for (const r of res.results) {
      if (!r || !r.url) continue;
      out.push({
        rank: out.length + 1,
        title: cleanText(r.title || '', 1000),
        url: r.url,
        snippet: cleanText([r.description, ...(r.extra_snippets || []).slice(0, 1)].filter(Boolean).join(' '), 1000) || null,
        domain: r.meta_url?.hostname?.replace(/^www\./, '') || domainOf(r.url),
        publisher: r.profile?.name ? cleanText(r.profile.name, 200) : null,
        pageAge: r.page_age || null,
      });
    }
    if (!res.more || !res.results.length) break;
  }
  return out;
}
