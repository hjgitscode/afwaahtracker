import { RETRIEVAL_LABEL, dependencyLabel } from '../../utils/labels.js';

const TONES = {
  blue: 'bg-[#e3eefb] text-deep border-[#c9dcf2]',
  navy: 'bg-navy text-white border-navy',
  muted: 'bg-[#eef2f6] text-ink-2 border-line',
  amber: 'bg-[#fdf3d6] text-[#8a6410] border-[#f3dd9a]',
  green: 'bg-[#e4f2ec] text-[#2f6e55] border-[#c3e2d5]',
  red: 'bg-[#f8e6e6] text-[#934343] border-[#ecc9c9]',
  electric: 'bg-[#e1f5fb] text-[#1f6d87] border-[#bfe8f5]',
  white: 'bg-white/10 text-white border-white/20',
};

export default function Badge({ tone = 'blue', icon: Icon, className = '', children, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase leading-none tracking-[0.07em] ${TONES[tone] || TONES.blue} ${className}`}
    >
      {Icon && <Icon size={12} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

const STATUS_TONE = {
  UNVERIFIED: 'muted',
  DEVELOPING: 'blue',
  CORROBORATED: 'green',
  DISPUTED: 'amber',
  DEBUNKED: 'red',
  CANDIDATE: 'electric',
};

export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'muted'}>{status ? status.toLowerCase() : 'unknown'}</Badge>;
}

/** LIVE (web search, feeds, manual) vs DEMO (curated demonstration data). */
export function OriginBadge({ origin }) {
  if (origin === 'DEMO') return <Badge tone="muted" title="Synthetic demonstration data">Demo</Badge>;
  return <Badge tone="electric" title={`Live data · ${RETRIEVAL_LABEL[origin] || 'stored'}`}>Live</Badge>;
}

export function DependencyBadge({ derived, demo }) {
  return derived ? (
    <Badge tone="amber">{dependencyLabel(true, demo)}</Badge>
  ) : (
    <Badge tone={demo ? 'green' : 'muted'}>{dependencyLabel(false, demo)}</Badge>
  );
}

const METHOD_LABEL = {
  CURATED: ['Curated', 'muted'],
  RULE_STRONG: ['Strong match', 'green'],
  RULE_CANDIDATE: ['Candidate match', 'amber'],
  NEW_CLAIM: ['New claim', 'electric'],
  MANUAL: ['Manual', 'blue'],
};

export function MatchBadge({ method }) {
  const [label, tone] = METHOD_LABEL[method] || [method || '—', 'muted'];
  return <Badge tone={tone}>{label}</Badge>;
}
