/**
 * Entity-relationship diagram of the 19-table AfwaahTracker schema (hand-laid-out SVG).
 * Lines join a child table (dot = "many" side) to its parent (bar = "one" side).
 */
const W = 210;
const H = 62;
const COL = [20, 265, 510, 755, 1000];
const ROW = [20, 170, 320, 470, 620];

const TABLES = {
  INGESTION_LOG: { c: 0, r: 0, pk: 'log_id', kind: 'ingest' },
  INGESTION_SOURCES: { c: 1, r: 0, pk: 'ingestion_source_id', kind: 'ingest' },
  PLATFORMS: { c: 2, r: 0, pk: 'platform_id', kind: 'lookup' },
  WEB_SEARCH_RUNS: { c: 3, r: 0, pk: 'search_run_id', kind: 'web' },
  SOURCE_REFERENCES: { c: 1, r: 1, pk: 'reference_id', kind: 'web' },
  SOURCES: { c: 2, r: 1, pk: 'source_id', kind: 'core' },
  SEARCH_RESULT_LINKS: { c: 3, r: 1, pk: '(search_run_id, source_id)', kind: 'junction' },
  CATEGORIES: { c: 4, r: 1, pk: 'category_id', kind: 'lookup' },
  ENTITY_CANDIDATES: { c: 1, r: 2, pk: 'candidate_id', kind: 'ingest' },
  CLAIM_VARIANTS: { c: 2, r: 2, pk: 'variant_id', kind: 'core' },
  CLAIMS: { c: 3, r: 2, pk: 'claim_id', kind: 'core' },
  FINGERPRINTS: { c: 4, r: 2, pk: 'fingerprint_id', kind: 'core' },
  CLAIM_MUTATIONS: { c: 2, r: 3, pk: 'mutation_id', kind: 'core' },
  CLAIM_ENTITIES: { c: 3, r: 3, pk: '(claim_id, entity_id)', kind: 'junction' },
  CLAIM_KEYWORDS: { c: 4, r: 3, pk: '(claim_id, keyword_id)', kind: 'junction' },
  AUDIT_LOG: { c: 0, r: 4, pk: 'audit_id', kind: 'system' },
  ENTITY_ALIASES: { c: 2, r: 4, pk: 'alias_id', kind: 'lookup' },
  ENTITIES: { c: 3, r: 4, pk: 'entity_id', kind: 'lookup' },
  KEYWORDS: { c: 4, r: 4, pk: 'keyword_id', kind: 'lookup' },
};

const RELATIONS = [
  ['INGESTION_LOG', 'INGESTION_SOURCES'],
  ['INGESTION_SOURCES', 'PLATFORMS'],
  ['INGESTION_SOURCES', 'CATEGORIES'],
  ['SOURCES', 'PLATFORMS'],
  ['SOURCES', 'INGESTION_SOURCES'],
  ['SOURCE_REFERENCES', 'SOURCES'],
  ['SEARCH_RESULT_LINKS', 'SOURCES'],
  ['SEARCH_RESULT_LINKS', 'WEB_SEARCH_RUNS'],
  ['CLAIM_VARIANTS', 'SOURCES'],
  ['CLAIM_VARIANTS', 'CLAIMS'],
  ['CLAIMS', 'CATEGORIES'],
  ['FINGERPRINTS', 'CLAIMS'],
  ['CLAIM_MUTATIONS', 'CLAIM_VARIANTS'],
  ['CLAIM_MUTATIONS', 'CLAIMS'],
  ['CLAIM_ENTITIES', 'CLAIMS'],
  ['CLAIM_ENTITIES', 'ENTITIES'],
  ['CLAIM_KEYWORDS', 'CLAIMS'],
  ['CLAIM_KEYWORDS', 'KEYWORDS'],
  ['ENTITY_ALIASES', 'ENTITIES'],
  ['ENTITY_CANDIDATES', 'SOURCES'],
];

const FILL = {
  core: ['#ffffff', '#4F8FD8'],
  lookup: ['#ffffff', '#8B98A8'],
  junction: ['#eef4fb', '#68A8FF'],
  ingest: ['#ffffff', '#2FA4C7'],
  web: ['#ffffff', '#E8A23A'],
  system: ['#ffffff', '#8B98A8'],
};

const box = (name) => {
  const t = TABLES[name];
  return { x: COL[t.c], y: ROW[t.r], cx: COL[t.c] + W / 2, cy: ROW[t.r] + H / 2 };
};

/** Point where the segment from the box centre towards (tx, ty) leaves the box. */
function edgePoint(b, tx, ty) {
  const dx = tx - b.cx;
  const dy = ty - b.cy;
  const sx = dx === 0 ? Infinity : (W / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (H / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: b.cx + dx * s, y: b.cy + dy * s };
}

export default function ERDiagram() {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-[#f6f9fc] p-3">
      <svg viewBox="0 0 1230 700" className="min-w-[900px]" role="img" aria-label="Entity relationship diagram of the 19 AfwaahTracker tables">
        <defs>
          <pattern id="erGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#dbe4ee" />
          </pattern>
        </defs>
        <rect width="1230" height="700" fill="url(#erGrid)" />

        {RELATIONS.map(([child, parent]) => {
          const a = box(child);
          const b = box(parent);
          const p1 = edgePoint(a, b.cx, b.cy);
          const p2 = edgePoint(b, a.cx, a.cy);
          const ang = Math.atan2(p1.y - p2.y, p1.x - p2.x);
          const bar = { x: p2.x + Math.cos(ang) * 9, y: p2.y + Math.sin(ang) * 9 };
          const nx = -Math.sin(ang) * 6;
          const ny = Math.cos(ang) * 6;
          return (
            <g key={`${child}-${parent}`}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#9fb3c7" strokeWidth="1.6" />
              <circle cx={p1.x} cy={p1.y} r="4.2" fill="#4F8FD8" />
              <line x1={bar.x + nx} y1={bar.y + ny} x2={bar.x - nx} y2={bar.y - ny} stroke="#617080" strokeWidth="2" />
            </g>
          );
        })}

        {/* self-referencing relationships */}
        {['SOURCES', 'CLAIM_VARIANTS'].map((name) => {
          const b = box(name);
          return (
            <g key={`self-${name}`}>
              <path d={`M ${b.x + 140} ${b.y} C ${b.x + 140} ${b.y - 40}, ${b.x + 198} ${b.y - 40}, ${b.x + 198} ${b.y}`} fill="none" stroke="#E8A23A" strokeWidth="1.8" strokeDasharray="5 4" />
              <circle cx={b.x + 140} cy={b.y} r="4.2" fill="#E8A23A" />
              <text x={b.x + 169} y={b.y - 34} textAnchor="middle" fontSize="11" fontWeight="700" fill="#a8761a">
                {name === 'SOURCES' ? 'derived_from' : 'parent_variant'}
              </text>
            </g>
          );
        })}

        {Object.entries(TABLES).map(([name, t]) => {
          const b = box(name);
          const [fill, accent] = FILL[t.kind];
          return (
            <g key={name}>
              <rect x={b.x} y={b.y} width={W} height={H} rx="10" fill={fill} stroke="#cfdbe7" strokeWidth="1.2" />
              <rect x={b.x} y={b.y} width="5" height={H} rx="2.5" fill={accent} />
              <text x={b.x + 16} y={b.y + 25} fontSize="13.5" fontWeight="800" fill="#253947" letterSpacing="0.03em">{name}</text>
              <text x={b.x + 16} y={b.y + 45} fontSize="11.5" fontWeight="600" fill="#617080">PK {t.pk}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 px-1 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> many side (FK)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-ink-2" /> one side (PK)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-warning" /> self-referencing FK</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 rounded bg-primary" /> core</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 rounded bg-bright" /> M:N junction</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 rounded bg-[#2FA4C7]" /> feeds</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 rounded bg-warning" /> live web search</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 rounded bg-muted" /> lookup / system</span>
      </div>
    </div>
  );
}
