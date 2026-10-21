import { memo, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { formatDate, truncate } from '../../utils/format.js';
import { LINEAGE_BASIS_LABEL } from '../../utils/labels.js';

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
  // Oldest first; sources without a known date go last
  const time = (id) => {
    const t = new Date(byId.get(id)?.published_at).getTime();
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  const order = (ids) => [...ids].sort((a, b) => time(a) - time(b));
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
        {origin && <span className="shrink-0 rounded-full bg-[#e3eefb] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.07em] text-deep">{data.rootLabel}</span>}
      </div>
      <div className="mt-0.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">
        {data.platform} · {data.date ? formatDate(data.date) : 'Date not determined'}
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
export default function LineageGraph({ kind, nodes: allNodes = [], edges = [], onSelect, demo = false }) {
  const idKey = kind === 'claim' ? 'variant_id' : 'source_id';
  // Only nodes that take part in a link are drawn; unlinked ones are summarised below
  const nodes = useMemo(() => {
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    return allNodes.filter((n) => linked.has(n[idKey]));
  }, [allNodes, edges, idKey]);
  const unlinked = allNodes.length - nodes.length;
  const [selected, setSelected] = useState(null);

  const flow = useMemo(() => {
    const pos = layout(nodes, edges, idKey);
    const parentKey = kind === 'claim' ? 'parent_variant_id' : 'derived_from_source_id';
    const ids = new Set(nodes.map((n) => n[idKey]));
    const rfNodes = nodes.map((n) => {
      const id = n[idKey];
      const isOrigin = !n[parentKey] || !ids.has(n[parentKey]);
      let tag = null;
      if (kind === 'claim') {
        const changes = n.mutation_count ? `${n.mutation_count} change${n.mutation_count > 1 ? 's' : ''}` : 'no structured change';
        tag = isOrigin ? (demo ? 'Root wording' : 'No known parent wording') : `${LINEAGE_BASIS_LABEL[n.lineage_basis] || 'Parent'} · ${changes}`;
      } else {
        tag = n.in_claim === 'N' ? 'Upstream source' : n.child_count ? `${n.child_count} ${demo ? 'derived' : 'known derived'}` : null;
      }
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
          rootLabel: demo ? 'Origin' : kind === 'claim' ? 'No parent' : 'No known upstream',
          dimmed: kind === 'source' && n.in_claim === 'N',
          tag,
          raw: n,
        },
      };
    });
    const basisOf = new Map(nodes.map((n) => [n[idKey], n.lineage_basis]));
    const rfEdges = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => {
        // An inferred (lexical) predecessor is drawn dashed: it is not explicit evidence
        const inferred = kind === 'claim' && ['LEXICAL_PREDECESSOR', 'PROPOSITION_PREDECESSOR'].includes(basisOf.get(e.target));
        return {
          id: `${e.source}-${e.target}`,
          source: String(e.source),
          target: String(e.target),
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#9fb3c7', width: 18, height: 18 },
          style: { stroke: inferred ? '#b4c4d4' : '#8ea7c0', strokeWidth: 1.6, strokeDasharray: inferred ? '6 5' : undefined },
        };
      });
    return { rfNodes, rfEdges };
  }, [nodes, edges, idKey, kind, selected, demo]);

  const depth = Math.max(1, ...flow.rfNodes.map((n) => n.position.y / (NODE_H + GAP_Y) + 1));
  const height = Math.min(620, Math.max(320, depth * (NODE_H + GAP_Y) + 60));

  return (
    <>
    <div className="overflow-hidden rounded-xl border border-line bg-[#f4f8fc]" style={{ height, width: '100%' }}>
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
    {unlinked > 0 && (
      <p className="mt-2 text-[13px] text-muted">
        {unlinked} {kind === 'claim' ? 'variant' : 'source'}{unlinked > 1 ? 's' : ''} without a known {kind === 'claim' ? 'parent or child wording' : 'upstream or derived source'} {unlinked > 1 ? 'are' : 'is'} not drawn.
      </p>
    )}
    </>
  );
}
