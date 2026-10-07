import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartTooltip, { Legend } from './ChartTooltip.jsx';
import { GRID, TYPE_COLOR } from './palette.js';
import { SOURCE_TYPE_LABEL } from '../../utils/format.js';

const TYPES = ['GDELT', 'HACKER_NEWS', 'RSS'];
const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** New sources inserted per day and source type (aggregated in Oracle). */
export default function IngestionChart({ data }) {
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day: key, GDELT: 0, HACKER_NEWS: 0, RSS: 0 });
  }
  const byDay = new Map(days.map((d) => [d.day, d]));
  (data || []).forEach((r) => {
    const row = byDay.get(r.day);
    if (row) row[r.source_type] = r.inserted;
  });
  return (
    <div>
      <Legend items={TYPES.map((t) => ({ label: SOURCE_TYPE_LABEL[t], color: TYPE_COLOR[t] }))} />
      <div className="mt-3 h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 6, right: 6, bottom: 0, left: -18 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tickFormatter={short} tickLine={false} axisLine={false} interval={1} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip labelFormatter={short} />} cursor={{ fill: 'rgba(79,143,216,.07)' }} />
            {TYPES.map((t, i) => (
              <Bar key={t} dataKey={t} name={`${SOURCE_TYPE_LABEL[t]} new`} stackId="s" fill={TYPE_COLOR[t]} stroke="#fbfcfe" strokeWidth={2}
                radius={i === TYPES.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
