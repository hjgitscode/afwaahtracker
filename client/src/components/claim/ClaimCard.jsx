import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Badge, { StatusBadge, OriginBadge } from '../ui/Badge.jsx';
import { EchoBar, EchoTooltip } from '../ui/EchoMeter.jsx';
import { formatDate, formatPercent } from '../../utils/format.js';
import { echoLabel, isDemo, RELATIONSHIP_LABEL } from '../../utils/labels.js';

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="meta-label">{label}</div>
      <div className="mt-0.5 text-[20px] font-extrabold leading-tight text-ink">{value}</div>
    </div>
  );
}

/**
 * One claim family in a result list. Deliberately limited to the canonical
 * claim and its headline numbers; everything else is on the claim page.
 */
export default function ClaimCard({ claim, runId = null }) {
  const relation = RELATIONSHIP_LABEL[claim.relationship_to_query];
  const demo = isDemo(claim.claim_origin);
  const high = Number(claim.echo_ratio) > 60;
  return (
    <article className="card card-hover card-pad flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={claim.status} />
        <OriginBadge origin={claim.claim_origin} />
        {relation && <Badge tone={relation[1]}>{relation[0]}</Badge>}
      </div>
      <h3 className="text-[19px] font-extrabold leading-snug tracking-[-0.01em] text-ink">{claim.canonical_claim}</h3>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Stat label="Sources" value={claim.number_of_sources} />
        <Stat label="Evidence" value={claim.evidence_count ?? 0} />
        <Stat label="Platforms" value={claim.number_of_platforms} />
      </div>

      <div className="mt-5 rounded-xl bg-tint/70 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 meta-label">{echoLabel(demo)} <EchoTooltip demo={demo} /></span>
          <span className={`text-[16px] font-extrabold ${high ? 'text-warning' : 'text-deep'}`}>{formatPercent(claim.echo_ratio)}</span>
        </div>
        <div className="mt-2"><EchoBar ratio={claim.echo_ratio} /></div>
      </div>

      <div className="mt-4 text-[14px] text-ink-2">
        First seen {claim.first_seen ? formatDate(claim.first_seen) : 'not determined'} · latest {claim.latest_seen ? formatDate(claim.latest_seen) : 'not determined'}
      </div>

      <div className="mt-auto pt-6">
        <Link to={runId ? `/claims/${claim.claim_id}?run=${runId}` : `/claims/${claim.claim_id}`} className="btn btn-primary w-full sm:w-auto" aria-label={`Investigate: ${claim.canonical_claim}`}>
          Investigate <ArrowRight size={16} strokeWidth={2.6} />
        </Link>
      </div>
    </article>
  );
}
