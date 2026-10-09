import { useState } from 'react';
import { ArrowRight, GitMerge, Globe, Play, Rss, RefreshCw, Workflow } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card, { CardHeader } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import ERDiagram from '../components/ERDiagram.jsx';
import IngestionChart from '../components/charts/IngestionChart.jsx';
import { ErrorState, LoadingBlock } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';
import { useApi } from '../hooks/useApi.js';
import { useRefresh } from '../hooks/useRefresh.jsx';
import { api } from '../services/api.js';
import { formatNumber, timeAgo, truncate, SOURCE_TYPE_LABEL } from '../utils/format.js';

const KEYWORDS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|ON|GROUP BY|ORDER BY|HAVING|AS|AND|OR|IN|COUNT|SUM|AVG|MIN|MAX|NVL|ROUND|DISTINCT|START WITH|CONNECT BY|PRIOR|LEVEL|FETCH FIRST|ROWS ONLY|DESC|LPAD|SYS_CONNECT_BY_PATH|TO_CHAR|CASE|WHEN|THEN|ELSE|END|IS NULL)\b/g;

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

const FLOW = ['User search', 'Live web search', 'Page extraction', 'Rule matching', 'Oracle', 'PL/SQL', 'AfwaahTracker'];

const RELATIONSHIP_EXAMPLES = [
  ['SOURCES → SOURCES', 'derived_from_source_id: a source points at its known upstream source (self-referencing FK).'],
  ['CLAIM_VARIANTS → CLAIM_VARIANTS', 'parent_variant_id: the wording a variant is compared against in the Mutation Ledger.'],
  ['SOURCE_REFERENCES', 'Explicit evidence (hyperlink, submitted link, canonical, manual) between two stored sources.'],
  ['SEARCH_RESULT_LINKS', 'M:N between WEB_SEARCH_RUNS and SOURCES, with the search rank and snippet.'],
  ['CLAIM_ENTITIES · CLAIM_KEYWORDS', 'M:N junctions that give each claim family its entities and keywords.'],
];

function Examples({ queries }) {
  const [key, setKey] = useState(queries[0]?.key);
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const q = queries.find((x) => x.key === key) || queries[0];
  const select = (k) => {
    setKey(k);
    setState({ loading: false, data: null, error: null });
  };
  const run = async () => {
    setState({ loading: true, data: null, error: null });
    try {
      setState({ loading: false, data: await api.labQuery(q.key), error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  };
  if (!q) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" role="tablist" aria-label="Example queries">
        {queries.map((x) => (
          <li key={x.key} className="shrink-0">
            <button
              type="button"
              role="tab"
              aria-selected={x.key === q.key}
              onClick={() => select(x.key)}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-[14px] font-semibold transition-colors ${x.key === q.key ? 'border-[#b9d2ec] bg-tint text-deep' : 'border-line bg-white text-ink-2 hover:bg-tint/60'}`}
            >
              {x.title}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0" role="tabpanel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="system-label">{q.concept}</div>
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
      </div>
    </div>
  );
}

function RunStatus({ status }) {
  const tone = { SUCCESS: 'green', PARTIAL: 'amber', FAILED: 'red', RUNNING: 'electric' }[status] || 'muted';
  return <Badge tone={tone}>{(status || 'never run').toLowerCase()}</Badge>;
}

function Monitoring() {
  const { refresh, refreshing } = useRefresh();
  const [showFeeds, setShowFeeds] = useState(false);
  const status = useApi((signal) => api.ingestionStatus({ signal }), []);
  const s = status.data?.summary;
  return (
    <Card>
      <CardHeader
        label="Background mode · GDELT · Hacker News · RSS/Atom"
        title="Background monitoring"
        icon={Rss}
        action={(
          <button type="button" onClick={refresh} disabled={refreshing} className="btn btn-ghost btn-sm">
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Syncing…' : 'Sync feeds'}
          </button>
        )}
      />
      {status.error ? <ErrorState compact error={status.error} onRetry={status.reload} />
        : !s ? <LoadingBlock rows={4} />
          : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ['Last sync', timeAgo(s.last_sync)],
                  ['New · 24 h', s.new_sources_24h],
                  ['Duplicates · 24 h', s.skipped_24h],
                  ['Failed feeds', status.data.sources.filter((f) => f.last_status === 'FAILED').length],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="meta-label">{label}</dt>
                    <dd className="mt-1 text-[1.4rem] font-extrabold leading-none text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5">
                <div className="meta-label mb-1">New sources per day · last 14 days</div>
                <IngestionChart data={status.data.activity} />
              </div>
              <button type="button" className="btn btn-ghost btn-sm mt-4" onClick={() => setShowFeeds((v) => !v)} aria-expanded={showFeeds}>
                {showFeeds ? 'Hide feeds' : `Show ${status.data.sources.length} feeds`}
              </button>
              {showFeeds && (
              <div className="-mx-2 mt-4 overflow-x-auto px-2">
                <table className="data-table min-w-[620px] text-[14px]">
                  <thead><tr><th>Feed</th><th>Type</th><th>Last run</th><th>Status</th><th>New</th></tr></thead>
                  <tbody>
                    {status.data.sources.map((f) => (
                      <tr key={f.ingestion_source_id} className={f.enabled === 'N' ? 'opacity-55' : ''}>
                        <td>
                          <div className="font-semibold text-ink">{f.source_name}</div>
                          {f.last_error && <div className="text-[12.5px] text-danger">{truncate(f.last_error, 90)}</div>}
                        </td>
                        <td className="whitespace-nowrap text-ink-2">{SOURCE_TYPE_LABEL[f.source_type]}</td>
                        <td className="whitespace-nowrap text-ink-2">{f.enabled === 'N' ? 'Disabled' : f.last_completed_at ? timeAgo(f.last_completed_at) : '—'}</td>
                        <td><RunStatus status={f.last_status} /></td>
                        <td className="font-bold text-primary">{f.last_inserted ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}
    </Card>
  );
}

export default function DatabaseLabPage() {
  const { data, error, reload } = useApi((signal) => api.lab({ signal }), []);
  const count = (type) => data?.objects.find((o) => o.object_type === type)?.total ?? '—';
  const fkCount = data?.constraints.find((c) => c.constraint_type === 'FOREIGN KEY')?.total ?? '—';
  const rows = (t) => data?.tables.find((x) => x.table_name === t)?.rows ?? '—';

  const strip = [
    // e.g. "Oracle AI Database 26ai Free Release 23.26..." -> "26ai Free"
    ['Oracle database', data ? (/(\d+[a-z]+\s+(Free|Express Edition|Enterprise Edition))/i.exec(data.database)?.[1] || 'Oracle') : '—'],
    ['Tables', count('TABLE')],
    ['Relationships', fkCount],
    ['Views', count('VIEW')],
    ['PL/SQL', data ? Number(count('PROCEDURE')) + Number(count('FUNCTION')) : '—'],
    ['Triggers', count('TRIGGER')],
    ['Indexes', count('INDEX')],
    ['Transactions', '1 per result'],
    ['Web search runs', formatNumber(rows('WEB_SEARCH_RUNS'))],
  ];

  return (
    <div className="relative">
      <Watermark word="DATABASE" style={{ top: -30, right: -60 }} />
      <PageHeader label="Database lab" title="Oracle does the analysis." subtitle="React displays. Express orchestrates. Oracle stores and analyses — integrity, Echo Ratio, lineage and the Mutation Ledger all run in SQL and PL/SQL." />

      {error && <div className="relative z-10 mb-6"><ErrorState error={error} onRetry={reload} /></div>}

      <div className="relative z-10 space-y-6">
        <div className="card grid grid-cols-2 gap-px overflow-hidden bg-line p-0 sm:grid-cols-3 lg:grid-cols-9">
          {strip.map(([label, value]) => (
            <div key={label} className="min-w-0 bg-card p-4">
              <div className="meta-label">{label}</div>
              <div className={`mt-1.5 font-extrabold leading-tight text-ink ${String(value).length > 6 ? 'text-[15px]' : 'text-[1.6rem]'}`}>{data ? value : '…'}</div>
            </div>
          ))}
        </div>

        <Card>
          <CardHeader label="Request flow" title="Architecture" icon={Workflow} />
          <ol className="flex flex-wrap items-center gap-2">
            {FLOW.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className={`rounded-full px-3.5 py-2 text-[12.5px] font-extrabold uppercase tracking-[0.06em] ${step === 'Oracle' || step === 'PL/SQL' ? 'bg-navy text-white' : 'bg-tint text-deep'}`}>{step}</span>
                {i < FLOW.length - 1 && <ArrowRight size={16} className="text-muted" aria-hidden="true" />}
              </li>
            ))}
          </ol>
          <div className="mt-5 grid gap-3 text-[14.5px] text-ink-2 sm:grid-cols-3">
            <p><b className="text-ink">React</b> displays results and never sees credentials or the search API key.</p>
            <p><b className="text-ink">Express</b> orchestrates the search, page fetching and rule-based matching.</p>
            <p><b className="text-ink">Oracle</b> stores every source and computes lineage, Echo Ratio and the Mutation Ledger.</p>
          </div>
        </Card>

        <Card>
          <CardHeader label="Relational model" title="Entity–relationship diagram" subtitle={`${count('TABLE')} tables joined by ${fkCount} foreign keys.`} icon={GitMerge} />
          <ERDiagram />
          <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {RELATIONSHIP_EXAMPLES.map(([name, text]) => (
              <li key={name} className="rounded-xl border border-line bg-white p-4">
                <div className="font-mono text-[12.5px] font-bold text-deep">{name}</div>
                <p className="mt-1 text-[14px] text-ink-2">{text}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader label="Read-only · fixed whitelist" title="Example SQL" subtitle="These queries run against the live schema. Arbitrary SQL cannot be executed from the browser." />
          {data ? <Examples queries={data.queries} /> : <LoadingBlock rows={6} />}
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader label="WEB_SEARCH_RUNS" title="Recent web search runs" icon={Globe} />
            {!data ? <LoadingBlock rows={4} /> : data.webRuns.length ? (
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="data-table min-w-[520px] text-[14px] [&_td]:px-3 [&_th]:px-3">
                  <thead><tr><th>Query</th><th>Status</th><th>Results</th><th>New</th><th>Families</th></tr></thead>
                  <tbody>
                    {data.webRuns.map((r) => (
                      <tr key={r.search_run_id}>
                        <td>
                          <div className="font-semibold text-ink">{truncate(r.query_text, 50)}</div>
                          <div className="text-[12.5px] text-muted">{timeAgo(r.started_at)}{r.pages_failed ? ` · ${r.pages_failed} pages unavailable` : ''}</div>
                        </td>
                        <td><RunStatus status={r.status} /></td>
                        <td>{r.results_received}</td>
                        <td className="font-bold text-primary">{r.sources_inserted}</td>
                        <td>{r.claim_families}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-[14.5px] text-ink-2">No web search runs yet.</p>}
          </Card>
          <Monitoring />
        </div>
      </div>
    </div>
  );
}
