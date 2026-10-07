import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import ClaimCard from '../components/claim/ClaimCard.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import { EmptyState, ErrorState, LoadingCards } from '../components/ui/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { ECHO_BANDS } from '../utils/echo.js';

const STATUSES = ['CURATED', 'UNVERIFIED', 'DEVELOPING', 'CORROBORATED', 'DISPUTED', 'DEBUNKED', 'CANDIDATE'];
const SORTS = [
  ['', 'Best match'],
  ['newest', 'Newest'],
  ['sources', 'Most sources'],
  ['echo', 'Highest echo'],
  ['platforms', 'Most platforms'],
];
const SOURCE_TYPES = [
  ['DEMO', 'Demo data'],
  ['AUTOMATED', 'Automated (any)'],
  ['GDELT', 'GDELT'],
  ['HACKER_NEWS', 'Hacker News'],
  ['RSS', 'RSS / Atom'],
  ['MANUAL', 'Manual'],
];
const FILTER_KEYS = ['platform', 'category', 'status', 'echoBand', 'dateFrom', 'dateTo', 'sourceType', 'sort'];
const PAGE = 24;

function Select({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="meta-label mb-1.5 block">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

export default function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get('q') || '');
  const [showFilters, setShowFilters] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  const q = params.get('q') || '';
  useEffect(() => setDraft(q), [q]);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const key = params.toString();
  useEffect(() => setLimit(PAGE), [key]);

  const platforms = useApi((signal) => api.platforms({ signal }), [], { refetchOnRefresh: false });
  const categories = useApi((signal) => api.categories({ signal }), [], { refetchOnRefresh: false });
  const result = useApi((signal) => api.claims({ q, ...filters, limit }, { signal }), [key, limit]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const submit = (e) => {
    e.preventDefault();
    setParam('q', draft.trim());
  };
  const activeFilters = FILTER_KEYS.filter((k) => k !== 'sort' && filters[k]).length;
  const clear = () => setParams(q ? { q } : {}, { replace: true });

  const data = result.data;

  return (
    <div className="relative">
      <Watermark word="EXPLORE" style={{ top: -30, right: -20 }} />
      <PageHeader label="Claim database" title="Explore claims" subtitle="Search claim families by wording, person, place, event, keyword or publisher. Every filter runs as an Oracle query." />

      <form onSubmit={submit} className="card relative z-10 flex flex-col gap-3 p-3 sm:flex-row" role="search">
        <label className="relative flex-1">
          <span className="sr-only">Search claims</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={19} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search a claim, person, place, event or keyword…" className="field h-12 rounded-full border-transparent bg-tint/60 pl-11" />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowFilters((s) => !s)} className="btn btn-ghost h-12" aria-expanded={showFilters}>
            <SlidersHorizontal size={16} /> Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          <button type="submit" className="btn btn-primary h-12 flex-1 sm:flex-none">Search</button>
        </div>
      </form>

      {showFilters && (
        <div className="card relative z-10 mt-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Select label="Platform" value={filters.platform} onChange={(v) => setParam('platform', v)}>
            <option value="">All platforms</option>
            {platforms.data?.map((p) => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
          </Select>
          <Select label="Category" value={filters.category} onChange={(v) => setParam('category', v)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
          </Select>
          <Select label="Status" value={filters.status} onChange={(v) => setParam('status', v)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'CURATED' ? 'All except candidates' : s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </Select>
          <Select label="Echo band" value={filters.echoBand} onChange={(v) => setParam('echoBand', v)}>
            <option value="">Any echo ratio</option>
            {ECHO_BANDS.map((b) => <option key={b.key} value={b.key}>{b.short} ({b.range})</option>)}
          </Select>
          <label className="block">
            <span className="meta-label mb-1.5 block">Seen from</span>
            <input type="date" className="field" value={filters.dateFrom} onChange={(e) => setParam('dateFrom', e.target.value)} />
          </label>
          <label className="block">
            <span className="meta-label mb-1.5 block">Seen until</span>
            <input type="date" className="field" value={filters.dateTo} onChange={(e) => setParam('dateTo', e.target.value)} />
          </label>
          <Select label="Source type" value={filters.sourceType} onChange={(v) => setParam('sourceType', v)}>
            <option value="">All source types</option>
            {SOURCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
      )}

      <div className="relative z-10 mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[15px] text-ink-2">
          {data ? (
            <>
              <b className="text-ink">{data.total}</b> claim famil{data.total === 1 ? 'y' : 'ies'}
              {q && <> for “<b className="text-ink">{q}</b>”</>}
            </>
          ) : ' '}
          {activeFilters > 0 && (
            <button type="button" onClick={clear} className="ml-3 inline-flex items-center gap-1 text-[13px] font-bold uppercase tracking-[0.05em] text-primary hover:text-primary-hover">
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
        <label className="flex items-center gap-2">
          <span className="meta-label">Sort</span>
          <select className="field w-44 py-2" value={filters.sort} onChange={(e) => setParam('sort', e.target.value)}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <div className="relative z-10 mt-5">
        {result.error ? (
          <ErrorState error={result.error} onRetry={result.reload} />
        ) : !data && result.loading ? (
          <LoadingCards count={6} />
        ) : data.claims.length === 0 ? (
          <div className="card">
            <EmptyState title="No claims found" action={activeFilters ? <button type="button" className="btn btn-ghost" onClick={clear}>Clear filters</button> : null}>
              Try fewer words, a person or place name, or remove some filters.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className={`grid gap-5 md:grid-cols-2 xl:grid-cols-3 ${result.loading ? 'opacity-60' : ''}`}>
              {data.claims.map((c) => <ClaimCard key={c.claim_id} claim={c} />)}
            </div>
            {data.total > data.claims.length && (
              <div className="mt-8 text-center">
                <button type="button" className="btn btn-secondary" onClick={() => setLimit((l) => l + PAGE)} disabled={result.loading}>
                  Show more claims
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
