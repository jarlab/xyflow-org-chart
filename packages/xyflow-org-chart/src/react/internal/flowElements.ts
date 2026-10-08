import type { CSSProperties } from 'react';
import type { OrgHierarchy, VisibleEntry } from '../../core/hierarchy';
import type { OrgChartFlowEdge, OrgChartFlowNode, OrgChartNodeData } from '../types';
import type { LayoutBundle } from './layoutBundle';
import { sameNodeData } from './equality';

export interface FlowElementsConfig {
  nodeType: string;
  pagingNodeType: string;
  edgeType: string;
  linkYOffset: number;
  /** Fixed mode: set node.width/height so React Flow's `measured` equals the layout size on first paint. */
  fixedSize: boolean;
  /** Measure mode: nodes not laid out with their measured size are hidden. */
  measure: boolean;
  /** paging.step, or null when paging is off. */
  pagingStep: number | null;
}

export interface FlowElements<T> {
  /** Target nodes, breadth-first; positions are the layout's top-left corners. */
  nodes: OrgChartFlowNode<T>[];
  edges: OrgChartFlowEdge[];
}

/** Style marking a node that must stay invisible until a layout used its measured size. */
export const UNREVEALED_STYLE: Readonly<CSSProperties> = Object.freeze({ visibility: 'hidden' });

export function isUnrevealed(node: { style?: CSSProperties }): boolean {
  return node.style?.visibility === 'hidden';
}

/** Converts a layout into React Flow nodes/edges (layout-algorithm.md §10.3, §10.5). */
export function buildFlowElements<T>(
  bundle: LayoutBundle,
  hierarchy: OrgHierarchy<T>,
  visible: readonly VisibleEntry[],
  expandedIds: ReadonlySet<string>,
  config: FlowElementsConfig,
): FlowElements<T> {
  const { layout, input } = bundle;
  const orientation = layout.options.orientation;
  const entries = new Map<string, VisibleEntry>();
  for (const e of visible) entries.set(e.id, e);

  const hidden = new Set<string>();
  const nodes = layout.nodes.map((ln): OrgChartFlowNode<T> => {
    const entry = entries.get(ln.id);
    const paging = entry?.kind === 'paging';
    const h = paging ? undefined : hierarchy.nodes.get(ln.id);
    const hasChildren = !!h && h.childIds.length > 0;
    const hiddenCount = paging ? (entry.hiddenCount ?? 0) : 0;
    const data: OrgChartNodeData<T> = {
      kind: paging ? 'paging' : 'node',
      item: h?.item,
      orientation,
      depth: ln.depth,
      parentId: ln.parentId,
      width: ln.width,
      height: ln.height,
      hasChildren,
      expanded: hasChildren && expandedIds.has(ln.id),
      directReports: h ? h.childIds.length : 0,
      totalReports: h ? h.descendantCount : 0,
      hiddenCount,
      compact: ln.compact,
    };
    if (paging) data.nextPageCount = config.pagingStep === null ? hiddenCount : Math.min(hiddenCount, config.pagingStep);
    const node: OrgChartFlowNode<T> = {
      id: ln.id,
      type: paging ? config.pagingNodeType : config.nodeType,
      position: ln.position,
      data,
    };
    if (config.fixedSize) {
      node.width = ln.width;
      node.height = ln.height;
    }
    if (config.measure && !input.measuredIds.has(ln.id)) {
      node.style = UNREVEALED_STYLE;
      hidden.add(ln.id);
    }
    return node;
  });

  const edges: OrgChartFlowEdge[] = [];
  for (const e of layout.edges) {
    // d3-org-chart hides the link to a paging button (layout-algorithm.md §7.5).
    if (entries.get(e.target)?.kind === 'paging') continue;
    const edge: OrgChartFlowEdge = {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: config.edgeType,
      selectable: false,
      focusable: false,
      data: {
        orientation,
        linkYOffset: config.linkYOffset,
        spineFromTarget: e.spineTop
          ? { dx: e.spineTop.x - e.targetPoint.x, dy: e.spineTop.y - e.targetPoint.y }
          : null,
      },
    };
    if (hidden.has(e.source) || hidden.has(e.target)) edge.hidden = true;
    edges.push(edge);
  }
  return { nodes, edges };
}

function sameEdge(a: OrgChartFlowEdge, b: OrgChartFlowEdge): boolean {
  if (
    a.id !== b.id ||
    a.source !== b.source ||
    a.target !== b.target ||
    a.sourceHandle !== b.sourceHandle ||
    a.targetHandle !== b.targetHandle ||
    a.type !== b.type ||
    a.hidden !== b.hidden
  ) {
    return false;
  }
  const da = a.data!;
  const db = b.data!;
  const sa = da.spineFromTarget;
  const sb = db.spineFromTarget;
  return (
    da.orientation === db.orientation &&
    da.linkYOffset === db.linkYOffset &&
    (sa === sb || (!!sa && !!sb && sa.dx === sb.dx && sa.dy === sb.dy))
  );
}

function sameTargetNode<T>(a: OrgChartFlowNode<T>, b: OrgChartFlowNode<T>): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.style === b.style &&
    sameNodeData(a.data, b.data)
  );
}

/** Structural equality of two buildFlowElements results. */
export function sameElements<T>(a: FlowElements<T>, b: FlowElements<T>): boolean {
  if (a === b) return true;
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  for (let i = 0; i < a.nodes.length; i++) if (!sameTargetNode(a.nodes[i], b.nodes[i])) return false;
  for (let i = 0; i < a.edges.length; i++) if (!sameEdge(a.edges[i], b.edges[i])) return false;
  return true;
}
