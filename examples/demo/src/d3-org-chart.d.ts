/**
 * Types for the subset of d3-org-chart 3.1.1 used by the compare view. The package ships no types.
 * Its chainable accessors are generated at runtime from `attrs` (d3-org-chart.js:458-469): called
 * with an argument they set the value and return the chart. Only the setter form is declared.
 */
declare module 'd3-org-chart' {
  export type D3OrgChartLayout = 'top' | 'bottom' | 'left' | 'right';

  /** Flags d3-org-chart reads from and writes onto the caller's rows (layout-algorithm.md §8.2). */
  export interface D3OrgChartRowFlags {
    /** "This node must be visible" (not "show my children"). */
    _expanded?: boolean;
    /** Paging: number of children shown before the "show more" button (initialised when falsy). */
    _pagingStep?: number;
    _pagingButton?: boolean;
    _directSubordinates?: number;
    _directSubordinatesPaging?: number;
    _totalSubordinates?: number;
    _centered?: boolean | null;
    _centeredWithDescendants?: boolean | null;
    _highlighted?: boolean;
    _upToTheRootHighlighted?: boolean;
  }

  /** A d3-hierarchy node as d3-org-chart passes it to accessors (layout fields included). */
  export interface D3OrgChartNode<Datum> {
    id: string | undefined;
    data: Datum & D3OrgChartRowFlags;
    depth: number;
    parent: D3OrgChartNode<Datum> | null;
    children?: D3OrgChartNode<Datum>[] | null;
    _children?: D3OrgChartNode<Datum>[] | null;
    x: number;
    y: number;
    width: number;
    height: number;
    descendants(): D3OrgChartNode<Datum>[];
  }

  export interface D3OrgChartState<Datum> {
    root: D3OrgChartNode<Datum>;
    allNodes: D3OrgChartNode<Datum>[];
    data: Array<Datum & D3OrgChartRowFlags> | null;
    layout: D3OrgChartLayout;
    svgWidth: number;
    svgHeight: number;
    duration: number;
    pagingStep(node: D3OrgChartNode<Datum>): number;
  }

  export interface D3OrgChartFitOptions<Datum> {
    animate?: boolean;
    nodes?: D3OrgChartNode<Datum>[];
    scale?: boolean;
    onCompleted?: () => void;
  }

  type NodeAccessor<Datum, R> = (node: D3OrgChartNode<Datum>) => R;

  export class OrgChart<Datum = Record<string, unknown>> {
    constructor();
    container(container: string | HTMLElement): this;
    svgWidth(width: number): this;
    svgHeight(height: number): this;
    /** Stored by reference and mutated (flags above): pass fresh copies. */
    data(rows: Array<Datum & D3OrgChartRowFlags>): this;
    nodeId(accessor: (row: Datum) => string): this;
    parentNodeId(accessor: (row: Datum) => string | null | undefined): this;
    nodeWidth(accessor: NodeAccessor<Datum, number>): this;
    nodeHeight(accessor: NodeAccessor<Datum, number>): this;
    siblingsMargin(accessor: NodeAccessor<Datum, number>): this;
    childrenMargin(accessor: NodeAccessor<Datum, number>): this;
    neighbourMargin(accessor: (a: D3OrgChartNode<Datum>, b: D3OrgChartNode<Datum>) => number): this;
    compactMarginPair(accessor: NodeAccessor<Datum, number>): this;
    compactMarginBetween(accessor: NodeAccessor<Datum, number>): this;
    layout(layout: D3OrgChartLayout): this;
    compact(compact: boolean): this;
    linkYOffset(offset: number): this;
    duration(ms: number): this;
    /** depth <= level visible; > 1 is one-shot, 0 is sticky (layout-algorithm.md §8.2). */
    initialExpandLevel(level: number): this;
    minPagingVisibleNodes(accessor: NodeAccessor<Datum, number>): this;
    pagingStep(accessor: NodeAccessor<Datum, number>): this;
    setActiveNodeCentered(enabled: boolean): this;
    scaleExtent(extent: [number, number]): this;
    nodeContent(
      render: (
        node: D3OrgChartNode<Datum>,
        index: number,
        nodes: ArrayLike<Element>,
        state: D3OrgChartState<Datum>,
      ) => string,
    ): this;
    pagingButton(
      render: (
        node: D3OrgChartNode<Datum>,
        index: number,
        nodes: ArrayLike<Element>,
        state: D3OrgChartState<Datum>,
      ) => string,
    ): this;
    linkUpdate(update: (this: SVGPathElement, node: D3OrgChartNode<Datum>, index: number) => void): this;
    nodeUpdate(update: (this: SVGGElement, node: D3OrgChartNode<Datum>, index: number) => void): this;
    onNodeClick(handler: (node: D3OrgChartNode<Datum>) => void): this;
    onExpandOrCollapse(handler: (node: D3OrgChartNode<Datum>) => void): this;

    render(): this;
    fit(options?: D3OrgChartFitOptions<Datum>): this;
    expandAll(): this;
    collapseAll(): this;
    clear(): void;
    getChartState(): D3OrgChartState<Datum>;

    /** Expand/collapse button handler; replaceable per instance (called as this.onButtonClick). */
    onButtonClick(event: Event, node: D3OrgChartNode<Datum>): void;
    /** "Show more" handler; replaceable per instance (called as this.loadPagingNodes). */
    loadPagingNodes(node: D3OrgChartNode<Datum>): void;
  }
}
