/**
 * Polite, bounded fetching of public web pages returned by the search API.
 *
 *   - http(s) only; hosts that resolve to private, loopback or link-local
 *     addresses are refused (redirects are followed manually and re-checked)
 *   - robots.txt is honoured for the page path (cached per host)
 *   - per-page timeout and maximum download size
 *   - only HTML is read; anything else is reported as unsupported
 * Failures never throw out of fetchPage(): the caller falls back to the search
 * result's own title and snippet.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import config from '../config/index.js';

const MAX_REDIRECTS = 4;
const robotsCache = new Map();

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicHost(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) pages are fetched');
  if (config.webSearch.allowPrivateHosts) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Private host refused');
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Private network address refused');
  }
}

async function readLimited(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      chunks.push(Buffer.from(value.subarray(0, Math.max(0, value.byteLength - (size - maxBytes)))));
      break; // keep the first maxBytes: the head and opening text are what we need
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function request(rawUrl, { timeoutMs, accept }) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': config.ingestion.userAgent,
        Accept: accept,
        'Accept-Language': 'en;q=0.9, *;q=0.5',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    return { res, finalUrl: url.toString() };
  }
  throw new Error('Too many redirects');
}

function robotsAllows(robotsText, path) {
  // Minimal robots.txt reader: the "*" group (or one naming AfwaahTracker),
  // longest matching Allow/Disallow prefix wins.
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of robotsText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow')) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const group = groups.find((g) => g.agents.some((a) => a.includes('afwaahtracker'))) || groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (!rule.path) continue;
    const prefix = rule.path.replace(/\*.*$/, '').replace(/\$$/, '');
    if (path.startsWith(prefix) && (!best || prefix.length > best.len)) best = { allow: rule.allow, len: prefix.length };
  }
  return best ? best.allow : true;
}

async function allowedByRobots(url) {
  if (!config.webSearch.respectRobots) return true;
  const origin = url.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const { res } = await request(`${origin}/robots.txt`, { timeoutMs: 3500, accept: 'text/plain' });
        if (!res.ok) return '';
        return (await readLimited(res, 200_000)).toString('utf8');
      } catch {
        return ''; // unreachable robots.txt -> no restrictions known
      }
    })());
  }
  const text = await robotsCache.get(origin);
  return robotsAllows(text, url.pathname + url.search);
}

function decode(buffer, contentType) {
  const charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1] || 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * Returns { ok: true, html, finalUrl } or { ok: false, reason }.
 */
export async function fetchPage(rawUrl) {
  const { fetchTimeoutMs, fetchMaxBytes } = config.webSearch;
  try {
    const url = new URL(rawUrl);
    if (!(await allowedByRobots(url))) return { ok: false, reason: 'Disallowed by robots.txt' };
    const { res, finalUrl } = await request(url.toString(), {
      timeoutMs: fetchTimeoutMs,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `Unsupported content (${type.split(';')[0]})` };
    }
    const html = decode(await readLimited(res, fetchMaxBytes), type);
    return { ok: true, html, finalUrl };
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'Timed out'
      : err.cause?.code || err.message || 'Fetch failed';
    return { ok: false, reason: String(reason).slice(0, 200) };
  }
}

export { robotsAllows, isPrivateAddress };
