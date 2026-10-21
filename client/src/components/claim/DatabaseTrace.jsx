import { useState } from 'react';
import { ChevronDown, Database } from 'lucide-react';

/**
 * Which Oracle objects produced each part of the claim page. Collapsed by
 * default; the values are the live ones Oracle returned for this claim.
 */
export default function DatabaseTrace({ claim }) {
  const [open, setOpen] = useState(false);
  const rows = [
    ['Canonical claim', 'CLAIMS + CLAIM_PROPOSITIONS', claim.normalized_signature ? `signature ${claim.normalized_signature}` : 'curated claim (no extracted proposition)'],
    ['Evidence sentences', 'SOURCE_EVIDENCE via VW_CLAIM_EVIDENCE', `${claim.evidence_count} sentence${claim.evidence_count === 1 ? '' : 's'}`],
    ['Source versions', 'CLAIM_VARIANTS + SOURCES', `${claim.variant_count} variants, COUNT(DISTINCT source_id) = ${claim.number_of_sources}`],
    ['Entities', 'CLAIM_ENTITIES + ENTITIES + ENTITY_ALIASES', `${claim.entities.length} linked`],
    ['Mutations', 'CLAIM_MUTATIONS (trigger -> GENERATE_MUTATION_LEDGER)', `${claim.mutation_count} rows`],
    ['Provenance', 'SOURCE_REFERENCES + SOURCES.derived_from_source_id', `${claim.known_upstream_count} known upstream link${claim.known_upstream_count === 1 ? '' : 's'}`],
    ['Known Echo Ratio', 'CALCULATE_ECHO_RATIO() / VW_CLAIM_INVESTIGATION', `${claim.echo_ratio_plsql ?? claim.known_echo_ratio}%`],
    ['Chronology', 'MIN(published_at) + ORDER BY published_at NULLS LAST', 'earliest dated source first'],
    ['Claim lineage', 'CLAIM_VARIANTS.parent_variant_id + CONNECT BY', 'self-referencing foreign key'],
  ];
  return (
    <section className="card">
      <button type="button" className="flex w-full items-center justify-between gap-3 p-5 text-left md:p-6" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-tint text-primary"><Database size={18} /></span>
          <span>
            <span className="system-label block">How Oracle produced this page</span>
            <span className="card-title !text-[17px]">Database trace</span>
          </span>
        </span>
        <ChevronDown size={20} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="fade-up grid gap-px border-t border-line bg-line sm:grid-cols-2">
          {rows.map(([what, source, value]) => (
            <div key={what} className="min-w-0 bg-card px-5 py-3.5">
              <dt className="meta-label">{what}</dt>
              <dd className="mt-0.5 break-words font-mono text-[12.5px] font-semibold text-deep">{source}</dd>
              <dd className="mt-0.5 break-words text-[13px] text-ink-2">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
