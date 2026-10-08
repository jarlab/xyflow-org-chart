import { DEFAULT_LAYOUT_OPTIONS } from '../types';
import type {
  Bounds,
  CompactCellInfo,
  LayoutEdge,
  LayoutInputNode,
  LayoutNode,
  OrgChartLayout,
  OrgChartLayoutOptions,
  Orientation,
  Point,
  SourceHandleId,
  TargetHandleId,
} from '../types';
import { compactPostPass, compactPrePass, type CompactNode } from './compact';
import { flextree } from './flextree';
import { buildTree, inputParentId } from './tree';

interface Node extends CompactNode {
  id: string;
  parentId: string | null;
  parent: Node | null;
  children: Node[];
  depth: number;
  width: number;
  height: number;
  /** Post-swap anchor. */
  x: number;
  y: number;
}

/**
 * Lays out the visible tree exactly like d3-org-chart 3.1.1:
 * per-node flex boxes with margins baked in → (compact pre-pass) → van der Ploeg flextree →
 * (compact post-pass) → orientation swap. See docs/d3-org-chart/layout-algorithm.md.
 *
 * Pure and stateless. Throws OrgChartDataError on malformed input (no/multiple roots, missing
 * parent, duplicate id, cycle, empty).
 */
export function layoutOrgChart(
  nodes: readonly LayoutInputNode[],
  options?: Partial<OrgChartLayoutOptions>,
): OrgChartLayout {
  const o = resolveOptions(options);
  const horizontal = o.orientation === 'left' || o.orientation === 'right';

  const { root, bfs } = buildTree<LayoutInputNode, Node>(
    nodes,
    (n) => n.id,
    inputParentId,
    (n, id, parentId) => ({
      id,
      parentId,
      parent: null,
      children: [],
      depth: 0,
      width: n.width,
      height: n.height,
      // compactDimension (§6): (sizeColumn, sizeRow) = (w, h) in top/bottom, (h, w) in left/right.
      breadth: horizontal ? n.height : n.width,
      depthSize: horizontal ? n.width : n.height,
      cx: 0,
      cy: 0,
      x: 0,
      y: 0,
      compactIndex: -1,
      compactEven: null,
      row: null,
      firstCompactNode: null,
      flexCompactDim: null,
    }),
  );
  for (const n of bfs) {
    for (const c of n.children) {
      c.parent = n;
      c.depth = n.depth + 1;
    }
  }

  const margins = { pair: o.compactMarginPair, between: o.compactMarginBetween };
  if (o.compact) compactPrePass(bfs, margins);
  const placed = flextree<Node>(root, {
    children: (n) => n.children,
    // nodeFlexSize (§4.1): the compact block verbatim, else the card plus its margins.
    nodeSize: (n) =>
      o.compact && n.flexCompactDim
        ? n.flexCompactDim
        : [n.breadth + o.siblingsMargin, n.depthSize + o.childrenMargin],
    spacing: (a, b) => (a.parent === b.parent ? 0 : o.neighbourMargin),
  });
  for (const n of bfs) {
    const p = placed.get(n) as Point;
    n.cx = p.x;
    n.cy = p.y;
  }
  if (o.compact) compactPostPass(bfs, margins);
  for (const n of bfs) swap(n, o.orientation);

  const layoutNodes: LayoutNode[] = bfs.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    depth: n.depth,
    width: n.width,
    height: n.height,
    x: n.x,
    y: n.y,
    position: topLeft(n, o.orientation),
    childIds: n.children.map((c) => c.id),
    compact: compactInfo(n, o.compactMarginPair),
  }));
  const nodeById = new Map(layoutNodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = [];
  for (const n of bfs) if (n.parent) edges.push(edgeFor(n, n.parent, o));

  return { options: o, nodes: layoutNodes, nodeById, edges, bounds: boundsOf(layoutNodes) };
}

function resolveOptions(options: Partial<OrgChartLayoutOptions> | undefined): OrgChartLayoutOptions {
  const o: OrgChartLayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS };
  if (options) {
    for (const key of Object.keys(options) as (keyof OrgChartLayoutOptions)[]) {
      const v = options[key];
      if (v !== undefined) (o as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return o;
}

/** d3-org-chart's layoutBindings[layout].swap (§6). `+ 0` turns -0 into 0 and changes nothing else. */
function swap(n: Node, orientation: Orientation): void {
  switch (orientation) {
    case 'top':
      n.x = n.cx;
      n.y = n.cy;
      break;
    case 'bottom':
      n.x = n.cx;
      n.y = -n.cy + 0;
      break;
    case 'left':
      n.x = n.cy;
      n.y = n.cx;
      break;
    case 'right':
      n.x = -n.cy + 0;
      n.y = n.cx;
      break;
  }
}

/** nodeUpdateTransform (§6): the card's top-left corner. */
function topLeft(n: Node, orientation: Orientation): Point {
  switch (orientation) {
    case 'top':
      return { x: n.x - n.width / 2, y: n.y };
    case 'bottom':
      return { x: n.x - n.width / 2, y: n.y - n.height };
    case 'left':
      return { x: n.x, y: n.y - n.height / 2 };
    case 'right':
      return { x: n.x - n.width, y: n.y - n.height / 2 };
  }
}

function compactInfo(n: Node, pair: number): CompactCellInfo | null {
  const first = n.firstCompactNode as Node | null;
  if (!n.flexCompactDim || !first) return null;
  const firstDim = first.flexCompactDim as [number, number];
  return {
    index: n.compactIndex,
    even: n.compactEven as boolean,
    row: n.row as number,
    firstCellId: first.id,
    flexCompactDim: [n.flexCompactDim[0], n.flexCompactDim[1]],
    columnSize: (firstDim[0] - pair) / 2,
    rowOffset: n.cy - first.cy,
  };
}

const SOURCE_HANDLE: Record<Orientation, SourceHandleId> = {
  top: 's-bottom',
  bottom: 's-top',
  left: 's-right',
  right: 's-left',
};
const TARGET_HANDLE: Record<Orientation, TargetHandleId> = {
  top: 't-top',
  bottom: 't-bottom',
  left: 't-left',
  right: 't-right',
};
/** Compact cells enter from the side facing the spine (§10.5): [even, odd]. */
const COMPACT_TARGET_HANDLE: Record<Orientation, [TargetHandleId, TargetHandleId]> = {
  top: ['t-right', 't-left'],
  bottom: ['t-right', 't-left'],
  left: ['t-bottom', 't-top'],
  right: ['t-bottom', 't-top'],
};

/** Edge anchors per layout-algorithm.md §7.1 (d3-org-chart.js layoutBindings :302-452, update :923-947). */
function edgeFor(c: Node, p: Node, o: OrgChartLayoutOptions): LayoutEdge {
  const orientation = o.orientation;
  const compact = o.compact && c.flexCompactDim !== null;
  let sourcePoint: Point;
  switch (orientation) {
    case 'top':
      sourcePoint = { x: p.x, y: p.y + p.height };
      break;
    case 'bottom':
      sourcePoint = { x: p.x, y: p.y - p.height };
      break;
    case 'left':
      sourcePoint = { x: p.x + p.width, y: p.y };
      break;
    case 'right':
      sourcePoint = { x: p.x - p.width, y: p.y };
      break;
  }
  let targetPoint: Point = { x: c.x, y: c.y };
  let spineTop: Point | null = null;
  let targetHandle = TARGET_HANDLE[orientation];
  if (compact) {
    const even = c.compactEven === true;
    const fch = c.firstCompactNode as Node;
    const D = (fch.flexCompactDim as [number, number])[0];
    const pair = o.compactMarginPair;
    targetHandle = COMPACT_TARGET_HANDLE[orientation][even ? 0 : 1];
    switch (orientation) {
      case 'top':
      case 'bottom': {
        const sx = c.x + (even ? c.width / 2 : -c.width / 2);
        const sy = orientation === 'top' ? c.y + c.height / 2 : c.y - c.height / 2;
        targetPoint = { x: sx, y: sy };
        spineTop = { x: fch.x + D / 4 + pair / 4, y: fch.y };
        break;
      }
      case 'left':
      case 'right': {
        const sx = orientation === 'left' ? c.x + c.width / 2 : c.x - c.width / 2;
        targetPoint = { x: sx, y: c.y + (even ? c.height / 2 : -c.height / 2) };
        spineTop = { x: fch.x, y: fch.y + D / 4 + pair / 4 };
        break;
      }
    }
  }
  return {
    id: `${p.id}->${c.id}`,
    source: p.id,
    target: c.id,
    sourceHandle: SOURCE_HANDLE[orientation],
    targetHandle,
    sourcePoint,
    targetPoint,
    spineTop,
  };
}

function boundsOf(nodes: readonly LayoutNode[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.width);
    maxY = Math.max(maxY, n.position.y + n.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
