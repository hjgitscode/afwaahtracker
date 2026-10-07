import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartTooltip, { Legend } from './ChartTooltip.jsx';
import { GRID, SERIES } from './palette.js';

/** Sources per platform, split into independent vs derived (counts from VW_PLATFORM_STATISTICS). */
export default function PlatformChart({ data }) {
  const rows = (data || []).map((d) => ({ ...d, total: d.independent_count + d.derived_count }));
  const height = Math.max(220, rows.length * 38 + 30);
  return (
    <div>
      <Legend items={[{ label: 'Independent', color: SERIES[0] }, { label: 'Derived', color: SERIES[1] }]} />
      <div style={{ height }} className="mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 0 }} barCategoryGap={9}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="platform_name" width={128} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(79,143,216,.07)' }} />
            <Bar dataKey="independent_count" name="Independent" stackId="a" fill={SERIES[0]} stroke="#fbfcfe" strokeWidth={2} />
            <Bar dataKey="derived_count" name="Derived" stackId="a" fill={SERIES[1]} stroke="#fbfcfe" strokeWidth={2} radius={[0, 4, 4, 0]}>
              <LabelList dataKey="total" position="right" style={{ fill: '#617080', fontSize: 12, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
