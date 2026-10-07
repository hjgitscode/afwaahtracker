import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Layers, Radio } from 'lucide-react';
import { StatusBadge, OriginBadge } from '../ui/Badge.jsx';
import { EchoBar, EchoTooltip } from '../ui/EchoMeter.jsx';
import { formatDate, formatPercent } from '../../utils/format.js';

function Stat({ label, value }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div className="mt-0.5 text-[20px] font-extrabold leading-tight text-ink">{value}</div>
    </div>
  );
}

export default function ClaimCard({ claim }) {
  const high = Number(claim.echo_ratio) > 60;
  return (
    <article className="card card-hover card-pad flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="system-label">{claim.category}</span>
        <span className="text-muted">·</span>
        <StatusBadge status={claim.status} />
        {claim.claim_origin !== 'DEMO' && <OriginBadge origin={claim.claim_origin} />}
        <span className="ml-auto text-[12px] font-bold text-muted">#{claim.claim_id}</span>
      </div>
      <h3 className="text-[20px] font-extrabold leading-snug tracking-[-0.01em] text-ink">{claim.canonical_claim}</h3>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <Stat label="Sources" value={claim.number_of_sources} />
        <Stat label="Independent" value={claim.number_of_independent_origins} />
        <Stat label="Derived" value={claim.number_of_derived_sources} />
      </div>

      <div className="mt-5 rounded-xl bg-tint/70 p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 meta-label">Echo Ratio <EchoTooltip /></span>
          <span className={`text-[16px] font-extrabold ${high ? 'text-warning' : 'text-deep'}`}>{formatPercent(claim.echo_ratio)}</span>
        </div>
        <div className="mt-2"><EchoBar ratio={claim.echo_ratio} /></div>
        <div className="mt-1.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-2">{claim.echo_band}</div>
      </div>

      <div className="mt-4 space-y-1.5 text-[14px] text-ink-2">
        <div className="flex items-start gap-2"><Radio size={15} className="mt-1 shrink-0 text-primary" /><span> {claim.number_of_platforms} platform{claim.number_of_platforms === 1 ? '' : 's'}{claim.platforms ? `: ${claim.platforms}` : ''}</span></div>
        <div className="flex items-center gap-2"><CalendarDays size={15} className="text-primary" /> First seen {formatDate(claim.first_seen)} · latest {formatDate(claim.latest_seen)}</div>
        <div className="flex items-center gap-2"><Layers size={15} className="text-primary" /> {claim.number_of_variants} variant{claim.number_of_variants === 1 ? '' : 's'}</div>
      </div>

      <div className="mt-auto pt-6">
        <Link to={`/claims/${claim.claim_id}`} className="btn btn-primary w-full sm:w-auto">
          Investigate claim <ArrowRight size={16} strokeWidth={2.6} />
        </Link>
      </div>
    </article>
  );
}
