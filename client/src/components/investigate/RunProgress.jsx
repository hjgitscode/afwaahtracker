import { Check, Circle, LoaderCircle } from 'lucide-react';

const SUMMARY = [
  ['resultsReceived', 'Results found'],
  ['sourcesAnalysed', 'Sources analysed'],
  ['sourcesInserted', 'New sources'],
  ['duplicatesSkipped', 'Duplicates'],
  ['claimFamilies', 'Claim families'],
];

/** Live stage list while a run is RUNNING (stages come from the server). */
export function RunStages({ status }) {
  const stages = status?.stages || [];
  const current = status?.stageIndex ?? -1;
  return (
    <div className="card card-pad" aria-live="polite">
      <div className="system-label mb-4">Investigating the live web</div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stages.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.key} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-[14.5px] transition-colors ${active ? 'border-[#b9d2ec] bg-tint text-ink' : done ? 'border-line bg-white text-ink-2' : 'border-line bg-white/60 text-muted'}`}>
              {done ? <Check size={18} className="shrink-0 text-success" strokeWidth={2.6} />
                : active ? <LoaderCircle size={18} className="spin shrink-0 text-primary" />
                  : <Circle size={16} className="shrink-0 text-[#c4d0dc]" />}
              <span className={active ? 'font-bold' : 'font-semibold'}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Five numbers shown once the run has finished. */
export function RunSummary({ counts }) {
  if (!counts) return null;
  return (
    <div className="card grid grid-cols-2 gap-px overflow-hidden bg-line p-0 sm:grid-cols-3 lg:grid-cols-5">
      {SUMMARY.map(([key, label]) => (
        <div key={key} className="bg-card p-4 md:p-5">
          <div className="meta-label">{label}</div>
          <div className="mt-1 text-[1.8rem] font-extrabold leading-none text-ink">{counts[key] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}
