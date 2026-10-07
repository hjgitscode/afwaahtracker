import config from '../config/index.js';

/** fetch() with a timeout and a descriptive User-Agent. */
export async function fetchWithTimeout(url, { accept = '*/*', timeoutMs = config.ingestion.requestTimeoutMs } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.ingestion.userAgent, Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  }
  return res;
}

export async function fetchJson(url, opts) {
  const res = await fetchWithTimeout(url, { accept: 'application/json', ...opts });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${new URL(url).hostname} was not valid JSON: ${text.slice(0, 120)}`);
  }
}

export async function fetchText(url, opts) {
  const res = await fetchWithTimeout(url, opts);
  return res.text();
}

/** Run async `fn` over `items` with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function describeFetchError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'The source did not respond in time.';
  const cause = err.cause && (err.cause.code || err.cause.message);
  if (cause && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR/.test(cause)) {
    return `Source unavailable (${cause}). Check the internet connection.`;
  }
  return err.message || String(err);
}
