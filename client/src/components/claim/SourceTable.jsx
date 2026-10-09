import { useState } from 'react';
import { DependencyBadge, MatchBadge } from '../ui/Badge.jsx';
import ExternalLink from '../ui/ExternalLink.jsx';
import { formatDate, formatTime, truncate } from '../../utils/format.js';
import { LINEAGE_BASIS_LABEL } from '../../utils/labels.js';

const INITIAL = 10;

export default function SourceTable({ sources, demo }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, INITIAL);
  return (
    <>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="data-table min-w-[1060px] table-fixed [&_td]:px-3 [&_th]:px-3">
          <colgroup>
            <col className="w-[16%]" /><col className="w-[10%]" /><col className="w-[24%]" /><col className="w-[11%]" />
            <col className="w-[11%]" /><col className="w-[14%]" /><col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr>
              <th>Publisher</th>
              <th>Platform</th>
              <th>Claim version</th>
              <th>Published</th>
              <th>Match score</th>
              <th>Dependency</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.variant_id}>
                <td>
                  <div className="font-bold text-ink">{s.publisher}</div>
                  {s.author && <div className="text-[13px] text-muted">by {s.author}</div>}
                </td>
                <td className="text-ink-2">{s.platform_name}</td>
                <td>
                  <div className="text-ink">“{truncate(s.variant_text, 120)}”</div>
                  <div className="mt-1 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    Wording parent: {LINEAGE_BASIS_LABEL[s.lineage_basis] || '—'}
                  </div>
                </td>
                <td className="text-ink-2">
                  {s.published_at ? (
                    <>
                      <div className="whitespace-nowrap">{formatDate(s.published_at)}</div>
                      <div className="text-[13px] text-muted">{formatTime(s.published_at)}</div>
                    </>
                  ) : <span className="text-[13px] text-muted">Not determined</span>}
                </td>
                <td title={s.match_breakdown || undefined}>
                  <div className="font-extrabold text-ink">{Number(s.match_score).toFixed(s.match_score % 1 ? 1 : 0)}</div>
                  <MatchBadge method={s.match_method} />
                </td>
                <td>
                  <DependencyBadge derived={Boolean(s.derived_from_source_id)} demo={demo} />
                  {s.derived_from_publisher && <div className="mt-1 text-[13px] text-ink-2">from {s.derived_from_publisher}</div>}
                </td>
                <td><ExternalLink href={s.source_url}>View</ExternalLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sources.length > INITIAL && (
        <button type="button" className="btn btn-ghost btn-sm mt-4" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${sources.length} sources`}
        </button>
      )}
    </>
  );
}
