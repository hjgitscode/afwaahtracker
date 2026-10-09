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
import { domainOf, formatDate, formatDateTime, truncate } from '../utils/format.js';
import { NOT_DETERMINED, REFERENCE_TYPE_LABEL, RETRIEVAL_LABEL, isDemo } from '../utils/labels.js';

const KEYS = ['q', 'platform', 'retrieval', 'dependency', 'dateFrom', 'dateTo'];
const LIMIT = 25;

function Meta({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="meta-label">{label}</dt>
      <dd className="break-words text-ink">{children || <span className="text-muted">{NOT_DETERMINED}</span>}</dd>
    </div>
  );
}

function SourceDrawer({ id, onClose }) {
  const { data, error, loading, reload } = useApi((signal) => api.source(id, { signal }), [id]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const demo = data && isDemo(data.origin_type);
  const outgoing = data?.references?.filter((r) => r.direction === 'OUTGOING') || [];
  const incoming = data?.references?.filter((r) => r.direction === 'INCOMING') || [];

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label="Source details">
      <button type="button" className="absolute inset-0 bg-navy/40" onClick={onClose} aria-label="Close details" />
      <aside className="fade-up relative h-full w-full max-w-lg overflow-y-auto bg-page p-5 shadow-hero sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="system-label">Source #{id}</div>
            <h2 className="mt-1 break-words text-[22px] font-extrabold leading-tight text-ink">{data ? data.publisher : 'Loading…'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-2 transition-colors hover:bg-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {error && <ErrorState error={error} onRetry={reload} compact />}
        {loading && !data && <LoadingBlock rows={8} />}
        {data && (
          <div className="space-y-4">
            <div className="card p-5">
              <div className="flex flex-wrap gap-2">
                <OriginBadge origin={data.origin_type} />
                <Badge tone="muted">{RETRIEVAL_LABEL[data.origin_type]}</Badge>
                <DependencyBadge derived={Boolean(data.derived_from_source_id)} demo={demo} />
              </div>
              <p className="mt-3 text-[16.5px] font-bold leading-snug text-ink">{data.source_title}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
                <Meta label="Platform">{data.platform_name}</Meta>
                <Meta label="Published">{data.published_at ? formatDateTime(data.published_at) : null}</Meta>
                <Meta label="Author">{data.author}</Meta>
                <Meta label="Retrieved">{formatDateTime(data.fetched_at)}</Meta>
                <Meta label="Domain">{domainOf(data.source_url)}</Meta>
                <Meta label="Feed">{data.ingestion_source_name || (data.origin_type === 'WEB_SEARCH' ? 'Live web search' : null)}</Meta>
              </dl>
              <div className="mt-4 flex flex-wrap gap-4">
                <ExternalLink href={data.source_url}>View original</ExternalLink>
                {data.linked_url && <ExternalLink href={data.linked_url}>Submitted link</ExternalLink>}
              </div>
            </div>

            <div className="card p-5">
              <div className="meta-label mb-2">Upstream references</div>
              {data.derived_from_publisher && (
                <p className="text-[14.5px] text-ink">{demo ? 'Derived from' : 'Known upstream source'}: <b>{data.derived_from_publisher}</b></p>
              )}
              {outgoing.length ? (
                <ul className="mt-2 space-y-2 text-[14px]">
                  {outgoing.map((r) => (
                    <li key={r.reference_id} className="rounded-lg border border-line bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="blue">{REFERENCE_TYPE_LABEL[r.reference_type]}</Badge>
                        <span className="font-semibold text-ink">{r.other_publisher}</span>
                      </div>
                      <div className="mt-1 text-ink-2">{truncate(r.other_title, 110)}</div>
                    </li>
                  ))}
                </ul>
              ) : !data.derived_from_publisher && (
                <p className="text-[14px] text-ink-2">{demo ? 'No upstream source recorded.' : 'No link to another stored source was found. That does not prove the source is independent.'}</p>
              )}
              {incoming.length > 0 && (
                <p className="mt-3 text-[14px] text-ink-2"><b className="text-ink">{incoming.length}</b> stored source{incoming.length > 1 ? 's link' : ' links'} to this one.</p>
              )}
            </div>

            <div className="card p-5">
              <div className="meta-label mb-2">Linked claim</div>
              {data.claims.length ? data.claims.map((c) => (
                <Link key={c.variant_id} to={`/claims/${c.claim_id}`} className="group -mx-2 block rounded-lg px-2 py-2 transition-colors hover:bg-tint">
                  <div className="font-bold text-ink group-hover:text-deep">{c.canonical_claim}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    <MatchBadge method={c.match_method} /> Match score {c.match_score}
                  </div>
                  {c.match_breakdown && <div className="mt-1 text-[12.5px] text-muted">{c.match_breakdown}</div>}
                </Link>
              )) : <p className="text-[14px] text-muted">Not grouped into a claim family.</p>}
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
  const { data, error, loading, reload } = useApi((signal) => api.sources({ ...f, offset, limit: LIMIT }, { signal }), [key, offset]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const active = KEYS.some((k) => k !== 'q' && f[k]);

  return (
    <div className="relative">
      <Watermark word="SOURCES" style={{ top: -30, right: -30 }} />
      <PageHeader label="Stored in Oracle" title="Sources" subtitle="Every stored page, article and post — from live web searches, background feeds and demonstration data." />

      <div className="card relative z-10 p-4 sm:p-5">
        <form onSubmit={(e) => { e.preventDefault(); setParam('q', draft.trim()); }} className="flex flex-col gap-3 md:flex-row" role="search">
          <label className="relative flex-1">
            <span className="sr-only">Search sources</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Publisher, title, URL or claim…" className="field pl-11" />
          </label>
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select className="field" value={f.platform} onChange={(e) => setParam('platform', e.target.value)} aria-label="Platform">
            <option value="">All platforms</option>
            {platforms.data?.filter((p) => p.source_count > 0).map((p) => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
          </select>
          <select className="field" value={f.retrieval} onChange={(e) => setParam('retrieval', e.target.value)} aria-label="Retrieval method">
            <option value="">Any retrieval method</option>
            <option value="WEB_SEARCH">Web search</option>
            <option value="FEED">Background feed</option>
            <option value="MANUAL">Manual</option>
            <option value="DEMO">Demo</option>
          </select>
          <select className="field" value={f.dependency} onChange={(e) => setParam('dependency', e.target.value)} aria-label="Known dependency">
            <option value="">Any dependency</option>
            <option value="KNOWN_DERIVED">Known derived</option>
            <option value="NO_KNOWN_UPSTREAM">No known upstream source</option>
          </select>
          <input type="date" className="field" value={f.dateFrom} onChange={(e) => setParam('dateFrom', e.target.value)} aria-label="Published from" />
          <input type="date" className="field" value={f.dateTo} onChange={(e) => setParam('dateTo', e.target.value)} aria-label="Published until" />
        </div>
        {active && (
          <button type="button" onClick={() => setParams(f.q ? { q: f.q } : {}, { replace: true })} className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold uppercase tracking-[0.05em] text-primary hover:text-primary-hover">
            <X size={14} /> Clear filters
          </button>
        )}
      </div>

      <div className="card relative z-10 mt-6 p-3 sm:p-4">
        {error ? <ErrorState error={error} onRetry={reload} compact />
          : !data ? <div className="p-4"><LoadingBlock rows={10} /></div>
            : !data.sources.length ? <EmptyState title="No sources match">Try another publisher, domain or date range.</EmptyState>
              : (
                <>
                  <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
                    <table className="data-table min-w-[1000px]">
                      <thead>
                        <tr>
                          <th>Publisher</th>
                          <th>Title</th>
                          <th>Platform</th>
                          <th>Published</th>
                          <th>Claim</th>
                          <th>Dependency</th>
                          <th>Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sources.map((s) => (
                          <tr key={s.source_id} className="cursor-pointer" onClick={() => setSelected(s.source_id)}>
                            <td className="max-w-[190px]">
                              <div className="font-bold text-ink">{s.publisher}</div>
                              <div className="text-[13px] text-muted">{domainOf(s.source_url)}</div>
                            </td>
                            <td className="max-w-[320px]">
                              <button type="button" className="text-left text-ink hover:text-deep" onClick={(e) => { e.stopPropagation(); setSelected(s.source_id); }}>
                                {truncate(s.source_title, 100)}
                              </button>
                              <div className="mt-1"><OriginBadge origin={s.origin_type} /></div>
                            </td>
                            <td className="whitespace-nowrap text-ink-2">{s.platform_name}</td>
                            <td className="whitespace-nowrap text-ink-2">{s.published_at ? formatDate(s.published_at) : <span className="text-[13px] text-muted">{NOT_DETERMINED}</span>}</td>
                            <td className="max-w-[240px]">
                              {s.claim_id ? (
                                <Link to={`/claims/${s.claim_id}`} onClick={(e) => e.stopPropagation()} className="text-[14px] font-semibold text-deep hover:text-primary">
                                  {truncate(s.canonical_claim, 70)}
                                </Link>
                              ) : <span className="text-[13px] text-muted">Not grouped</span>}
                            </td>
                            <td><DependencyBadge derived={Boolean(s.derived_from_source_id)} demo={isDemo(s.origin_type)} /></td>
                            <td onClick={(e) => e.stopPropagation()}><ExternalLink href={s.source_url}>View</ExternalLink></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-4 text-[14px] text-ink-2">
                    <span>Showing {data.offset + 1}–{data.offset + data.sources.length} of <b className="text-ink">{data.total}</b></span>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>
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
