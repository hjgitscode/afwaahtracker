/** Display helpers for Echo Ratio values that Oracle has already computed. */
export const ECHO_BANDS = [
  { key: 'MOSTLY INDEPENDENT SOURCING', range: '0–30%', short: 'Mostly independent' },
  { key: 'MIXED SOURCING', range: '31–60%', short: 'Mixed' },
  { key: 'HIGH REPETITION', range: '61–80%', short: 'High repetition' },
  { key: 'VERY HIGH SOURCE DEPENDENCE', range: '81–100%', short: 'Very high dependence' },
];

export const ECHO_DISCLAIMER = 'Echo Ratio measures source dependence, not truthfulness.';

export function echoColor(ratio) {
  const r = Number(ratio) || 0;
  if (r > 80) return 'var(--warning)';
  if (r > 60) return 'var(--amber)';
  if (r > 30) return 'var(--primary-blue)';
  return 'var(--bright-blue)';
}
