const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const NUM_FMT = new Intl.NumberFormat('en-IN');

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (v) => (toDate(v) ? DATE_FMT.format(toDate(v)) : '—');
export const formatDateTime = (v) => (toDate(v) ? DATETIME_FMT.format(toDate(v)) : '—');
export const formatTime = (v) => (toDate(v) ? TIME_FMT.format(toDate(v)) : '—');
export const formatNumber = (v) => (v === null || v === undefined ? '—' : NUM_FMT.format(Number(v)));

export function formatPercent(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(digits)}%`;
}

export function timeAgo(v) {
  const d = toDate(v);
  if (!d) return 'never';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(d);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s_-])([a-z])/g, (m, p, c) => `${p === '_' ? ' ' : p}${c.toUpperCase()}`);

export const truncate = (s, n = 80) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

export const SOURCE_TYPE_LABEL = { GDELT: 'GDELT', HACKER_NEWS: 'Hacker News', RSS: 'RSS / Atom' };
