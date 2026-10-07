import { DependencyBadge, MatchBadge } from '../ui/Badge.jsx';
import ExternalLink from '../ui/ExternalLink.jsx';
import { formatDate, formatTime, truncate } from '../../utils/format.js';

export default function SourceTable({ sources }) {
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="data-table min-w-[1080px] table-fixed [&_td]:px-3 [&_th]:px-3">
        <colgroup>
          <col className="w-[17%]" /><col className="w-[10%]" /><col className="w-[23%]" /><col className="w-[11%]" />
          <col className="w-[10%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[9%]" />
        </colgroup>
        <thead>
          <tr>
            <th>Publisher</th>
            <th>Platform</th>
            <th>Claim version</th>
            <th>Published</th>
            <th>Match score</th>
            <th>Dependency</th>
            <th>Derived from</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.variant_id}>
              <td>
                <div className="font-bold text-ink">{s.publisher}</div>
                {s.author && <div className="text-[13px] text-muted">by {s.author}</div>}
              </td>
              <td className="text-ink-2">{s.platform_name}</td>
              <td className="text-ink">“{truncate(s.variant_text, 120)}”</td>
              <td className="text-ink-2">
                <div className="whitespace-nowrap">{formatDate(s.published_at)}</div>
                <div className="text-[13px] text-muted">{formatTime(s.published_at)}</div>
              </td>
              <td>
                <div className="font-extrabold text-ink">{Number(s.match_score).toFixed(s.match_score % 1 ? 1 : 0)}</div>
                <MatchBadge method={s.match_method} />
              </td>
              <td><DependencyBadge dependency={s.dependency} /></td>
              <td className="text-[14px] text-ink-2">{s.derived_from_publisher || <span className="text-muted">—</span>}</td>
              <td><ExternalLink href={s.source_url}>View</ExternalLink></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
