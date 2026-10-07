import { Info } from 'lucide-react';
import { ECHO_DISCLAIMER, echoColor } from '../../utils/echo.js';
import { formatPercent } from '../../utils/format.js';

/** Horizontal 0-100 bar. Blue for low/mid ranges, amber above 60%. */
export function EchoBar({ ratio, height = 8 }) {
  const r = Math.max(0, Math.min(100, Number(ratio) || 0));
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-[#e2e9f1]" style={{ height }} role="img" aria-label={`Echo Ratio ${r}%`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${r}%`, background: echoColor(r) }} />
    </div>
  );
}

export function EchoTooltip({ className = '' }) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      <Info size={15} className="cursor-help text-muted" aria-label={ECHO_DISCLAIMER} tabIndex={0} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold normal-case leading-snug tracking-normal text-white opacity-0 shadow-hero transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        {ECHO_DISCLAIMER}
      </span>
    </span>
  );
}

/** Full Echo Ratio panel used on the investigation page. */
export default function EchoMeter({ ratio, band, derived, total }) {
  const high = Number(ratio) > 60;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="meta-label">Echo Ratio</span>
        <EchoTooltip />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[2.6rem] font-extrabold leading-none tracking-tight" style={{ color: high ? '#b9821c' : 'var(--deep-blue)' }}>
          {formatPercent(ratio)}
        </span>
        <span className={`text-[12px] font-extrabold uppercase tracking-[0.08em] ${high ? 'text-warning' : 'text-primary'}`}>{band}</span>
      </div>
      <p className="mt-2 text-[15px] text-ink-2">
        {derived} of {total} source{total === 1 ? '' : 's'} derive from earlier known sources.
      </p>
      <div className="mt-4">
        <EchoBar ratio={ratio} height={10} />
        <div className="mt-1.5 flex justify-between text-[11px] font-bold text-muted">
          <span>0</span><span>30</span><span>60</span><span>80</span><span>100</span>
        </div>
      </div>
      <p className="mt-3 text-[13px] font-semibold text-muted">{ECHO_DISCLAIMER}</p>
    </div>
  );
}
