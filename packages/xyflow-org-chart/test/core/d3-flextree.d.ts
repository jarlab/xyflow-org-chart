// Minimal typings for the d3-flextree 2.1.2 UMD build, used only by the differential test.
declare module 'd3-flextree' {
  export interface FlexHierarchyNode<D> {
    data: D;
    x: number;
    y: number;
    parent: FlexHierarchyNode<D> | null;
    children: FlexHierarchyNode<D>[] | null;
    descendants(): FlexHierarchyNode<D>[];
  }
  export interface FlextreeLayout<D> {
    (tree: FlexHierarchyNode<D>): FlexHierarchyNode<D>;
    hierarchy(data: D, children?: (d: D) => D[] | null | undefined): FlexHierarchyNode<D>;
  }
  export function flextree<D>(options: {
    nodeSize: (node: FlexHierarchyNode<D>) => readonly [number, number];
    spacing?: number | ((a: FlexHierarchyNode<D>, b: FlexHierarchyNode<D>) => number);
    children?: (d: D) => D[] | null | undefined;
  }): FlextreeLayout<D>;
}
