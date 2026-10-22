import { useEffect, useState } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { api } from '../../services/api.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Which Oracle objects produced each part of the claim page. Collapsed by
 * default; when opened, the counts come from VW_CLAIM_NOVELTY_DIAGNOSTICS
 * (every novelty stage counted in Oracle) and the investigations' recorded
 * pipeline stages (SEARCH_RUN_STAGES).
 */
export default function DatabaseTrace({ claim }) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState(null);
  useEffect(() => {
    if (!open || diag) return undefined;
    const ctrl = new AbortController();
    api.claimDiagnostics(claim.claim_id, { signal: ctrl.signal }).then(setDiag).catch(() => {});
    return () => ctrl.abort();
  }, [open, diag, claim.claim_id]);
  const d = diag || {};
  const rows = [
    ['Canonical claim', 'CLAIMS + CLAIM_PROPOSITIONS', claim.normalized_signature ? `signature ${claim.normalized_signature}` : 'curated claim (no extracted proposition)'],
    ['Evidence sentences', 'SOURCE_EVIDENCE via VW_CLAIM_EVIDENCE', `${plural(claim.evidence_count, 'sentence')}${diag ? ` linked to ${d.variantsWithEvidence} of ${d.variantCount} variants` : ''}`],
    ['Source versions', 'CLAIM_VARIANTS + SOURCES', `${claim.variant_count} variants, COUNT(DISTINCT source_id) = ${claim.number_of_sources}${diag ? `; ${d.structuredVariantCount} structured` : ''}`],
    ['Entities', 'CLAIM_ENTITIES + ENTITIES + ENTITY_ALIASES', `${claim.entities.length} linked`],
    ['Claim lineage', 'CLAIM_VARIANTS.parent_variant_id + CONNECT BY', diag ? `${plural(d.claimLineageEdges, 'parent link')}; ${d.datedSourceCount} of ${d.sourceCount} sources dated` : 'self-referencing foreign key'],
    ['Mutations', 'CLAIM_MUTATIONS (FINALISE_CLAIM_LINEAGE -> GENERATE_MUTATION_LEDGER)', plural(diag ? d.mutationCount : claim.mutation_count, 'row')],
    ['Provenance', 'SOURCE_REFERENCES + SOURCES.derived_from_source_id', diag
      ? `${plural(d.sourceReferenceCount, 'reference')} from these sources; ${d.sourcesWithKnownUpstream} with a known upstream source`
      : `${claim.known_upstream_count} known upstream`],
    ['Known Echo Ratio', 'CALCULATE_ECHO_RATIO() / VW_CLAIM_INVESTIGATION', `${claim.echo_ratio_plsql ?? claim.known_echo_ratio}%`],
    ['Chronology', 'MIN(published_at) + ORDER BY published_at NULLS LAST', 'earliest dated source first'],
  ];
  const stages = (d.stages || []).filter((s) => s.search_run_id === d.stages[0].search_run_id);
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
          {stages.length > 0 && (
            <div className="min-w-0 bg-card px-5 py-3.5 sm:col-span-2">
              <dt className="meta-label">Pipeline stages of investigation #{stages[0].search_run_id} (SEARCH_RUN_STAGES)</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {stages.map((s) => (
                  <span key={s.stage_code} title={s.detail || ''} className="rounded-md border border-line bg-tint/60 px-2 py-0.5 font-mono text-[11.5px] text-deep">
                    {s.stage_code.toLowerCase()} {s.items_examined}→{s.rows_written}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
