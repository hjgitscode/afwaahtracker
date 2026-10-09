import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleAlert, Database, Layers, Unlink } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Badge, { OriginBadge } from '../components/ui/Badge.jsx';
import ClaimCard from '../components/claim/ClaimCard.jsx';
import ExternalLink from '../components/ui/ExternalLink.jsx';
import InvestigateForm from '../components/investigate/InvestigateForm.jsx';
import { RunStages, RunSummary } from '../components/investigate/RunProgress.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import { EmptyState, ErrorState, LoadingCards, LoadingBlock } from '../components/ui/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { formatDate, truncate } from '../utils/format.js';

const PAGE = 24;

function ClaimGrid({ claims }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {claims.map((c) => <ClaimCard key={c.claim_id} claim={c} />)}
    </div>
  );
}

/** Compact list of sources with progressive disclosure. */
function SourceList({ sources, initial = 8 }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, initial);
  return (
    <>
      <ul className="divide-y divide-line">
        {shown.map((s) => (
          <li key={s.source_id} className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-ink">{truncate(s.source_title, 140)}</div>
              <div className="mt-0.5 text-[13.5px] text-muted">
                {s.publisher} · {s.platform_name} · {s.published_at ? formatDate(s.published_at) : 'date not determined'}
              </div>
              <div className="mt-1 text-[13.5px]">
                {s.claim_id
                  ? <Link to={`/claims/${s.claim_id}`} className="font-semibold text-deep hover:text-primary">{truncate(s.canonical_claim, 90)}</Link>
                  : <span className="text-muted">Not grouped into a claim family</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <OriginBadge origin={s.origin_type} />
              <ExternalLink href={s.source_url}>View</ExternalLink>
            </div>
          </li>
        ))}
      </ul>
      {sources.length > initial && (
        <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${sources.length}`}
        </button>
      )}
    </>
  );
}

/** Follows a run until it finishes, then shows what Oracle holds for it. */
function RunView({ runId, query }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer;
    setStatus(null);
    setStatusError(null);
    const poll = async () => {
      try {
        const s = await api.webSearchStatus(runId);
        if (!alive) return;
        setStatus(s);
        if (s.status === 'RUNNING') timer = setTimeout(poll, 700);
      } catch (err) {
        if (alive) setStatusError(err);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId]);

  const finished = status && status.status !== 'RUNNING';
  const results = useApi((signal) => api.webSearchResults(runId, { signal }), [runId, finished], { enabled: Boolean(finished) });
  const failed = status?.status === 'FAILED';
  const stored = useApi((signal) => api.sources({ q: query, limit: 12 }, { signal }), [query, failed], { enabled: Boolean(failed && query) });

  if (statusError) return <ErrorState error={statusError} />;
  if (!status) return <div className="card card-pad"><LoadingBlock rows={3} /></div>;
  if (!finished) return <RunStages status={status} />;

  const data = results.data;
  return (
    <div className="space-y-6">
      {failed ? (
        <div role="status" className="card flex items-start gap-3 border-[#f3dd9a] bg-[#fffaf0] p-5">
          <CircleAlert size={20} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <div className="font-extrabold text-ink">Live web search unavailable — showing stored sources.</div>
            {status.error && <div className="mt-0.5 text-[14px] text-ink-2">{status.error}</div>}
          </div>
        </div>
      ) : (
        <RunSummary counts={status.counts} />
      )}

      {results.error ? <ErrorState error={results.error} onRetry={results.reload} />
        : !data ? <LoadingCards count={3} />
          : (
            <>
              {!failed && (
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[15px] text-ink-2">
                  <span><b className="text-ink">{data.relatedSourceCount}</b> relevant publicly indexed source{data.relatedSourceCount === 1 ? '' : 's'}</span>
                  <span><b className="text-ink">{data.claims.length}</b> claim famil{data.claims.length === 1 ? 'y' : 'ies'}</span>
                </div>
              )}

              {!failed && !data.strongFamilyDetected && (
                <Card>
                  <CardHeader label="Result" title="No strong claim family detected" icon={Unlink}
                    subtitle={data.relatedSourceCount
                      ? 'The retrieved sources do not repeat one specific claim. They are listed below as related sources.'
                      : 'The web search returned no usable results for this query.'} />
                </Card>
              )}

              {data.claims.length > 0 && (
                <section>
                  <h2 className="system-label mb-3">{data.strongFamilyDetected ? 'Claim families' : 'Possible claim families'}</h2>
                  <ClaimGrid claims={data.claims} />
                </section>
              )}

              {data.relatedSources.length > 0 && (
                <Card>
                  <CardHeader label="Search results stored in Oracle" title="Relevant publicly indexed sources" icon={Layers} />
                  <SourceList sources={data.relatedSources} />
                </Card>
              )}

              {data.storedClaims.length > 0 && (
                <section>
                  <h2 className="system-label mb-3">Already stored in Oracle</h2>
                  <ClaimGrid claims={data.storedClaims} />
                </section>
              )}

              {failed && stored.data?.sources?.length > 0 && (
                <Card>
                  <CardHeader label="Stored sources" title="Matching stored sources" icon={Database} />
                  <SourceList sources={stored.data.sources} />
                </Card>
              )}

              {failed && !data.storedClaims.length && !stored.data?.sources?.length && (
                <div className="card"><EmptyState title="Nothing stored for this query yet">Add BRAVE_SEARCH_API_KEY to server/.env to search the live web, or try another query.</EmptyState></div>
              )}
            </>
          )}
    </div>
  );
}

/** Stored claim families (search without a web run, or browse everything). */
function StoredView({ q }) {
  const [origin, setOrigin] = useState('');
  const [sort, setSort] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [q, origin, sort]);
  const result = useApi((signal) => api.claims({ q, origin, sort, limit }, { signal }), [q, origin, sort, limit]);
  const data = result.data;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[15px] text-ink-2">
          {data ? <><b className="text-ink">{data.total}</b> stored claim famil{data.total === 1 ? 'y' : 'ies'}{q && <> for “<b className="text-ink">{q}</b>”</>}</> : ' '}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2">
            <span className="meta-label">Data</span>
            <select className="field w-32 py-2" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">All</option>
              <option value="LIVE">Live</option>
              <option value="DEMO">Demo</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="meta-label">Sort</span>
            <select className="field w-40 py-2" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">{q ? 'Best match' : 'Most sources'}</option>
              <option value="newest">Newest</option>
              <option value="sources">Most sources</option>
              <option value="echo">Highest echo</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-5">
        {result.error ? <ErrorState error={result.error} onRetry={result.reload} />
          : !data ? <LoadingCards count={6} />
            : !data.claims.length ? (
              <div className="card"><EmptyState title="No stored claim families">Press INVESTIGATE WEB to search the live web for this query.</EmptyState></div>
            ) : (
              <>
                <div className={result.loading ? 'opacity-60' : ''}><ClaimGrid claims={data.claims} /></div>
                {data.total > data.claims.length && (
                  <div className="mt-8 text-center">
                    <button type="button" className="btn btn-secondary" onClick={() => setLimit((l) => l + PAGE)} disabled={result.loading}>Show more</button>
                  </div>
                )}
              </>
            )}
      </div>
    </>
  );
}

export default function ExplorePage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const run = Number.parseInt(params.get('run'), 10) || null;

  return (
    <div className="relative">
      <Watermark word="EXPLORE" style={{ top: -30, right: -20 }} />
      <PageHeader
        label={run ? 'Live claim investigation' : 'Stored claim families'}
        title={q ? `“${truncate(q, 90)}”` : 'Explore'}
        subtitle={run ? null : 'Search the live web, or browse the claim families already stored in Oracle.'}
        actions={run ? <Badge tone="muted">Run #{run}</Badge> : null}
      />
      <div className="relative z-10 space-y-6">
        <div className="card p-3 sm:p-4"><InvestigateForm initial={q} /></div>
        {run ? <RunView key={run} runId={run} query={q} /> : <StoredView q={q} />}
      </div>
    </div>
  );
}
