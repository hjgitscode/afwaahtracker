import { useState } from 'react';
import { History } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import Badge, { DependencyBadge } from '../ui/Badge.jsx';
import ExternalLink from '../ui/ExternalLink.jsx';
import { formatDate, formatTime } from '../../utils/format.js';

const INITIAL = 8;

/**
 * Source chronology. The order comes from Oracle (published_at, unknown dates
 * last); the page never re-sorts it. The first dated source is only the
 * earliest source FOUND, not necessarily the origin.
 */
export default function Timeline({ sources, demo }) {
  const [all, setAll] = useState(false);
  const items = sources || [];
  const shown = all ? items : items.slice(0, INITIAL);
  return (
    <Card>
      <CardHeader
        label="Ordered by publication date in Oracle"
        title="Source chronology"
        subtitle={demo ? 'Every known appearance, oldest first.' : 'Every retrieved appearance, oldest first. Sources without a detectable date are listed last.'}
        icon={History}
      />
      <ol className="relative">
        {shown.map((s, i) => {
          const earliest = s.is_earliest === 'Y';
          const last = i === shown.length - 1;
          return (
            <li key={s.variant_id} className="grid grid-cols-[84px_26px_minmax(0,1fr)] gap-x-2 sm:grid-cols-[120px_32px_minmax(0,1fr)]">
              <div className="pt-0.5 text-right">
                {s.published_at ? (
                  <>
                    <div className="text-[14px] font-bold text-ink">{formatDate(s.published_at)}</div>
                    <div className="text-[13px] text-muted">{formatTime(s.published_at)}</div>
                  </>
                ) : (
                  <div className="text-[12.5px] font-semibold leading-tight text-muted">Date not determined</div>
                )}
              </div>
              <div className="relative flex justify-center">
                <span className={`absolute top-0 w-[2px] bg-[#c9dcf0] ${last ? 'h-3' : 'h-full'}`} />
                <span className={`relative z-10 mt-1 h-3.5 w-3.5 rounded-full ring-4 ${earliest ? 'bg-primary ring-[#d6e6f8]' : 'border-2 border-primary bg-white ring-[#dde9f6]'}`} />
              </div>
              <div className="min-w-0 pb-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-ink">{s.publisher}</span>
                  <span className="text-[13px] text-muted">· {s.platform_name}</span>
                  {earliest && <Badge tone="navy">{demo ? 'Earliest known source' : 'Earliest known source found'}</Badge>}
                  <DependencyBadge derived={Boolean(s.derived_from_source_id)} demo={demo} />
                </div>
                <p className="mt-1 text-[15px] text-ink-2">“{s.variant_text}”</p>
                {s.derived_from_publisher && (
                  <p className="mt-1 text-[13px] text-muted">Links to earlier reporting by {s.derived_from_publisher}</p>
                )}
                <div className="mt-1.5"><ExternalLink href={s.source_url}>View source</ExternalLink></div>
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > INITIAL && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${items.length} sources`}
        </button>
      )}
    </Card>
  );
}
