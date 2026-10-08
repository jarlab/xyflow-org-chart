/**
 * Framework-free types shared by the layout core, the path generators and the React layer.
 *
 * Coordinate conventions follow d3-org-chart 3.1.1 (see docs/d3-org-chart/layout-algorithm.md §6):
 * all coordinates are flow coordinates with the root's anchor at (0, 0); y grows downward.
 */

export type Orientation = 'top' | 'bottom' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Geometry options. Defaults are d3-org-chart 3.1.1's (see DEFAULT_LAYOUT_OPTIONS). */
export interface OrgChartLayoutOptions {
  /** Direction the tree grows from its root. 'top' = root at the top, children below. */
  orientation: Orientation;
  /** Fold sibling leaves into a two-column grid hanging off a spine (d3-org-chart's compact mode). */
  compact: boolean;
  /** Gap between siblings; half is added on each side of every card (breadth axis). */
  siblingsMargin: number;
  /** Gap between a parent's outgoing edge and its children (depth axis). */
  childrenMargin: number;
  /** Extra gap between adjacent nodes that do not share a parent (flextree spacing). */
  neighbourMargin: number;
  /** Gap between the two columns of a compact grid. */
  compactMarginPair: number;
  /** Gap between the rows of a compact grid. */
  compactMarginBetween: number;
}

export const DEFAULT_LAYOUT_OPTIONS: Readonly<OrgChartLayoutOptions> = Object.freeze({
  orientation: 'top',
  compact: true,
  siblingsMargin: 20,
  childrenMargin: 60,
  neighbourMargin: 80,
  compactMarginPair: 100,
  compactMarginBetween: 20,
});

/**
 * One VISIBLE node handed to the layout. Children are ordered by their order of appearance in the
 * input array. Exactly one node must have parentId === null.
 */
export interface LayoutInputNode {
  id: string;
  parentId: string | null;
  /** Drawn card size (never swapped by orientation). */
  width: number;
  height: number;
}

/** Present on nodes that were placed in a compact grid. */
export interface CompactCellInfo {
  /** Index among the grid's cells, in child order. */
  index: number;
  /** d3-org-chart's compactEven: true = left column (top/bottom) / upper row (left/right). */
  even: boolean;
  /** Grid row (floor(index / 2)). */
  row: number;
  /** Id of the grid's first cell (d3-org-chart's firstCompactNode). */
  firstCellId: string;
  /**
   * d3-org-chart's flexCompactDim, canonical frame [breadth, depth]: the whole grid block on the
   * first cell, [0, 0] on the others.
   */
  flexCompactDim: [number, number];
  /** Width of one column slot on the breadth axis (the widest cell's breadth size). */
  columnSize: number;
  /** Depth-axis offset of this cell's row from row 0's near edge. */
  rowOffset: number;
}

export interface LayoutNode {
  id: string;
  parentId: string | null;
  depth: number;
  /** Drawn card size. */
  width: number;
  height: number;
  /**
   * d3-org-chart's post-swap (x, y): the centre of the card's root-facing edge.
   * top: (centre, top) · bottom: (centre, bottom) · left: (left, middle) · right: (right, middle).
   */
  x: number;
  y: number;
  /** Top-left corner of the card: React Flow `position` with the default nodeOrigin [0, 0]. */
  position: Point;
  /** Ids of the visible children, in order. */
  childIds: string[];
  compact: CompactCellInfo | null;
}

export type SourceHandleId = 's-top' | 's-right' | 's-bottom' | 's-left';
export type TargetHandleId = 't-top' | 't-right' | 't-bottom' | 't-left';
export type HandleId = SourceHandleId | TargetHandleId;

export interface LayoutEdge {
  /** `${source}->${target}` */
  id: string;
  /** Parent id. */
  source: string;
  /** Child id. */
  target: string;
  /** Handle on the parent's outgoing side (layout-algorithm.md §10.5). */
  sourceHandle: SourceHandleId;
  /** Handle on the child's root-facing side, or its spine-facing side for compact cells. */
  targetHandle: TargetHandleId;
  /** The parent's outgoing join point (d3-org-chart linkParentX/Y). */
  sourcePoint: Point;
  /** The child anchor (linkX/Y), or the compact stub start (linkCompactX/YStart) for compact cells. */
  targetPoint: Point;
  /** Compact cells only: the top of the spine (compactLinkMidX/Y). */
  spineTop: Point | null;
}

export interface OrgChartLayout {
  options: OrgChartLayoutOptions;
  /** Breadth-first order (root first), like d3-org-chart's root.descendants(). */
  nodes: LayoutNode[];
  nodeById: Map<string, LayoutNode>;
  /** One edge per non-root node, in the same order as `nodes` (minus the root). */
  edges: LayoutEdge[];
  /** Bounding box of the drawn cards. */
  bounds: Bounds;
}

/** Offset from an edge's targetPoint to its spineTop (compact cells), used by the edge component. */
export interface SpineOffset {
  dx: number;
  dy: number;
}

export class OrgChartDataError extends Error {
  constructor(
    message: string,
    /** 'missing-id': a row has no `id` field and no getId was given (useOrgChart only). */
    readonly code: 'no-root' | 'multiple-roots' | 'missing-parent' | 'duplicate-id' | 'cycle' | 'empty' | 'missing-id',
    readonly id?: string,
  ) {
    super(message);
    this.name = 'OrgChartDataError';
  }
}
