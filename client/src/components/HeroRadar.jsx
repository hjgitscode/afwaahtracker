import { FileText, Globe, Link2, MessageSquare } from 'lucide-react';

/**
 * Original abstract "signal / source radar" illustration: concentric rings,
 * a central signal, connected source nodes and slow pulses.
 */
const NODES = [
  { x: 92, y: 110, icon: FileText, label: 'Article' },
  { x: 318, y: 92, icon: Globe, label: 'Web' },
  { x: 334, y: 286, icon: MessageSquare, label: 'Post' },
  { x: 86, y: 300, icon: Link2, label: 'Link' },
];

export default function HeroRadar() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[400px]" aria-hidden="true">
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#5EC7EA" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#4F8FD8" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#4F8FD8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5EC7EA" stopOpacity="0" />
            <stop offset="100%" stopColor="#5EC7EA" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#glow)" />
        {[170, 120, 70].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="rgba(160,196,230,.28)" strokeWidth="1.5" />
        ))}
        <line x1="20" y1="200" x2="380" y2="200" stroke="rgba(160,196,230,.12)" />
        <line x1="200" y1="20" x2="200" y2="380" stroke="rgba(160,196,230,.12)" />
        <g className="radar-sweep">
          <path d="M200 200 L370 200 A170 170 0 0 0 320 80 Z" fill="url(#sweepGrad)" />
        </g>
        {/* connector paths from sources to the signal */}
        {NODES.map((n, i) => (
          <path
            key={i}
            d={`M${n.x} ${n.y} Q ${(n.x + 200) / 2 + (i % 2 ? 30 : -30)} ${(n.y + 200) / 2} 200 200`}
            fill="none"
            stroke="rgba(104,168,255,.45)"
            strokeWidth="1.4"
            strokeDasharray="4 5"
          />
        ))}
        <path d="M318 92 Q 330 190 334 286" fill="none" stroke="rgba(160,196,230,.25)" strokeWidth="1.2" strokeDasharray="3 6" />
        <circle cx="200" cy="200" r="22" fill="none" stroke="#5EC7EA" strokeWidth="2" className="radar-pulse" />
        <circle cx="200" cy="200" r="22" fill="none" stroke="#5EC7EA" strokeWidth="2" className="radar-pulse radar-pulse-delay" />
        <circle cx="200" cy="200" r="13" fill="#5EC7EA" />
        <circle cx="200" cy="200" r="5" fill="#fff" />
        {[[150, 150], [262, 168], [236, 262], [146, 240], [280, 230]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.2" fill="#68A8FF" className="node-blink" style={{ animationDelay: `${i * 0.6}s` }} />
        ))}
      </svg>
      {NODES.map(({ x, y, icon: Icon, label }) => (
        <div
          key={label}
          className="absolute grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border border-white/15 bg-[#2c4658] text-[#a9cdf0] shadow-[0_8px_18px_rgba(10,20,30,.25)]"
          style={{ left: `${(x / 400) * 100}%`, top: `${(y / 400) * 100}%` }}
        >
          <Icon size={21} strokeWidth={1.8} />
        </div>
      ))}
      <div className="absolute left-1/2 top-[64%] -translate-x-1/2 rounded-full border border-white/15 bg-[#2a4354]/90 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#9fc4e8]">
        Origin signal
      </div>
    </div>
  );
}
