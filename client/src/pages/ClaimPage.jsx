import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, GitBranch, Layers, Link2, Network, Radio, Repeat2 } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Badge, { DependencyBadge, OriginBadge, StatusBadge } from '../components/ui/Badge.jsx';
import MetricCard from '../components/ui/MetricCard.jsx';
import { EchoBar, EchoTooltip } from '../components/ui/EchoMeter.jsx';
import ExternalLink from '../components/ui/ExternalLink.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import FingerprintCard from '../components/claim/FingerprintCard.jsx';
import SourceTable from '../components/claim/SourceTable.jsx';
import MutationLedger from '../components/claim/MutationLedger.jsx';
import Timeline from '../components/claim/Timeline.jsx';
import LineageGraph from '../components/claim/LineageGraph.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { formatDate, formatDateTime, formatPercent } from '../utils/format.js';
import { LINEAGE_BASIS_LABEL, echoLabel, isDemo } from '../utils/labels.js';

function Metrics({ claim, demo }) {
  const ratio = claim.echo_ratio_plsql ?? claim.echo_ratio;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Total sources" value={claim.number_of_sources} hint={`${claim.number_of_variants} wording variant${claim.number_of_variants === 1 ? '' : 's'}`} icon={Layers} />
      <MetricCard
        label={demo ? 'Derived sources' : 'Known upstream links'}
        value={claim.number_of_derived_sources}
        hint={demo ? `${claim.number_of_independent_origins} independent` : `${claim.number_of_independent_origins} with no known upstream source`}
        icon={Link2}
      />
      <MetricCard label="Platforms" value={claim.number_of_platforms} hint={claim.platforms.map((p) => p.platform_name).slice(0, 3).join(', ')} icon={Radio} />
      <div className="card card-hover p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 meta-label">{echoLabel(demo)} <EchoTooltip demo={demo} /></div>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#fdf3d6] text-warning"><Repeat2 size={18} /></span>
        </div>
        <div className="mt-3 text-[2rem] font-extrabold leading-none tracking-tight text-ink">{formatPercent(ratio)}</div>
        <div className="mt-3"><EchoBar ratio={ratio} /></div>
        <div className="mt-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-2">{claim.echo_band}</div>
      </div>
    </div>
  );
}

function SelectedPanel({ item, kind, demo }) {
  if (!item) return <p className="mt-3 text-[14px] text-muted">Select a node to see its details.</p>;
  return (
    <div className="fade-up mt-3 flex flex-col gap-2 rounded-xl border border-[#c9dcf2] bg-tint/60 p-4 text-[14.5px] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-bold text-ink">
          {item.publisher}{' '}
          <span className="font-normal text-muted">· {item.platform_name} · {item.published_at ? formatDateTime(item.published_at) : 'date not determined'}</span>
        </div>
        <div className="mt-0.5 text-ink-2">“{kind === 'claim' ? item.variant_text : item.source_title}”</div>
        {kind === 'source' && item.provenance_note && <div className="mt-1 text-[13px] text-muted">{item.provenance_note}</div>}
        {kind === 'claim' && item.parent_variant_id && (
          <div className="mt-1 text-[13px] text-muted">Parent chosen by: {LINEAGE_BASIS_LABEL[item.lineage_basis] || item.lineage_basis}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {kind === 'source' && <DependencyBadge derived={Boolean(item.derived_from_source_id)} demo={demo} />}
        {kind === 'claim' && item.certainty && <Badge tone="blue">{item.certainty.toLowerCase()}</Badge>}
        <ExternalLink href={item.source_url} />
      </div>
    </div>
  );
}

function Lineage({ id, kind, demo }) {
  const state = useApi((signal) => (kind === 'claim' ? api.claimLineage(id, { signal }) : api.sourceLineage(id, { signal })), [id, kind]);
  const [selected, setSelected] = useState(null);
  const claim = kind === 'claim';
  return (
    <Card>
      <CardHeader
        label={claim ? 'CLAIM_VARIANTS.parent_variant_id' : 'SOURCES.derived_from_source_id'}
        title={claim ? 'Claim lineage' : 'Source lineage'}
        subtitle={claim
          ? (demo ? 'How the wording changed from version to version.' : 'Parent wording from an explicit reference, otherwise the most similar earlier version (dashed: inferred predecessor).')
          : (demo ? 'Which sources are known to derive from which.' : 'Only explicit evidence — a hyperlink or submitted link to a stored source — creates a link.')}
        icon={claim ? GitBranch : Network}
      />
      {state.error ? <ErrorState compact error={state.error} onRetry={state.reload} />
        : !state.data ? <LoadingBlock rows={6} />
          : !state.data.edges.length ? (
            <EmptyState compact icon={claim ? GitBranch : Network} title={claim ? 'No parent wording known' : 'No known upstream links'}>
              {claim
                ? 'No variant of this claim has an explicit reference or a sufficiently similar earlier version.'
                : demo
                  ? 'No provenance is recorded between these sources.'
                  : 'None of these sources links to another stored source. That does not prove they are independent.'}
            </EmptyState>
          ) : (
            <>
              <LineageGraph kind={kind} demo={demo} nodes={state.data.nodes} edges={state.data.edges} onSelect={setSelected} />
              <SelectedPanel item={selected} kind={kind} demo={demo} />
            </>
          )}
    </Card>
  );
}

export default function ClaimPage() {
  const { id } = useParams();
  const claimState = useApi((signal) => api.claim(id, { signal }), [id]);
  const sourcesState = useApi((signal) => api.claimSources(id, { signal }), [id]);
  const mutationsState = useApi((signal) => api.claimMutations(id, { signal }), [id]);

  const crumbs = [{ label: 'Explore', to: '/explore' }, { label: `Claim #${id}` }];

  if (claimState.error) {
    return (
      <>
        <PageHeader crumbs={crumbs} label="Claim investigation" title={claimState.error.code === 'NOT_FOUND' ? 'Claim not found' : 'Claim unavailable'} />
        <ErrorState error={claimState.error} onRetry={claimState.reload} />
        <div className="mt-6"><Link to="/explore" className="btn btn-secondary">Back to explore</Link></div>
      </>
    );
  }
  const claim = claimState.data;
  if (!claim) {
    return (
      <>
        <PageHeader crumbs={crumbs} label="Claim investigation" title="Loading claim…" />
        <div className="card card-pad"><LoadingBlock rows={6} /></div>
      </>
    );
  }
  const demo = isDemo(claim.claim_origin);

  return (
    <div className="relative">
      <Watermark word="TRACE" style={{ top: -20, right: -30 }} />
      <PageHeader crumbs={crumbs} label="Claim family" title={claim.canonical_claim}>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink-2">
          <StatusBadge status={claim.status} />
          <OriginBadge origin={claim.claim_origin} />
          <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-primary" />First seen {claim.first_seen ? formatDate(claim.first_seen) : 'not determined'}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-primary" />Latest seen {claim.latest_seen ? formatDate(claim.latest_seen) : 'not determined'}</span>
        </div>
        {demo && (
          <p className="mt-3 inline-block rounded-lg border border-line bg-white/70 px-3 py-1.5 text-[13px] font-semibold text-ink-2">
            Synthetic demonstration data — sources and URLs are illustrative and do not describe real events.
          </p>
        )}
      </PageHeader>

      <div className="relative z-10 space-y-6">
        <Metrics claim={claim} demo={demo} />

        {sourcesState.error ? <ErrorState error={sourcesState.error} onRetry={sourcesState.reload} />
          : !sourcesState.data ? <div className="card card-pad"><LoadingBlock rows={6} /></div>
            : (
              <>
                <Timeline sources={sourcesState.data} demo={demo} />
                <Card>
                  <CardHeader label="One row per source" title="Sources" subtitle="Each source and the version of the claim it carried." icon={Layers} />
                  {sourcesState.data.length ? <SourceTable sources={sourcesState.data} demo={demo} />
                    : <EmptyState compact title="No sources stored">This claim has no stored sources yet.</EmptyState>}
                </Card>
              </>
            )}

        {mutationsState.error ? <ErrorState error={mutationsState.error} onRetry={mutationsState.reload} />
          : !mutationsState.data ? <div className="card card-pad"><LoadingBlock rows={8} /></div>
            : <MutationLedger mutations={mutationsState.data} />}

        <Lineage id={id} kind="claim" demo={demo} />
        <Lineage id={id} kind="source" demo={demo} />

        <FingerprintCard claim={claim} />
      </div>
    </div>
  );
}
