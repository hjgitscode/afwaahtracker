/**
 * The one place the investigation pipeline talks to a web search provider.
 * WEB_SEARCH_PROVIDER selects the adapter (currently only "tavily"); every
 * adapter returns results in the same common shape.
 */
import config from '../config/index.js';
import * as tavily from './tavilySearch.js';
import { WebSearchUnavailableError } from './searchErrors.js';

const PROVIDERS = { tavily };

function current() {
  return PROVIDERS[config.webSearch.provider] || null;
}

export { WebSearchUnavailableError };

/** Provider name stored in WEB_SEARCH_RUNS / SEARCH_RESULT_LINKS. */
export function providerName() {
  return current()?.PROVIDER || String(config.webSearch.provider || 'NONE').toUpperCase();
}

export function isWebSearchConfigured() {
  return Boolean(current()?.isConfigured());
}

export async function searchWeb(query) {
  const provider = current();
  if (!provider) {
    throw new WebSearchUnavailableError('Live web search unavailable — WEB_SEARCH_PROVIDER is not supported.');
  }
  return provider.search(query);
}
