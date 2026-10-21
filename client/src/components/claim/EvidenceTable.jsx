import { useState } from 'react';
import Badge, { DependencyBadge } from '../ui/Badge.jsx';
import ExternalLink from '../ui/ExternalLink.jsx';
import { formatDate } from '../../utils/format.js';

const METHOD_LABEL = {
  PAGE_SENTENCE: 'Page sentence',
  META_DESCRIPTION: 'Page description',
  SEARCH_SNIPPET: 'Search snippet',
  TITLE_FALLBACK: 'Page title',
  CURATED: 'Curated',
};
const INITIAL = 10;

/**
 * The exact sentence each source contributed (VW_CLAIM_EVIDENCE), oldest
 * first as ordered by Oracle. The page title is shown only when it was the
 * only evidence available.
 */
export default function EvidenceTable({ rows, demo }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, INITIAL);
  return (
    <>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="data-table min-w-[860px] table-fixed [&_td]:px-3 [&_th]:px-3">
          <colgroup>
            <col className="w-[18%]" /><col className="w-[46%]" /><col className="w-[12%]" /><col className="w-[15%]" /><col className="w-[9%]" />
          </colgroup>
          <thead>
            <tr><th>Publisher</th><th>Evidence</th><th>Published</th><th>Dependency</th><th>Source</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.variant_id}>
                <td>
                  <div className="font-bold text-ink">{r.publisher}</div>
                  <div className="text-[13px] text-muted">{r.platform_name}</div>
                </td>
                <td>
                  <div className="text-ink">“{r.evidence_text}”</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone="muted">{METHOD_LABEL[r.extraction_method] || 'Variant text'}</Badge>
                    {r.certainty && r.certainty !== 'UNSTATED' && <Badge tone={r.certainty === 'CONFIRMED' ? 'green' : 'amber'}>{r.certainty.toLowerCase()}</Badge>}
                  </div>
                </td>
                <td className="text-ink-2">
                  {r.published_at ? formatDate(r.published_at) : <span className="text-[13px] text-muted">Not determined</span>}
                  {r.is_earliest === 'Y' && <div className="mt-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-primary">Earliest found</div>}
                </td>
                <td>
                  <DependencyBadge derived={Boolean(r.derived_from_source_id)} demo={demo} />
                  {r.derived_from_publisher && <div className="mt-1 text-[13px] text-ink-2">from {r.derived_from_publisher}</div>}
                </td>
                <td><ExternalLink href={r.source_url}>View source</ExternalLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > INITIAL && (
        <button type="button" className="btn btn-ghost btn-sm mt-4" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${rows.length} sources`}
        </button>
      )}
    </>
  );
}
