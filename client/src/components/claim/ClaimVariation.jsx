import { Columns3 } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States.jsx';
import { formatDate, truncate } from '../../utils/format.js';

const pretty = (v) => (v === null || v === undefined || v === '' ? null : /^[A-Z_]+$/.test(v) ? v.charAt(0) + v.slice(1).toLowerCase() : v);

/**
 * How the retrieved versions of this claim differ (VW_CLAIM_VARIATION).
 * Oracle decides which dimensions vary; nothing here implies order,
 * parentage or copying.
 */
export default function ClaimVariation({ state }) {
  const data = state.data;
  return (
    <Card>
      <CardHeader
        label="VW_CLAIM_VARIATION · COUNT(DISTINCT …) OVER (PARTITION BY claim)"
        title="Claim variation"
        subtitle="Claim Variation compares retrieved versions without assuming that one came from another."
        icon={Columns3}
      />
      {state.error ? <ErrorState compact error={state.error} onRetry={state.reload} />
        : !data ? <LoadingBlock rows={4} />
          : data.variantCount < 2 ? (
            <EmptyState compact icon={Columns3} title={`${data.variantCount} structured version available`}>
              Variation requires at least two versions of the same claim.
            </EmptyState>
          ) : !data.dimensions.length ? (
            <EmptyState compact icon={Columns3} title={`${data.variantCount} structured versions compared`}>
              No differences were detected in the tracked fields (certainty, date, quantity, location, event, attribution, object, qualifier).
            </EmptyState>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-ink-2">
                <span><b className="text-ink">{data.variantCount}</b> versions compared</span>
                <span>Differences observed in <b className="text-ink">{data.dimensions.map((d) => d.label.toLowerCase()).join(', ')}</b></span>
              </div>
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="data-table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>Source version</th>
                      {data.dimensions.map((d) => <th key={d.column}>{d.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.variants.map((v) => (
                      <tr key={v.variant_id}>
                        <td className="max-w-[320px]">
                          <div className="font-bold text-ink">{v.publisher}</div>
                          <div className="text-[13px] text-ink-2">{v.published_at ? formatDate(v.published_at) : 'Date not determined'}</div>
                          <div className="mt-1 text-[13px] text-ink-2">“{truncate(v.variant_text, 110)}”</div>
                        </td>
                        {data.dimensions.map((d) => (
                          <td key={d.column} className="text-[14px]">
                            {pretty(v.values[d.column]) ?? <span className="text-muted">Not stated</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </Card>
  );
}
