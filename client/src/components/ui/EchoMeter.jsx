import { Info } from 'lucide-react';
import { echoColor } from '../../utils/echo.js';
import { echoTooltip } from '../../utils/labels.js';

/** Horizontal 0-100 bar. Blue for low/mid ranges, amber above 60%. */
export function EchoBar({ ratio, height = 8 }) {
  const r = Math.max(0, Math.min(100, Number(ratio) || 0));
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-[#e2e9f1]" style={{ height }} role="img" aria-label={`Echo Ratio ${r}%`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${r}%`, background: echoColor(r) }} />
    </div>
  );
}

export function EchoTooltip({ demo = false, className = '' }) {
  const text = echoTooltip(demo);
  return (
    <span className={`group relative inline-flex ${className}`}>
      <Info size={15} className="cursor-help text-muted" aria-label={text} tabIndex={0} />
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold normal-case leading-snug tracking-normal text-white opacity-0 shadow-hero transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}
