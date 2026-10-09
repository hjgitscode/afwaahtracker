import { Link } from 'react-router-dom';
import { ArrowRight, GitCompareArrows, Globe, Share2 } from 'lucide-react';
import HeroRadar from '../components/HeroRadar.jsx';
import Card from '../components/ui/Card.jsx';
import InvestigateForm from '../components/investigate/InvestigateForm.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { formatNumber, timeAgo, truncate } from '../utils/format.js';

const STEPS = [
  { n: '01', title: 'Search the web', icon: Globe, text: 'Retrieve relevant publicly indexed sources for a claim, person, event or topic.' },
  { n: '02', title: 'Trace the sources', icon: Share2, text: 'See where each version appeared and which publications explicitly link to earlier reporting.' },
  { n: '03', title: 'Compare the claim', icon: GitCompareArrows, text: 'See how the wording, certainty and details changed, recorded in the Mutation Ledger.' },
];

function Hero({ overview }) {
  const unavailable = overview && !overview.webSearchAvailable;
  return (
    <section className="relative overflow-hidden rounded-hero bg-navy px-6 py-10 text-white shadow-hero sm:px-10 md:px-12 md:py-12">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border-[40px] border-white/[0.04]" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-96 rounded-full bg-navy-alt/80" />
      <div className="relative grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="min-w-0">
          <div className="system-label-light">Live claim investigation</div>
          <h1 className="mt-4 font-black leading-[1.05] tracking-[-0.025em]" style={{ fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)', fontWeight: 880 }}>
            Trace the <span className="text-electric">claim.</span>
            <br />
            Find the <span className="text-electric">source.</span>
            <br />
            See what <span className="text-bright">changed.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#c2d3e2]">
            Search the live web to see how a claim appears across sources, how its wording changes, and which publications are known to depend on earlier reporting.
          </p>
          <div className="mt-8"><InvestigateForm dark /></div>
          <p className="mt-3 pl-2 text-[14px] text-[#9fb6ca]">
            {unavailable ? 'Live web search unavailable — showing stored sources. ' : ''}
            Stored demo:{' '}
            <Link to="/explore?q=Aakash%20Gupta%20VIT" className="font-bold text-electric underline-offset-4 hover:underline">“Aakash Gupta VIT”</Link>
          </p>
        </div>
        <div className="hidden sm:block">
          <HeroRadar />
        </div>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section className="mt-8 grid gap-5 md:grid-cols-3">
      {STEPS.map(({ n, title, icon: Icon, text }) => (
        <Card key={n} hover>
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

/** One small system overview: four numbers and the latest investigations. */
function Overview({ data }) {
  if (!data) return null;
  const m = data.metrics;
  const items = [
    ['Claim families', m.total_claims],
    ['Stored sources', m.total_sources, `${formatNumber(m.live_sources)} live · ${formatNumber(m.demo_sources)} demo`],
    ['Web investigations', m.web_search_runs],
    ['Explicit source links', m.source_references],
  ];
  return (
    <section className="mt-12">
      <div className="card grid gap-6 p-6 md:p-7 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="system-label mb-4">System overview</div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            {items.map(([label, value, hint]) => (
              <div key={label}>
                <dt className="meta-label">{label}</dt>
                <dd className="mt-1 text-[1.75rem] font-extrabold leading-none text-ink">{formatNumber(value)}</dd>
                {hint && <dd className="mt-1 text-[13px] text-muted">{hint}</dd>}
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <div className="meta-label mb-3">Recent investigations</div>
          {data.recentSearches.length ? (
            <ul className="space-y-1">
              {data.recentSearches.map((r) => (
                <li key={r.search_run_id}>
                  <Link to={`/explore?q=${encodeURIComponent(r.query_text)}&run=${r.search_run_id}`} className="group -mx-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-tint">
                    <span className="min-w-0 truncate font-semibold text-ink group-hover:text-deep">{truncate(r.query_text, 60)}</span>
                    <span className="shrink-0 text-[12.5px] text-muted">{r.status === 'FAILED' ? 'unavailable' : `${r.claim_families} famil${r.claim_families === 1 ? 'y' : 'ies'}`} · {timeAgo(r.started_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14.5px] text-ink-2">No web investigations yet. Search a claim above to start.</p>
          )}
          <Link to="/explore" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-extrabold uppercase tracking-[0.06em] text-primary hover:text-primary-hover">
            Browse stored claim families <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const overview = useApi((signal) => api.overview({ signal }), []);
  return (
    <>
      <Hero overview={overview.data} />
      <Steps />
      <Overview data={overview.data} />
    </>
  );
}
