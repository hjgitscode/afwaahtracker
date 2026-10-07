import { useState } from 'react';
import {
  ArrowRight, Boxes, Database, FunctionSquare, GitMerge, KeyRound, Layers, ListTree, Play, Rss, ShieldCheck, Table2, Workflow, Zap,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import ERDiagram from '../components/ERDiagram.jsx';
import { ErrorState, LoadingBlock } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { formatNumber } from '../utils/format.js';

const KEYWORDS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|ON|GROUP BY|ORDER BY|HAVING|AS|AND|OR|IN|COUNT|SUM|AVG|MIN|MAX|NVL|ROUND|DISTINCT|START WITH|CONNECT BY|PRIOR|LEVEL|FETCH FIRST|ROWS ONLY|DESC|LPAD|SYS_CONNECT_BY_PATH|TO_CHAR|CASE|WHEN|THEN|ELSE|END)\b/g;

function Sql({ code }) {
  const parts = code.split(KEYWORDS);
  return (
    <pre className="code-block">
      <code>
        {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="font-semibold text-[#68A8FF]">{p}</span> : <span key={i}>{p}</span>))}
      </code>
    </pre>
  );
}

function QueryCard({ q }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const run = async () => {
    setState({ loading: true, data: null, error: null });
    try {
      setState({ loading: false, data: await api.labQuery(q.key), error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  };
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="system-label">{q.concept}</div>
          <h3 className="mt-1 text-[18px] font-extrabold text-ink">{q.title}</h3>
        </div>
        <button type="button" onClick={run} disabled={state.loading} className="btn btn-secondary btn-sm">
          <Play size={14} /> {state.loading ? 'Running…' : 'Run query'}
        </button>
      </div>
      <Sql code={q.sql} />
      {state.error && <div className="mt-3"><ErrorState compact error={state.error} /></div>}
      {state.data && (
        <div className="fade-up mt-4">
          <div className="mb-2 text-[13px] text-muted">{state.data.rows.length} row{state.data.rows.length === 1 ? '' : 's'} · {state.data.elapsedMs} ms · read-only</div>
          <div className="max-h-72 overflow-auto rounded-xl border border-line">
            <table className="data-table text-[13.5px]">
              <thead><tr>{state.data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {state.data.rows.map((r, i) => (
                  <tr key={i}>{state.data.columns.map((c) => <td key={c} className="whitespace-pre">{r[c] === null ? <span className="text-muted">NULL</span> : String(r[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

const PIPELINE = [
  ['Fetch', 'GDELT DOC API, Hacker News Firebase API and RSS/Atom feeds on a node-cron schedule.'],
  ['Normalise', 'Clean titles, normalise URLs (tracking parameters removed), parse timestamps.'],
  ['Deduplicate', 'INGEST_SOURCE checks the unique URL / external-id indexes before inserting.'],
  ['Match', 'Dictionary entities & keywords, then weighted rule-based scoring against candidate claims.'],
  ['Store', 'ADD_CLAIM_VARIANT in one transaction; the trigger writes the Mutation Ledger.'],
  ['Log', 'START / FINISH_INGESTION_RUN record fetched, inserted and skipped counts.'],
];

const NORMAL_FORMS = [
  ['1NF', 'Atomic columns only. Entities, aliases and keywords live in their own rows rather than comma lists.'],
  ['2NF', 'Junction tables (CLAIM_ENTITIES, CLAIM_KEYWORDS) carry only attributes of the whole composite key.'],
  ['3NF', 'Platform, category and entity details are stored once and referenced by key; Echo Ratio is computed in views, never stored.'],
];

export default function DatabaseLabPage() {
  const { data, error, reload } = useApi((signal) => api.lab({ signal }), []);
  const count = (type) => data?.objects.find((o) => o.object_type === type)?.total ?? '—';
  const fkCount = data?.constraints.find((c) => c.constraint_type === 'FOREIGN KEY')?.total ?? '—';
  const selfRefs = data?.relationships.filter((r) => r.self_reference === 'Y').length ?? 0;
  const totalRows = data ? data.tables.reduce((s, t) => s + (t.rows || 0), 0) : 0;

  const tiles = [
    ['Oracle database', data ? data.database.split('\n')[0].replace(/ - .*/, '') : 'Oracle', Database],
    ['Tables', count('TABLE'), Table2],
    ['Relationships', fkCount, GitMerge],
    ['Views', count('VIEW'), Layers],
    ['PL/SQL units', data ? Number(count('PROCEDURE')) + Number(count('FUNCTION')) : '—', FunctionSquare],
    ['Triggers', count('TRIGGER'), Zap],
    ['Indexes', count('INDEX'), ListTree],
    ['Rows stored', data ? formatNumber(totalRows) : '—', Boxes],
  ];

  return (
    <div className="relative">
      <Watermark word="DATABASE" style={{ top: -30, right: -60 }} />
      <PageHeader label="Database lab" title="The relational engine behind AfwaahTracker." subtitle="Oracle SQL and PL/SQL do the heavy lifting: integrity, aggregation, Echo Ratio, lineage and the Mutation Ledger all live in the database." />

      {error && <div className="relative z-10 mb-6"><ErrorState error={error} onRetry={reload} /></div>}

      <div className="relative z-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map(([label, value, Icon]) => (
          <div key={label} className="card card-hover p-5">
            <div className="flex items-center justify-between">
              <span className="meta-label">{label}</span>
              <Icon size={18} className="text-primary" />
            </div>
            <div className={`mt-2 font-extrabold leading-tight text-ink ${String(value).length > 10 ? 'text-[17px]' : 'text-[1.9rem]'}`}>{data ? value : <LoadingBlock rows={1} />}</div>
          </div>
        ))}
      </div>

      <div className="relative z-10 mt-6 space-y-6">
        <Card>
          <CardHeader label="Relational model" title="Entity–relationship diagram" subtitle={`${fkCount} foreign keys, including ${selfRefs} self-referencing relationships, across ${count('TABLE')} tables.`} icon={GitMerge} />
          <ERDiagram />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader label="Integrity" title="Constraints" icon={ShieldCheck} />
            {!data ? <LoadingBlock /> : (
              <ul className="space-y-2">
                {data.constraints.map((c) => (
                  <li key={c.constraint_type} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
                    <span className="font-bold text-ink">{c.constraint_type}</span>
                    <span className="text-[18px] font-extrabold text-primary">{c.total}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[14px] text-ink-2">Entity integrity through primary keys, referential integrity through foreign keys (CASCADE / SET NULL rules) and domain integrity through CHECK, NOT NULL and DEFAULT.</p>
          </Card>

          <Card>
            <CardHeader label="Approximately third normal form" title="Normalisation" icon={KeyRound} />
            <ul className="space-y-3">
              {NORMAL_FORMS.map(([nf, text]) => (
                <li key={nf} className="flex gap-3">
                  <span className="grid h-9 w-11 shrink-0 place-items-center rounded-lg bg-navy text-[13px] font-extrabold text-white">{nf}</span>
                  <p className="text-[15px] text-ink-2">{text}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader label="Procedures · functions · triggers" title="PL/SQL" icon={FunctionSquare} />
            {!data ? <LoadingBlock rows={6} /> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {data.programUnits.map((u) => (
                  <div key={u.object_name} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2">
                    <span className="truncate font-mono text-[12.5px] font-semibold text-ink" title={u.object_name}>{u.object_name}</span>
                    <Badge tone={u.object_type === 'TRIGGER' ? 'amber' : u.object_type === 'FUNCTION' ? 'electric' : 'blue'}>{u.object_type.toLowerCase()}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader label="Views & indexes" title="Query layer" icon={Layers} />
            {!data ? <LoadingBlock rows={6} /> : (
              <>
                <div className="meta-label mb-2">Views</div>
                <div className="flex flex-wrap gap-2">
                  {data.views.map((v) => <span key={v} className="rounded-lg bg-tint px-2.5 py-1 font-mono text-[12.5px] font-semibold text-deep">{v}</span>)}
                </div>
                <div className="meta-label mb-2 mt-5">Indexes ({data.indexes.length})</div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-white">
                  {data.indexes.map((ix) => (
                    <div key={ix.index_name} className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[12.5px] last:border-0">
                      <span className="font-mono font-semibold text-ink">{ix.index_name}</span>
                      <span className="text-muted">{ix.table_name}{ix.uniqueness === 'UNIQUE' ? ' · unique' : ''}{ix.index_type.startsWith('FUNCTION') ? ' · function-based' : ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader label="Automated" title="Ingestion pipeline" icon={Rss} />
            <ol className="grid gap-3 sm:grid-cols-2">
              {PIPELINE.map(([step, text], i) => (
                <li key={step} className="rounded-xl border border-line bg-white p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[12px] font-extrabold text-white">{i + 1}</span>
                    <span className="font-extrabold uppercase tracking-[0.04em] text-ink">{step}</span>
                  </div>
                  <p className="mt-2 text-[14px] text-ink-2">{text}</p>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader label="Atomic units of work" title="Transactions" icon={Workflow} />
            <ul className="space-y-3 text-[15px] text-ink-2">
              <li className="flex gap-2"><ArrowRight size={17} className="mt-1 shrink-0 text-primary" /><span>Every ingested item is one transaction: source, claim, variant, entity and keyword links are <b className="text-ink">committed together or rolled back together</b>.</span></li>
              <li className="flex gap-2"><ArrowRight size={17} className="mt-1 shrink-0 text-primary" /><span>ADD_CLAIM_VARIANT sets a <b className="text-ink">SAVEPOINT</b> and rolls back to it on any error.</span></li>
              <li className="flex gap-2"><ArrowRight size={17} className="mt-1 shrink-0 text-primary" /><span>Audit rows are written inside the same transaction, so a rollback leaves no orphaned audit entries.</span></li>
              <li className="flex gap-2"><ArrowRight size={17} className="mt-1 shrink-0 text-primary" /><span>The API uses a <b className="text-ink">node-oracledb connection pool</b> and bind variables for every statement.</span></li>
            </ul>
          </Card>
        </div>

        <Card>
          <CardHeader label="Row counts" title="Tables" icon={Table2} />
          {!data ? <LoadingBlock rows={4} /> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {data.tables.map((t) => (
                <div key={t.table_name} className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2">
                  <span className="font-mono text-[12.5px] font-semibold text-ink">{t.table_name}</span>
                  <span className="text-[13px] text-ink-2"><b className="text-ink">{formatNumber(t.rows)}</b> rows · {t.columns} cols</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div>
          <div className="mb-4">
            <div className="system-label mb-1">Read-only examples</div>
            <h2 className="card-title !text-[24px]">Example SQL</h2>
            <p className="mt-1 text-[15px] text-ink-2">A fixed set of queries that run against the live schema. Arbitrary SQL cannot be executed from the browser.</p>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {data?.queries.map((q) => <QueryCard key={q.key} q={q} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
