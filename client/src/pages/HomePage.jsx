import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowRight, Database, GitBranch, GitCompareArrows, Layers, Radio, Repeat2, Search, Share2, Waypoints,
} from 'lucide-react';
import HeroRadar from '../components/HeroRadar.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import MetricCard from '../components/ui/MetricCard.jsx';
import { StatusBadge } from '../components/ui/Badge.jsx';
import { EchoBar, EchoTooltip } from '../components/ui/EchoMeter.jsx';
import { ErrorState, LoadingBlock, EmptyState } from '../components/ui/States.jsx';
import PlatformChart from '../components/charts/PlatformChart.jsx';
import IngestionChart from '../components/charts/IngestionChart.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { formatDate, formatNumber, formatPercent, timeAgo, SOURCE_TYPE_LABEL } from '../utils/format.js';

const FEATURES = [
  { n: '01', title: 'Search the claim', icon: Search, text: 'Search across automatically collected and indexed claim families.' },
  { n: '02', title: 'Trace the source', icon: Share2, text: 'See who published each version and identify known source dependencies.' },
  { n: '03', title: 'See what changed', icon: GitCompareArrows, text: 'Compare related variants with the SQL-driven Mutation Ledger.' },
];

function Hero() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/explore?q=${encodeURIComponent(term)}` : '/explore');
  };
  return (
    <section className="relative overflow-hidden rounded-hero bg-navy px-6 py-10 text-white shadow-hero sm:px-10 md:px-12 md:py-12">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border-[40px] border-white/[0.04]" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-96 rounded-full bg-navy-alt/80" />
      <div className="relative grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="system-label-light">Claim intelligence database</div>
          <h1 className="mt-4 font-black leading-[1.05] tracking-[-0.025em]" style={{ fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)', fontWeight: 880 }}>
            Trace the <span className="text-electric">claim.</span>
            <br />
            Find the <span className="text-electric">source.</span>
            <br />
            See what <span className="text-bright">changed.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#c2d3e2]">
            Investigate who said it, where it appeared, how it changed, and how many apparently independent reports trace back to the same origin.
          </p>
          <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row" role="search">
            <label className="relative flex-1">
              <span className="sr-only">Search claims</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a claim, person, place, event or keyword…"
                className="h-14 w-full rounded-full border-2 border-transparent bg-white pl-12 pr-5 text-[16px] text-ink shadow-[0_8px_20px_rgba(10,20,30,.22)] outline-none transition-[border-color] duration-200 placeholder:text-muted focus:border-electric"
              />
            </label>
            <button type="submit" className="btn btn-primary h-14 px-8 text-[14px]">
              Investigate <ArrowRight size={17} strokeWidth={2.6} />
            </button>
          </form>
          <p className="mt-3 pl-2 text-[14px] text-[#9fb6ca]">
            Try{' '}
            <button type="button" onClick={() => navigate('/explore?q=Aakash%20Gupta%20VIT')} className="font-bold text-electric underline-offset-4 hover:underline">
              “Aakash Gupta VIT”
            </button>
          </p>
        </div>
        <div className="hidden sm:block">
          <HeroRadar />
        </div>
      </div>
    </section>
  );
}

function FeatureCards() {
  return (
    <section className="mt-8 grid gap-5 md:grid-cols-3">
      {FEATURES.map(({ n, title, icon: Icon, text }) => (
        <Card key={n} hover className="relative">
          <div className="flex items-start justify-between">
            <span className="text-[13px] font-extrabold tracking-[0.08em] text-primary">{n}</span>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-tint text-primary">
              <Icon size={21} strokeWidth={2} />
            </span>
          </div>
          <h2 className="mt-6 text-[20px] font-extrabold uppercase tracking-[0.03em] text-ink">{title}</h2>
          <p className="mt-2 text-[15.5px] text-ink-2">{text}</p>
        </Card>
      ))}
    </section>
  );
}

function ClaimRow({ claim, right }) {
  return (
    <Link to={`/claims/${claim.claim_id}`} className="group -mx-3 flex items-center gap-4 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-tint">
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold text-ink group-hover:text-deep">{claim.canonical_claim}</div>
        <div className="mt-0.5 text-[13px] text-muted">{claim.category} · {claim.number_of_sources} source{claim.number_of_sources === 1 ? '' : 's'}</div>
      </div>
      {right}
    </Link>
  );
}

function Dashboard() {
  const { data, error, loading, reload } = useApi((signal) => api.dashboard({ signal }), []);
  if (error && !data) return <div className="mt-12"><ErrorState error={error} onRetry={reload} /></div>;
  const m = data?.metrics;

  return (
    <section className="mt-16">
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="system-label mb-2">Live overview</div>
          <h2 className="page-title !text-[clamp(1.8rem,3vw,2.5rem)]">The claim database at a glance</h2>
        </div>
        <Link to="/explore" className="btn btn-secondary self-start md:self-auto">Explore all claims <ArrowRight size={16} /></Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading && !m
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="card p-6"><LoadingBlock rows={2} /></div>)
          : (
            <>
              <MetricCard label="Total claims" value={formatNumber(m.total_claims)} hint={`${m.curated_claims} curated families`} icon={Layers} />
              <MetricCard label="Total sources" value={formatNumber(m.total_sources)} hint={`${m.total_variants} variants`} icon={Database} />
              <MetricCard label="Independent origins" value={formatNumber(m.independent_origins)} hint={`${m.derived_sources} derived`} icon={Waypoints} />
              <MetricCard label="Average echo ratio" value={formatPercent(m.average_echo_ratio)} hint="Source dependence" icon={Repeat2} accent />
              <MetricCard label="Platforms" value={formatNumber(m.platforms)} hint="With stored sources" icon={Radio} />
              <MetricCard label="Ingested today" value={formatNumber(m.ingested_today)} hint="Automated sources" icon={Activity} />
            </>
          )}
      </div>

      {data && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader label="Echo ratio leaders" title="High echo claims" icon={Repeat2} action={<EchoTooltip />} />
            {data.highEcho.map((c) => (
              <ClaimRow
                key={c.claim_id}
                claim={c}
                right={(
                  <div className="w-28 shrink-0 text-right">
                    <div className={`text-[16px] font-extrabold ${c.echo_ratio > 60 ? 'text-warning' : 'text-deep'}`}>{formatPercent(c.echo_ratio)}</div>
                    <div className="mt-1"><EchoBar ratio={c.echo_ratio} height={6} /></div>
                  </div>
                )}
              />
            ))}
          </Card>

          <Card>
            <CardHeader label="By source count" title="Most repeated claims" icon={GitBranch} />
            {data.mostRepeated.map((c) => (
              <ClaimRow
                key={c.claim_id}
                claim={c}
                right={(
                  <div className="shrink-0 text-right">
                    <div className="text-[16px] font-extrabold text-ink">{c.number_of_sources}</div>
                    <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">{c.number_of_platforms} platforms</div>
                  </div>
                )}
              />
            ))}
          </Card>

          <Card>
            <CardHeader label="Sources per platform" title="Platform distribution" icon={Radio} />
            <PlatformChart data={data.platformDistribution} />
          </Card>

          <Card>
            <CardHeader label="Newest activity" title="Recent claim families" icon={Layers} />
            {data.recentClaims.map((c) => (
              <ClaimRow
                key={c.claim_id}
                claim={c}
                right={(
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={c.status} />
                    <span className="text-[12px] text-muted">{formatDate(c.latest_seen)}</span>
                  </div>
                )}
              />
            ))}
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              label="Automated source ingestion"
              title="Ingestion activity"
              subtitle="New sources stored per day over the last two weeks."
              icon={Activity}
              action={<Link to="/live" className="btn btn-ghost btn-sm">Live feed</Link>}
            />
            <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
              <IngestionChart data={data.ingestionActivity} />
              <div>
                <div className="meta-label mb-3">Last refresh</div>
                {data.lastRefresh.length ? (
                  <ul className="space-y-3">
                    {data.lastRefresh.map((r) => (
                      <li key={r.source_type} className="rounded-xl border border-line bg-white p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-extrabold uppercase tracking-[0.07em] text-ink">{SOURCE_TYPE_LABEL[r.source_type]}</span>
                          <span className="text-[12px] text-muted">{timeAgo(r.completed_at)}</span>
                        </div>
                        <div className="mt-1 text-[15px] text-ink-2">
                          {r.fetched} fetched · <b className="text-primary">{r.inserted} new</b>
                          {r.failed > 0 && <span className="text-danger"> · {r.failed} unavailable</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact icon={Activity} title="No ingestion runs yet">
                    Press Refresh Data to fetch GDELT, Hacker News and RSS sources.
                  </EmptyState>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeatureCards />
      <Dashboard />
    </>
  );
}
