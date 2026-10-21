import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, FileText, GitBranch, Layers, Network, Radio, Repeat2, Search } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Badge, { DependencyBadge, OriginBadge, StatusBadge } from '../components/ui/Badge.jsx';
import MetricCard from '../components/ui/MetricCard.jsx';
import { EchoBar, EchoTooltip } from '../components/ui/EchoMeter.jsx';
import ExternalLink from '../components/ui/ExternalLink.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import FingerprintCard from '../components/claim/FingerprintCard.jsx';
import EvidenceTable from '../components/claim/EvidenceTable.jsx';
import DatabaseTrace from '../components/claim/DatabaseTrace.jsx';
import MutationLedger from '../components/claim/MutationLedger.jsx';
import Timeline from '../components/claim/Timeline.jsx';
import LineageGraph from '../components/claim/LineageGraph.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { formatDate, formatDateTime, formatPercent } from '../utils/format.js';
import { LINEAGE_BASIS_LABEL, NO_UPSTREAM_NOTE, PREDICATE_TEXT, RELATIONSHIP_LABEL, echoLabel, isDemo } from '../utils/labels.js';

function Metrics({ claim, demo }) {
  const ratio = claim.echo_ratio_plsql ?? claim.known_echo_ratio;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Sources" value={claim.number_of_sources} hint={`${claim.variant_count} source version${claim.variant_count === 1 ? '' : 's'}`} icon={Layers} />
      <MetricCard label="Evidence" value={claim.evidence_count} hint="Exact sentences from the sources" icon={FileText} />
      <MetricCard label="Platforms" value={claim.number_of_platforms} hint={claim.platforms.map((p) => p.platform_name).slice(0, 3).join(', ')} icon={Radio} />
      <div className="card card-hover p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 meta-label">{echoLabel(demo)} <EchoTooltip demo={demo} /></div>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#fdf3d6] text-warning"><Repeat2 size={18} /></span>
        </div>
        <div className="mt-3 text-[2rem] font-extrabold leading-none tracking-tight text-ink">{formatPercent(ratio)}</div>
        <div className="mt-3"><EchoBar ratio={ratio} /></div>
        <div className="mt-2 text-[12.5px] text-ink-2">
          {claim.known_upstream_count
            ? `${claim.known_upstream_count} of ${claim.number_of_sources} sources have a known upstream source`
            : demo ? claim.echo_band : NO_UPSTREAM_NOTE}
        </div>
      </div>
    </div>
  );
}

/** What the visitor investigated, when they arrived from a web investigation. */
function InvestigatedQuery({ id, runId }) {
  const state = useApi((signal) => api.claimInvestigation(id, runId, { signal }), [id, runId]);
  const d = state.data;
  if (!d) return null;
  const relation = RELATIONSHIP_LABEL[d.relationship_to_query];
  return (
    <div className="card mb-6 flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:gap-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-tint text-primary"><Search size={18} /></span>
      <div className="min-w-0 text-[14.5px] text-ink-2">
        <div className="meta-label">Investigated query</div>
        <div className="mt-0.5 text-[16px] font-bold text-ink">{d.query_text}</div>
        {d.hypothesis_text && relation && (
          <p className="mt-1">
            {d.relationship_to_query === 'EXACT'
              ? 'This claim family matches the searched relationship.'
              : <>This is a <b className="text-ink">{relation[0].toLowerCase()}</b>, not the searched relationship “{d.hypothesis_text}”.</>}
            {d.relationship_to_query !== 'EXACT' && !d.exact_evidence && ' No retrieved source in this investigation directly supported the exact searched relationship.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Subject · relationship · object · organisation, from CLAIM_PROPOSITIONS. */
function Proposition({ claim }) {
  if (!claim.predicate) return null;
  const parts = [
    ['Subject', claim.subject],
    ['Relationship', PREDICATE_TEXT[claim.predicate] || claim.predicate.toLowerCase()],
    [claim.predicate === 'HOLDS_ROLE' ? 'Role' : 'Object', claim.object],
    ['Organisation', claim.qualifier],
  ].filter(([, v]) => v);
  return (
    <dl className="mt-4 flex flex-wrap gap-2">
      {parts.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-line bg-white/80 px-3 py-1.5">
          <dt className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted">{k}</dt>
          <dd className="text-[14px] font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
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
  const [params] = useSearchParams();
  const runId = Number.parseInt(params.get('run'), 10) || null;
  const claimState = useApi((signal) => api.claim(id, { signal }), [id]);
  const sourcesState = useApi((signal) => api.claimSources(id, { signal }), [id]);
  const evidenceState = useApi((signal) => api.claimEvidence(id, { signal }), [id]);
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
      {runId && <InvestigatedQuery id={id} runId={runId} />}
      <PageHeader crumbs={crumbs} label="Canonical claim" title={claim.canonical_claim}>
        <Proposition claim={claim} />
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

        <Card>
          <CardHeader label="VW_CLAIM_EVIDENCE" title="Evidence from sources" subtitle="The exact sentence each source states, oldest first." icon={FileText} />
          {evidenceState.error ? <ErrorState compact error={evidenceState.error} onRetry={evidenceState.reload} />
            : !evidenceState.data ? <LoadingBlock rows={5} />
              : evidenceState.data.length ? <EvidenceTable rows={evidenceState.data} demo={demo} />
                : <EmptyState compact title="No evidence stored">This claim has no stored sources yet.</EmptyState>}
        </Card>

        {sourcesState.error ? <ErrorState error={sourcesState.error} onRetry={sourcesState.reload} />
          : !sourcesState.data ? <div className="card card-pad"><LoadingBlock rows={6} /></div>
            : <Timeline sources={sourcesState.data} demo={demo} />}

        {mutationsState.error ? <ErrorState error={mutationsState.error} onRetry={mutationsState.reload} />
          : !mutationsState.data ? <div className="card card-pad"><LoadingBlock rows={8} /></div>
            : <MutationLedger mutations={mutationsState.data} />}

        <Lineage id={id} kind="claim" demo={demo} />
        <Lineage id={id} kind="source" demo={demo} />

        <FingerprintCard claim={claim} />
        <DatabaseTrace claim={claim} />
      </div>
    </div>
  );
}
