/** Display helpers for Echo Ratio values that Oracle has already computed. */
export function echoColor(ratio) {
  const r = Number(ratio) || 0;
  if (r > 80) return 'var(--warning)';
  if (r > 60) return 'var(--amber)';
  if (r > 30) return 'var(--primary-blue)';
  return 'var(--bright-blue)';
}
