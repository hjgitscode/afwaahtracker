import { Gauge } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import { ErrorState, LoadingBlock } from '../ui/States.jsx';
import { formatPercent } from '../../utils/format.js';

/**
 * Analysis coverage: what Oracle holds for this claim at every stage
 * (VW_CLAIM_NOVELTY_DIAGNOSTICS). A zero here is a computed result.
 */
export default function AnalysisCoverage({ state }) {
  const d = state.data;
  const items = d ? [
    ['Sources analysed', d.sourceCount],
    ['Evidence-bearing sources', d.readableSourceCount],
    ['Evidence sentences', d.evidenceCount],
    ['Structured variants', d.structuredVariantCount],
    ['Dated variants', d.datedVariantCount],
    ['Variants with parent', d.variantsWithParent],
    ['Mutation rows', d.mutationCount],
    ['Stated attributions', d.statedAttributionCount],
    ['Resolved upstream dependencies', d.sourcesWithKnownUpstream],
    ['Known Echo Ratio', formatPercent(d.knownEchoRatio)],
  ] : [];
  return (
    <Card>
      <CardHeader
        label="VW_CLAIM_NOVELTY_DIAGNOSTICS"
        title="Analysis coverage"
        subtitle="Counted in Oracle for this claim family. A zero is a computed result, not a missing feature."
        icon={Gauge}
      />
      {state.error ? <ErrorState compact error={state.error} onRetry={state.reload} />
        : !d ? <LoadingBlock rows={3} />
          : (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
              {items.map(([label, value]) => (
                <div key={label} className="min-w-0 bg-card px-4 py-3">
                  <dt className="meta-label !text-[10.5px]">{label}</dt>
                  <dd className="mt-0.5 text-[20px] font-extrabold leading-tight text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          )}
    </Card>
  );
}
