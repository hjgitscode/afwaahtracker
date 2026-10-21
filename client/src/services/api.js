/**
 * Thin REST client for the AfwaahTracker Express API.
 * The browser only ever talks to /api; Oracle credentials stay on the server.
 */
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request(path, { method = 'GET', body, params, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(params)}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('The AfwaahTracker API could not be reached. Is the backend running on port 3000?', {
      code: 'API_UNREACHABLE',
    });
  }
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    if (!e && (res.status === 502 || res.status === 504)) {
      throw new ApiError('The AfwaahTracker API could not be reached. Is the backend running on port 3000?', {
        status: res.status,
        code: 'API_UNREACHABLE',
      });
    }
    throw new ApiError(e?.message || `Request failed (${res.status}).`, { status: res.status, code: e?.code || 'API_ERROR' });
  }
  return data;
}

export const api = {
  overview: (opts) => request('/overview', opts),
  // Live web investigation: the search API key never reaches the browser
  investigateWeb: (query) => request('/investigate-web', { method: 'POST', body: { query, async: true } }),
  webSearchStatus: (id, opts) => request(`/web-search/${id}/status`, opts),
  webSearchResults: (id, opts) => request(`/web-search/${id}/results`, opts),
  claims: (params, opts) => request('/claims', { params, ...opts }),
  claim: (id, opts) => request(`/claims/${id}`, opts),
  claimSources: (id, opts) => request(`/claims/${id}/sources`, opts),
  claimEvidence: (id, opts) => request(`/claims/${id}/evidence`, opts),
  claimInvestigation: (id, run, opts) => request(`/claims/${id}/investigation`, { params: { run }, ...opts }),
  claimMutations: (id, opts) => request(`/claims/${id}/mutations`, opts),
  claimLineage: (id, opts) => request(`/claims/${id}/claim-lineage`, opts),
  sourceLineage: (id, opts) => request(`/claims/${id}/source-lineage`, opts),
  sources: (params, opts) => request('/sources', { params, ...opts }),
  source: (id, opts) => request(`/sources/${id}`, opts),
  platforms: (opts) => request('/platforms', opts),
  ingestionStatus: (opts) => request('/ingestion/status', opts),
  refresh: () => request('/ingestion/refresh', { method: 'POST' }),
  lab: (opts) => request('/lab', opts),
  labQuery: (key, opts) => request(`/lab/queries/${encodeURIComponent(key)}`, opts),
};
