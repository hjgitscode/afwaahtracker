import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, GitBranch, Hash, Layers, Network, Tag, Users } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Badge, { DependencyBadge, OriginBadge, StatusBadge } from '../components/ui/Badge.jsx';
import EchoMeter from '../components/ui/EchoMeter.jsx';
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
import { formatDate, formatDateTime } from '../utils/format.js';

function Strip({ claim }) {
  const items = [
    ['Total sources', claim.number_of_sources],
    ['Independent', claim.number_of_independent_origins],
    ['Derived', claim.number_of_derived_sources],
    ['Platforms', claim.number_of_platforms],
    ['Variants', claim.number_of_variants],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-line p-0 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="bg-card p-5">
            <div className="meta-label">{label}</div>
            <div className="mt-1 text-[2rem] font-extrabold leading-none text-ink">{value}</div>
          </div>
        ))}
      </div>
      <div className="card p-6">
        <EchoMeter ratio={claim.echo_ratio_plsql ?? claim.echo_ratio} band={claim.echo_band} derived={claim.number_of_derived_sources} total={claim.number_of_sources} />
      </div>
    </div>
  );
}

function SelectedPanel({ item, kind }) {
  if (!item) {
    return <p className="mt-3 text-[14px] text-muted">Select a node to see its details.</p>;
  }
  return (
    <div className="fade-up mt-3 flex flex-col gap-2 rounded-xl border border-[#c9dcf2] bg-tint/60 p-4 text-[14.5px] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-bold text-ink">{item.publisher} <span className="font-normal text-muted">· {item.platform_name} · {formatDateTime(item.published_at)}</span></div>
        <div className="mt-0.5 text-ink-2">“{kind === 'claim' ? item.variant_text : item.source_title}”</div>
        {kind === 'source' && item.provenance_note && <div className="mt-1 text-[13px] text-muted">{item.provenance_note}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {kind === 'source' && <DependencyBadge dependency={item.dependency} />}
        {kind === 'claim' && item.certainty && <Badge tone="blue">{item.certainty.toLowerCase()}</Badge>}
        <ExternalLink href={item.source_url} />
      </div>
    </div>
  );
}

function LineageSection({ id }) {
  const claimLin = useApi((signal) => api.claimLineage(id, { signal }), [id]);
  const sourceLin = useApi((signal) => api.sourceLineage(id, { signal }), [id]);
  const [selClaim, setSelClaim] = useState(null);
  const [selSource, setSelSource] = useState(null);

  const render = (state, kind, onSelect, sel) => {
    if (state.error) return <ErrorState compact error={state.error} onRetry={state.reload} />;
    if (!state.data) return <LoadingBlock rows={6} />;
    if (!state.data.edges.length) {
      return (
        <EmptyState compact icon={kind === 'claim' ? GitBranch : Network} title="No known lineage">
          {kind === 'claim'
            ? 'None of the variants of this claim has a recorded parent wording.'
            : 'No deterministic provenance is known between these sources, so each counts as an independent origin.'}
        </EmptyState>
      );
    }
    return (
      <>
        <LineageGraph kind={kind} nodes={state.data.nodes} edges={state.data.edges} onSelect={onSelect} />
        <SelectedPanel item={sel} kind={kind} />
      </>
    );
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader label="CLAIM_VARIANTS.parent_variant_id" title="Claim lineage" subtitle="How the wording and assertion changed." icon={GitBranch} />
        {render(claimLin, 'claim', setSelClaim, selClaim)}
      </Card>
      <Card>
        <CardHeader label="SOURCES.derived_from_source_id" title="Source lineage" subtitle="Which sources are known to derive from which." icon={Network} />
        {render(sourceLin, 'source', setSelSource, selSource)}
      </Card>
    </div>
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

  return (
    <div className="relative">
      <Watermark word="LINEAGE" style={{ top: -20, right: -40 }} />
      <PageHeader crumbs={crumbs} label="Claim investigation" title={claim.canonical_claim}>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink-2">
          <StatusBadge status={claim.status} />
          <OriginBadge origin={claim.claim_origin} />
          <span className="inline-flex items-center gap-1.5"><Tag size={15} className="text-primary" />{claim.category}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-primary" />First seen {formatDate(claim.first_seen)}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-primary" />Latest seen {formatDate(claim.latest_seen)}</span>
        </div>
        {claim.summary && <p className="mt-4 max-w-3xl text-[16px] text-ink-2">{claim.summary}</p>}
        {claim.claim_origin === 'DEMO' && (
          <p className="mt-3 inline-block rounded-lg border border-line bg-white/70 px-3 py-1.5 text-[13px] font-semibold text-ink-2">
            Synthetic demonstration data — sources and URLs are illustrative and do not describe real events.
          </p>
        )}
      </PageHeader>

      <div className="relative z-10 space-y-6">
        <Strip claim={claim} />

        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <FingerprintCard claim={claim} />
          <div className="space-y-6">
            <Card>
              <CardHeader label="Dictionary matches" title="Related entities" icon={Users} />
              {claim.entities.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {claim.entities.map((e) => (
                    <li key={e.entity_id}>
                      <Link to={`/explore?q=${encodeURIComponent(e.entity_name)}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 transition-colors duration-150 hover:border-[#b9d2ec] hover:bg-tint">
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-ink">{e.entity_name}</span>
                          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted">{e.entity_type}</span>
                        </span>
                        <span className="shrink-0 text-[12px] font-bold text-primary">{e.claim_count} claim{e.claim_count > 1 ? 's' : ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon={Users} title="No known entities">No dictionary entity was detected for this claim.</EmptyState>}
            </Card>
            <Card>
              <CardHeader label="Token & dictionary matches" title="Related keywords" icon={Hash} />
              {claim.keywords.length ? (
                <div className="flex flex-wrap gap-2">
                  {claim.keywords.map((k) => (
                    <Link key={k.keyword_id} to={`/explore?q=${encodeURIComponent(k.keyword_text)}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[14px] font-semibold text-ink-2 transition-colors duration-150 hover:border-[#b9d2ec] hover:bg-tint hover:text-deep">
                      {k.keyword_text}
                    </Link>
                  ))}
                </div>
              ) : <EmptyState compact icon={Hash} title="No keywords" />}
            </Card>
            <Card>
              <CardHeader label="Where it appeared" title="Platforms" icon={Layers} />
              <ul className="space-y-2">
                {claim.platforms.map((p) => (
                  <li key={p.platform_name} className="flex items-center justify-between text-[15px]">
                    <span className="text-ink">{p.platform_name}</span>
                    <span className="font-bold text-ink-2">{p.sources}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader label="Every known appearance" title="Sources" subtitle="Each row is one source and the version of the claim it carried." icon={Layers} />
          {sourcesState.error ? <ErrorState compact error={sourcesState.error} onRetry={sourcesState.reload} />
            : !sourcesState.data ? <LoadingBlock rows={5} />
              : sourcesState.data.length ? <SourceTable sources={sourcesState.data} />
                : <EmptyState compact title="No sources stored">This claim has no stored sources yet.</EmptyState>}
        </Card>

        <LineageSection id={id} />

        <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
          {mutationsState.error ? <ErrorState error={mutationsState.error} onRetry={mutationsState.reload} />
            : !mutationsState.data ? <div className="card card-pad"><LoadingBlock rows={8} /></div>
              : <MutationLedger mutations={mutationsState.data} />}
          {sourcesState.data ? <Timeline sources={sourcesState.data} /> : <div className="card card-pad"><LoadingBlock rows={8} /></div>}
        </div>
      </div>
    </div>
  );
}
