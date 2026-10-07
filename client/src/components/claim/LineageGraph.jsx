import { memo, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { formatDate, truncate } from '../../utils/format.js';

const NODE_W = 230;
const NODE_H = 128;
const GAP_X = 36;
const GAP_Y = 64;

/**
 * Simple tidy-tree layout: leaves are placed left to right, each parent is
 * centred over its children. Works for forests (several independent roots).
 */
function layout(nodes, edges, idKey) {
  const children = new Map();
  const hasParent = new Set();
  edges.forEach((e) => {
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source).push(e.target);
    hasParent.add(e.target);
  });
  const byId = new Map(nodes.map((n) => [n[idKey], n]));
  const order = (ids) => [...ids].sort((a, b) => new Date(byId.get(a)?.published_at) - new Date(byId.get(b)?.published_at));
  const roots = order(nodes.map((n) => n[idKey]).filter((id) => !hasParent.has(id)));

  const pos = new Map();
  let cursor = 0;
  const visit = (id, depth, seen) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = order((children.get(id) || []).filter((k) => byId.has(k)));
    let x;
    if (!kids.length) {
      x = cursor;
      cursor += NODE_W + GAP_X;
    } else {
      const xs = kids.map((k) => visit(k, depth + 1, seen));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    pos.set(id, { x, y: depth * (NODE_H + GAP_Y) });
    return x;
  };
  const seen = new Set();
  roots.forEach((r) => visit(r, 0, seen));
  nodes.forEach((n) => {
    if (!pos.has(n[idKey])) visit(n[idKey], 0, seen);
  });
  return pos;
}

const LineageNode = memo(({ data, selected }) => {
  const origin = data.isOrigin;
  return (
    <div
      className="relative overflow-hidden rounded-xl bg-white py-3 pl-4 pr-3.5 text-left transition-shadow duration-200"
      style={{
        width: NODE_W,
        minHeight: NODE_H - 12,
        border: selected ? '2px solid #4F8FD8' : '1px solid #d3dee9',
        boxShadow: selected ? '0 10px 22px rgba(79,143,216,.25)' : '0 4px 12px rgba(35,55,75,.10)',
        opacity: data.dimmed ? 0.62 : 1,
      }}
    >
      {origin && <span className="absolute inset-y-0 left-0 w-[5px] bg-primary" aria-hidden="true" />}
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13.5px] font-extrabold text-ink" title={data.publisher}>{data.publisher}</span>
        {origin && <span className="shrink-0 rounded-full bg-[#e3eefb] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.07em] text-deep">Origin</span>}
      </div>
      <div className="mt-0.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">
        {data.platform} · {formatDate(data.date)}
      </div>
      <div className="mt-1.5 text-[13px] leading-snug text-ink-2">“{truncate(data.text, 78)}”</div>
      {data.tag && <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-primary">{data.tag}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
LineageNode.displayName = 'LineageNode';

const nodeTypes = { lineage: LineageNode };

/**
 * kind = 'claim'  -> nodes are variants   (CLAIM_VARIANTS.parent_variant_id)
 * kind = 'source' -> nodes are sources    (SOURCES.derived_from_source_id)
 */
export default function LineageGraph({ kind, nodes = [], edges = [], onSelect }) {
  const idKey = kind === 'claim' ? 'variant_id' : 'source_id';
  const [selected, setSelected] = useState(null);

  const flow = useMemo(() => {
    const pos = layout(nodes, edges, idKey);
    const parentKey = kind === 'claim' ? 'parent_variant_id' : 'derived_from_source_id';
    const ids = new Set(nodes.map((n) => n[idKey]));
    const rfNodes = nodes.map((n) => {
      const id = n[idKey];
      const isOrigin = !n[parentKey] || !ids.has(n[parentKey]);
      let tag = null;
      if (kind === 'claim') tag = n.mutation_count ? `${n.mutation_count} change${n.mutation_count > 1 ? 's' : ''} from parent` : isOrigin ? 'Root wording' : 'No structured change';
      else tag = n.in_claim === 'N' ? 'Upstream source' : n.child_count ? `${n.child_count} derived` : null;
      return {
        id: String(id),
        type: 'lineage',
        position: pos.get(id) || { x: 0, y: 0 },
        selected: selected === String(id),
        data: {
          publisher: n.publisher,
          platform: n.platform_name,
          date: n.published_at,
          text: kind === 'claim' ? n.variant_text : n.source_title,
          isOrigin,
          dimmed: kind === 'source' && n.in_claim === 'N',
          tag,
          raw: n,
        },
      };
    });
    const rfEdges = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: `${e.source}-${e.target}`,
        source: String(e.source),
        target: String(e.target),
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9fb3c7', width: 18, height: 18 },
        style: { stroke: '#9fb3c7', strokeWidth: 1.6 },
      }));
    return { rfNodes, rfEdges };
  }, [nodes, edges, idKey, kind, selected]);

  const depth = Math.max(1, ...flow.rfNodes.map((n) => n.position.y / (NODE_H + GAP_Y) + 1));
  const height = Math.min(620, Math.max(320, depth * (NODE_H + GAP_Y) + 60));

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#f4f8fc]" style={{ height }}>
      <ReactFlow
        nodes={flow.rfNodes}
        edges={flow.rfEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.62 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={false}
        zoomOnScroll={false}
        preventScrolling={false}
        onNodeClick={(_, node) => {
          setSelected(node.id);
          onSelect?.(node.data.raw);
        }}
        onPaneClick={() => {
          setSelected(null);
          onSelect?.(null);
        }}
      >
        <Background color="#d5e1ec" gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
