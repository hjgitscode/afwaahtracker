import { History } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import Badge, { DependencyBadge } from '../ui/Badge.jsx';
import ExternalLink from '../ui/ExternalLink.jsx';
import { formatDate, formatTime } from '../../utils/format.js';

export default function Timeline({ sources }) {
  const items = [...(sources || [])].sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
  return (
    <Card>
      <CardHeader label="Chronology" title="Timeline" subtitle="Every known appearance, oldest first." icon={History} />
      <ol className="relative">
        {items.map((s, i) => {
          const earliest = i === 0;
          return (
            <li key={s.variant_id} className="grid grid-cols-[86px_28px_1fr] gap-x-2 sm:grid-cols-[120px_32px_1fr]">
              <div className="pt-0.5 text-right">
                <div className="text-[14px] font-bold text-ink">{formatDate(s.published_at)}</div>
                <div className="text-[13px] text-muted">{formatTime(s.published_at)}</div>
              </div>
              <div className="relative flex justify-center">
                <span className={`absolute top-0 w-[2px] bg-[#c9dcf0] ${i === items.length - 1 ? 'h-3' : 'h-full'}`} />
                <span className={`relative z-10 mt-1 h-3.5 w-3.5 rounded-full ring-4 ${earliest ? 'bg-primary ring-[#d6e6f8]' : 'bg-white ring-[#dde9f6] border-2 border-primary'}`} />
              </div>
              <div className="pb-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-ink">{s.publisher}</span>
                  <span className="text-[13px] text-muted">· {s.platform_name}</span>
                  {earliest && <Badge tone="navy">Earliest known source</Badge>}
                  <DependencyBadge dependency={s.dependency} />
                </div>
                <p className="mt-1 text-[15px] text-ink-2">“{s.variant_text}”</p>
                <div className="mt-1.5"><ExternalLink href={s.source_url}>View source</ExternalLink></div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
