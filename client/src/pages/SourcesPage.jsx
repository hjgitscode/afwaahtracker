import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Badge, { DependencyBadge, MatchBadge, OriginBadge } from '../components/ui/Badge.jsx';
import ExternalLink from '../components/ui/ExternalLink.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { domainOf, formatDateTime, formatNumber, truncate } from '../utils/format.js';

const SORTS = [['newest', 'Newest'], ['oldest', 'Oldest'], ['fetched', 'Recently fetched'], ['publisher', 'Publisher A–Z'], ['engagement', 'Engagement']];
const KEYS = ['q', 'platform', 'origin', 'dependency', 'dateFrom', 'dateTo', 'sort'];

function SourceDrawer({ id, onClose }) {
  const { data, error, loading, reload } = useApi((signal) => api.source(id, { signal }), [id]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label="Source details">
      <button type="button" className="absolute inset-0 bg-navy/40" onClick={onClose} aria-label="Close details" />
      <aside className="fade-up relative h-full w-full max-w-xl overflow-y-auto bg-page p-6 shadow-hero sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="system-label">Source #{id}</div>
            <h2 className="mt-1 text-[24px] font-extrabold leading-tight text-ink">{data ? data.publisher : 'Loading…'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-2 transition-colors hover:bg-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {error && <ErrorState error={error} onRetry={reload} compact />}
        {loading && !data && <LoadingBlock rows={8} />}
        {data && (
          <div className="space-y-5">
            <div className="card p-5">
              <div className="flex flex-wrap gap-2">
                <OriginBadge origin={data.origin_type} />
                <DependencyBadge dependency={data.dependency} />
                <Badge tone="muted">{data.source_status.toLowerCase()}</Badge>
              </div>
              <p className="mt-3 text-[17px] font-bold leading-snug text-ink">{data.source_title}</p>
              {data.snippet && <p className="mt-2 text-[15px] text-ink-2">{data.snippet}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
                <div><dt className="meta-label">Platform</dt><dd className="text-ink">{data.platform_name}</dd></div>
                <div><dt className="meta-label">Published</dt><dd className="text-ink">{formatDateTime(data.published_at)}</dd></div>
                <div><dt className="meta-label">Author</dt><dd className="text-ink">{data.author || '—'}</dd></div>
                <div><dt className="meta-label">Engagement</dt><dd className="text-ink">{formatNumber(data.engagement_count)}</dd></div>
                <div><dt className="meta-label">Fetched</dt><dd className="text-ink">{formatDateTime(data.fetched_at)}</dd></div>
                <div><dt className="meta-label">Feed</dt><dd className="text-ink">{data.ingestion_source_name || '—'}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-4">
                <ExternalLink href={data.source_url}>View original</ExternalLink>
                {data.linked_url && <ExternalLink href={data.linked_url}>Submitted link</ExternalLink>}
              </div>
            </div>

            <div className="card p-5">
              <div className="meta-label mb-2">Provenance</div>
              <p className="text-[15px] text-ink-2">{data.provenance_note || 'No provenance note.'}</p>
              {data.upstream_chain.length > 1 && (
                <ol className="mt-3 space-y-1.5 text-[14px]">
                  {data.upstream_chain.map((s, i) => (
                    <li key={s.source_id} className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint text-[11px] font-bold text-primary">{i + 1}</span>
                      <span className={s.source_id === data.source_id ? 'font-bold text-ink' : 'text-ink-2'}>{s.publisher}</span>
                      <span className="text-muted">· {s.platform_name}</span>
                    </li>
                  ))}
                </ol>
              )}
              {data.derived_children.length > 0 && (
                <p className="mt-3 text-[14px] text-ink-2"><b className="text-ink">{data.derived_children.length}</b> known source{data.derived_children.length > 1 ? 's' : ''} derive from this one.</p>
              )}
            </div>

            <div className="card p-5">
              <div className="meta-label mb-3">Claims carried by this source</div>
              {data.claims.length ? data.claims.map((c) => (
                <Link key={c.variant_id} to={`/claims/${c.claim_id}`} className="group -mx-2 block rounded-lg px-2 py-2 transition-colors hover:bg-tint">
                  <div className="font-bold text-ink group-hover:text-deep">{c.canonical_claim}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    <MatchBadge method={c.match_method} /> score {c.match_score}
                  </div>
                  {c.match_breakdown && <div className="mt-1 text-[12.5px] text-muted">{c.match_breakdown}</div>}
                </Link>
              )) : <p className="text-[14px] text-muted">Not linked to a claim.</p>}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function SourcesPage() {
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(KEYS.map((k) => [k, params.get(k) || '']));
  const [draft, setDraft] = useState(f.q);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const key = params.toString();
  useEffect(() => setOffset(0), [key]);
  useEffect(() => setDraft(f.q), [f.q]);

  const platforms = useApi((signal) => api.platforms({ signal }), [], { refetchOnRefresh: false });
  const { data, error, loading, reload } = useApi((signal) => api.sources({ ...f, offset, limit: 25 }, { signal }), [key, offset]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="relative">
      <Watermark word="SOURCES" style={{ top: -30, right: -30 }} />
      <PageHeader label="Source registry" title="Sources" subtitle="Every stored article, post, story and forward — collected automatically or included as demonstration data." />

      <div className="card relative z-10 p-5">
        <form onSubmit={(e) => { e.preventDefault(); setParam('q', draft.trim()); }} className="flex flex-col gap-3 md:flex-row" role="search">
          <label className="relative flex-1">
            <span className="sr-only">Search sources</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Publisher, title, URL / domain, author or claim…" className="field pl-11" />
          </label>
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <select className="field" value={f.platform} onChange={(e) => setParam('platform', e.target.value)} aria-label="Platform">
            <option value="">All platforms</option>
            {platforms.data?.map((p) => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
          </select>
          <select className="field" value={f.origin} onChange={(e) => setParam('origin', e.target.value)} aria-label="Origin">
            <option value="">Automated + demo</option>
            <option value="AUTOMATED">Automated</option>
            <option value="DEMO">Demo</option>
            <option value="MANUAL">Manual</option>
          </select>
          <select className="field" value={f.dependency} onChange={(e) => setParam('dependency', e.target.value)} aria-label="Dependency">
            <option value="">Any dependency</option>
            <option value="INDEPENDENT">Independent</option>
            <option value="DERIVED">Derived</option>
          </select>
          <input type="date" className="field" value={f.dateFrom} onChange={(e) => setParam('dateFrom', e.target.value)} aria-label="Published from" />
          <input type="date" className="field" value={f.dateTo} onChange={(e) => setParam('dateTo', e.target.value)} aria-label="Published until" />
          <select className="field" value={f.sort || 'newest'} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </select>
        </div>
      </div>

      <div className="card relative z-10 mt-6 p-3 sm:p-4">
        {error ? <ErrorState error={error} onRetry={reload} compact />
          : !data ? <div className="p-4"><LoadingBlock rows={10} /></div>
            : !data.sources.length ? <EmptyState title="No sources match">Try another publisher, domain or date range.</EmptyState>
              : (
                <>
                  <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
                    <table className="data-table min-w-[1080px]">
                      <thead>
                        <tr>
                          <th>Publisher</th>
                          <th>Title</th>
                          <th>Platform</th>
                          <th>Published</th>
                          <th>Claim</th>
                          <th>Type</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sources.map((s) => (
                          <tr key={s.source_id} className="cursor-pointer" onClick={() => setSelected(s.source_id)}>
                            <td className="max-w-[200px]">
                              <div className="font-bold text-ink">{s.publisher}</div>
                              <div className="text-[13px] text-muted">{domainOf(s.source_url)}</div>
                            </td>
                            <td className="max-w-[320px] text-ink">{truncate(s.source_title, 100)}</td>
                            <td className="whitespace-nowrap text-ink-2">{s.platform_name}</td>
                            <td className="whitespace-nowrap text-ink-2">{formatDateTime(s.published_at)}</td>
                            <td className="max-w-[240px]">
                              {s.claim_id ? (
                                <Link to={`/claims/${s.claim_id}`} onClick={(e) => e.stopPropagation()} className="text-[14px] font-semibold text-deep hover:text-primary">
                                  {truncate(s.canonical_claim, 70)}
                                </Link>
                              ) : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              <div className="flex flex-col items-start gap-1.5">
                                <OriginBadge origin={s.origin_type} />
                                <DependencyBadge dependency={s.dependency} />
                              </div>
                            </td>
                            <td onClick={(e) => e.stopPropagation()}><ExternalLink href={s.source_url}>View</ExternalLink></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-4 text-[14px] text-ink-2">
                    <span>Showing {data.offset + 1}–{data.offset + data.sources.length} of <b className="text-ink">{data.total}</b></span>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={offset + 25 >= data.total} onClick={() => setOffset(offset + 25)}>
                        Next <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </>
              )}
      </div>
      {selected && <SourceDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
