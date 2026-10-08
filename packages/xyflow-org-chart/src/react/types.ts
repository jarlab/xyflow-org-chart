import type { Edge, Node, OnNodesChange } from '@xyflow/react';
import type { OrgHierarchy, PagingOptions } from '../core/hierarchy';
import type {
  CompactCellInfo,
  OrgChartDataError,
  OrgChartLayout,
  OrgChartLayoutOptions,
  Orientation,
  Size,
  SpineOffset,
} from '../types';

/** `data` of every node produced by useOrgChart. */
export interface OrgChartNodeData<T = unknown> extends Record<string, unknown> {
  /** 'paging' = the synthetic "show more" node of a paged parent. */
  kind: 'node' | 'paging';
  /** The user's row; undefined for paging nodes. */
  item: T | undefined;
  orientation: Orientation;
  depth: number;
  parentId: string | null;
  /** Card size used by the layout (fixed size, or the measured size in measure mode). */
  width: number;
  height: number;
  /** Has children in the full data. */
  hasChildren: boolean;
  /** Children are currently shown. */
  expanded: boolean;
  /** Number of children in the full data. */
  directReports: number;
  /** Number of descendants in the full data. */
  totalReports: number;
  /** Paging nodes: children still hidden behind "show more". 0 for regular nodes. */
  hiddenCount: number;
  /** Paging nodes: how many children the next "show more" reveals (min(hiddenCount, paging.step)). */
  nextPageCount?: number;
  /** Set when the node sits in a compact grid. */
  compact: CompactCellInfo | null;
}

export type OrgChartFlowNode<T = unknown> = Node<OrgChartNodeData<T>>;

/** `data` of every edge produced by useOrgChart (consumed by OrgChartEdge). */
export interface OrgChartEdgeData extends Record<string, unknown> {
  orientation: Orientation;
  /** d3-org-chart's linkYOffset (top/bottom only). */
  linkYOffset: number;
  /** Compact cells only: offset from the edge's target point (stub start) to the spine top. */
  spineFromTarget: SpineOffset | null;
}

export type OrgChartFlowEdge = Edge<OrgChartEdgeData>;

export interface UseOrgChartOptions<T> extends Partial<OrgChartLayoutOptions> {
  /** Flat rows; exactly one root (parent id null/undefined/''). Child order = row order. */
  data: readonly T[];
  /** Default: `item.id` (coerced to string); a row without one is reported as error 'missing-id'. */
  getId?: (item: T) => string | number;
  /** Default: `item.parentId`. */
  getParentId?: (item: T) => string | number | null | undefined;
  /** Fixed card size (default 250×150, d3-org-chart's default). Ignored for measured nodes in measure mode. */
  nodeSize?: Size | ((item: T) => Size);
  /**
   * Size of the synthetic "show more" nodes. Default: like d3-org-chart, the size of the first
   * hidden child it stands in for (nodeSize applied to that row), or 250×150 without nodeSize.
   */
  pagingNodeSize?: Size;
  /**
   * Lay out with the sizes React Flow measures from the DOM instead of nodeSize (two-pass: render,
   * measure, lay out). nodeSize is then only the initial guess. Default false.
   */
  measure?: boolean;
  /** React Flow node type of regular nodes. Default 'orgChart'. */
  nodeType?: string;
  /** React Flow node type of "show more" nodes. Default 'orgChartPaging'. */
  pagingNodeType?: string;
  /** React Flow edge type. Default 'orgChart'. */
  edgeType?: string;
  /** Nodes at depth <= initialExpandLevel start visible (d3-org-chart default 1). Uncontrolled mode only. */
  initialExpandLevel?: number;
  /**
   * Controlled expansion: ids whose children are shown. Actions called together (one handler)
   * compose: each builds on the ids the previous one reported, until the next render.
   */
  expandedIds?: readonly string[];
  /** Called with the new expanded ids whenever an action changes them. */
  onExpandedIdsChange?: (ids: string[]) => void;
  /** Show at most pageSize children per parent, then a "show more" node. Default false. */
  paging?: PagingOptions | false;
  /** d3-org-chart's linkYOffset. Default 30 (d3-org-chart); 0 gives a bus centred in the gap. */
  linkYOffset?: number;
  /** Position transition on layout changes, in ms. Default 400; 0 disables. */
  animationDuration?: number;
}

export interface OrgChartActions {
  /** Expand if collapsed, collapse if expanded. */
  toggle(id: string): void;
  /** Show id's children (and make id visible by expanding its ancestors). */
  expand(id: string): void;
  /** Hide id's children. */
  collapse(id: string): void;
  expandAll(): void;
  /**
   * Collapse everything: only the root stays visible, as d3-org-chart's collapseAll(). To return
   * to the initial expansion instead, call collapseToLevel(initialExpandLevel).
   */
  collapseAll(): void;
  /** Reset expansion to "nodes at depth <= level are visible" (0 = only the root). */
  collapseToLevel(level: number): void;
  /** Expand every ancestor of id so it becomes visible. */
  reveal(id: string): void;
  /** Paging: reveal paging.step more children of parentId. */
  showMore(parentId: string): void;
}

export interface UseOrgChartResult<T> extends OrgChartActions {
  /** Pass to <ReactFlow nodes>. Positions are animated between layouts. */
  nodes: OrgChartFlowNode<T>[];
  /** Pass to <ReactFlow edges>. */
  edges: OrgChartFlowEdge[];
  /** Pass to <ReactFlow onNodesChange>; required in measure mode, harmless otherwise. */
  onNodesChange: OnNodesChange<OrgChartFlowNode<T>>;
  /** The latest target layout (null until the first layout, e.g. before measuring, or on data error). */
  layout: OrgChartLayout | null;
  /** Incremented every time a new target layout is computed. */
  layoutVersion: number;
  hierarchy: OrgHierarchy<T> | null;
  /** Set when `data` is malformed; nodes/edges are then empty. */
  error: OrgChartDataError | null;
  expandedIds: ReadonlySet<string>;
  orientation: Orientation;
  /** The node whose toggle/expand/collapse/showMore produced the current layout (null otherwise). */
  lastActionNodeId: string | null;
  isAnimating: boolean;
  /**
   * The position transition duration actually used, in ms: animationDuration, or 0 when it is 0 or
   * the user prefers reduced motion. <OrgChart> reuses it for centring after actions.
   */
  animationDuration: number;
}
