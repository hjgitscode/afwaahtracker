import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Clock, CopyX, Radio, RefreshCw, Rss, Sparkles } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import MetricCard from '../components/ui/MetricCard.jsx';
import Badge, { MatchBadge } from '../components/ui/Badge.jsx';
import ExternalLink from '../components/ui/ExternalLink.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import { useApi } from '../hooks/useApi.js';
import { useRefresh } from '../hooks/useRefresh.jsx';
import { api } from '../services/api.js';
import { formatDateTime, timeAgo, truncate, SOURCE_TYPE_LABEL } from '../utils/format.js';

function SyncIndicator() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-[#e1f5fb] px-3 py-1.5 text-[12px] font-extrabold uppercase tracking-[0.07em] text-[#1f6d87]">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-electric opacity-70" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#2FA4C7]" />
      </span>
      Syncing sources…
    </span>
  );
}

function RunStatus({ status }) {
  const tone = { SUCCESS: 'green', PARTIAL: 'amber', FAILED: 'red', RUNNING: 'electric' }[status] || 'muted';
  return <Badge tone={tone}>{(status || 'never run').toLowerCase()}</Badge>;
}

export default function LiveFeedPage() {
  const { refresh, refreshing } = useRefresh();
  const [type, setType] = useState('');
  const status = useApi((signal) => api.ingestionStatus({ signal }), []);
  const feed = useApi((signal) => api.ingestionFeed({ limit: 60, sourceType: type }, { signal }), [type]);
  const s = status.data?.summary;

  return (
    <div className="relative">
      <Watermark word="LIVE" style={{ top: -30, right: 0 }} />
      <PageHeader
        label="Automated source ingestion"
        title="Live feed"
        subtitle="Structured public sources — GDELT, Hacker News and RSS/Atom feeds — collected on a schedule, deduplicated and matched to claim families by deterministic rules."
        actions={(
          <>
            {refreshing && <SyncIndicator />}
            <button type="button" onClick={refresh} disabled={refreshing} className="btn btn-primary">
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing' : 'Refresh now'}
            </button>
          </>
        )}
      />

      {status.error && <div className="relative z-10 mb-6"><ErrorState error={status.error} onRetry={status.reload} /></div>}

      <div className="relative z-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!s ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="card p-6"><LoadingBlock rows={2} /></div>) : (
          <>
            <MetricCard label="Last sync" value={timeAgo(s.last_sync)} hint={s.last_sync ? formatDateTime(s.last_sync) : 'No completed runs yet'} icon={Clock} />
            <MetricCard label="New sources · 24h" value={s.new_sources_24h} hint={`${s.automated_sources} automated in total`} icon={Sparkles} />
            <MetricCard label="Skipped duplicates · 24h" value={s.skipped_24h} hint="Already stored (URL / external id)" icon={CopyX} />
            <MetricCard label="Active feeds" value={s.active_feeds} hint={`${s.total_feeds} configured · every ${status.data.scheduler.intervalMinutes} min`} icon={Rss} />
          </>
        )}
      </div>

      {status.data && (
        <Card className="relative z-10 mt-6">
          <CardHeader label="INGESTION_SOURCES registry" title="Feeds" subtitle="Most recent run of every configured source (VW_INGESTION_STATUS)." icon={Radio} />
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr><th>Feed</th><th>Type</th><th>Last run</th><th>Status</th><th>Fetched</th><th>New</th><th>Duplicates</th><th>Stored total</th></tr>
              </thead>
              <tbody>
                {status.data.sources.map((f) => (
                  <tr key={f.ingestion_source_id} className={f.enabled === 'N' ? 'opacity-55' : ''}>
                    <td className="max-w-[300px]">
                      <div className="font-bold text-ink">{f.source_name}</div>
                      {f.last_error && <div className="mt-0.5 flex items-start gap-1 text-[13px] text-danger"><CircleAlert size={14} className="mt-0.5 shrink-0" />{truncate(f.last_error, 110)}</div>}
                      {f.enabled === 'N' && <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Disabled</div>}
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{SOURCE_TYPE_LABEL[f.source_type]}</td>
                    <td className="whitespace-nowrap text-ink-2">{f.last_completed_at ? timeAgo(f.last_completed_at) : '—'}</td>
                    <td><RunStatus status={f.last_status} /></td>
                    <td className="font-semibold">{f.last_fetched ?? '—'}</td>
                    <td className="font-bold text-primary">{f.last_inserted ?? '—'}</td>
                    <td className="text-ink-2">{f.last_skipped ?? '—'}</td>
                    <td className="text-ink-2">{f.total_sources_ingested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="relative z-10 mt-6">
        <CardHeader
          label="Latest downloaded sources"
          title="Incoming sources"
          icon={CircleCheck}
          action={(
            <select className="field w-44 py-2" value={type} onChange={(e) => setType(e.target.value)} aria-label="Source type">
              <option value="">All source types</option>
              <option value="GDELT">GDELT</option>
              <option value="HACKER_NEWS">Hacker News</option>
              <option value="RSS">RSS / Atom</option>
            </select>
          )}
        />
        {feed.error ? <ErrorState compact error={feed.error} onRetry={feed.reload} />
          : !feed.data ? <LoadingBlock rows={8} />
            : !feed.data.length ? (
              <EmptyState icon={Rss} title="Nothing ingested yet" action={<button type="button" className="btn btn-primary" onClick={refresh} disabled={refreshing}>Refresh now</button>}>
                Automated sources appear here after the first successful ingestion run. If the internet is unavailable, the stored Oracle data keeps working.
              </EmptyState>
            ) : (
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="data-table min-w-[1100px] table-fixed [&_td]:px-3 [&_th]:px-3">
                  <colgroup>
                    <col className="w-[25%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[11%]" />
                    <col className="w-[20%]" /><col className="w-[9%]" /><col className="w-[7%]" /><col className="w-[8%]" />
                  </colgroup>
                  <thead>
                    <tr><th>Source</th><th>Publisher</th><th>Platform</th><th>Published</th><th>Matched claim</th><th>Match score</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {feed.data.map((r) => (
                      <tr key={`${r.source_id}-${r.claim_id}`}>
                        <td>
                          <div className="font-semibold text-ink">{truncate(r.source_title, 100)}</div>
                          <div className="text-[12.5px] text-muted">{r.feed_name} · fetched {timeAgo(r.fetched_at)}</div>
                        </td>
                        <td className="text-ink-2">{r.publisher}</td>
                        <td className="text-ink-2">{r.platform_name}</td>
                        <td className="text-ink-2">{formatDateTime(r.published_at)}</td>
                        <td>
                          {r.claim_id ? <Link to={`/claims/${r.claim_id}`} className="text-[14px] font-semibold text-deep hover:text-primary">{truncate(r.canonical_claim, 70)}</Link> : '—'}
                        </td>
                        <td title={r.match_breakdown || ''}>
                          <div className="font-extrabold text-ink">{r.match_score ?? '—'}</div>
                          <MatchBadge method={r.match_method} />
                        </td>
                        <td>
                          {r.derived_from_source_id ? <Badge tone="amber">Derived</Badge> : <Badge tone="green">{r.source_status.toLowerCase()}</Badge>}
                        </td>
                        <td><ExternalLink href={r.source_url}>View</ExternalLink></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        <p className="mt-4 text-[13px] text-muted">
          Match scores come from deterministic rule-based claim matching (entities 40 · keywords 30 · location 10 · event 10 · date 5 · title 5). Hover a score for its breakdown.
        </p>
      </Card>
    </div>
  );
}
