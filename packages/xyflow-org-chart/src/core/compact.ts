/**
 * d3-org-chart's compact mode: sibling leaves folded into a two-column grid (layout-algorithm.md §5).
 * Both passes run in the canonical flex frame (x = breadth centre, y = depth top) and mirror
 * calculateCompactFlexDimensions / calculateCompactFlexPositions (d3-org-chart.js:757-828),
 * including their operand order, so results are bit-identical to the library.
 */

/** The fields the compact passes read and write on a layout tree node. */
export interface CompactNode {
  children: CompactNode[];
  /** Breadth size (d3-org-chart's compactDimension.sizeColumn). */
  breadth: number;
  /** Depth size (compactDimension.sizeRow). */
  depthSize: number;
  /** Canonical flex coordinates; written by flextree, then by the post-pass for grid cells. */
  cx: number;
  cy: number;
  /** Index among the grid's cells; -1 outside any grid. */
  compactIndex: number;
  compactEven: boolean | null;
  row: number | null;
  firstCompactNode: CompactNode | null;
  /** [D, H] on a grid's first cell, [0, 0] on the other cells, null elsewhere. */
  flexCompactDim: [number, number] | null;
}

export interface CompactMargins {
  /** compactMarginPair: gap between the two columns. */
  pair: number;
  /** compactMarginBetween: gap between rows. */
  between: number;
}

/** Leaf children of `node` that form a grid (at least 2 of them, §5.1), or null. */
function gridCells<T extends CompactNode>(node: T): T[] | null {
  if (node.children.length < 2) return null;
  const cells = (node.children as T[]).filter((c) => c.children.length === 0);
  return cells.length < 2 ? null : cells;
}

/**
 * Max of `size(cell)` per row, as an array indexed by row (rows are 0..last, all present because
 * cells fill row by row). Same values as the library's groupBy + d3.max.
 */
function rowMaxima(cells: readonly CompactNode[], size: (c: CompactNode) => number): number[] {
  const max: number[] = [];
  for (const c of cells) {
    const r = c.row as number;
    const v = size(c);
    if (max[r] === undefined || v > max[r]) max[r] = v;
  }
  return max;
}

/**
 * Pre-pass (§5.1-5.3): assigns grid cells and gives each grid's first cell the whole block as its
 * flex size. Uses the library's reservation form (:780, :787): the row margin is added per cell
 * inside the row max, then one margin is removed from the sum.
 */
export function compactPrePass(nodes: readonly CompactNode[], { pair, between }: CompactMargins): void {
  for (const n of nodes) {
    n.compactIndex = -1;
    n.compactEven = null;
    n.row = null;
    n.firstCompactNode = null;
    n.flexCompactDim = null;
  }
  for (const n of nodes) {
    const cells = gridCells(n);
    if (!cells) continue;
    let evenMax = -Infinity;
    let oddMax = -Infinity;
    cells.forEach((c, i) => {
      c.compactIndex = i;
      c.compactEven = i % 2 === 0;
      c.row = Math.floor(i / 2);
      c.firstCompactNode = cells[0];
      if (c.compactEven) evenMax = Math.max(evenMax, c.breadth);
      else oddMax = Math.max(oddMax, c.breadth);
    });
    const columnSize = Math.max(evenMax, oddMax) * 2;
    let rowSize = 0; // d3.sum over the rows, ascending
    for (const h of rowMaxima(cells, (c) => c.depthSize + between)) rowSize += h;
    cells.forEach((c, i) => {
      c.flexCompactDim = i === 0 ? [columnSize + pair, rowSize - between] : [0, 0];
    });
  }
}

/**
 * Post-pass (§5.5-5.6): moves the grid cells from flextree's placeholder slots into the two
 * columns and stacks the rows, starting at the first cell's flextree y.
 */
export function compactPostPass(nodes: readonly CompactNode[], { pair, between }: CompactMargins): void {
  for (const n of nodes) {
    if (n.children.length === 0) continue;
    const cells = n.children.filter((c) => c.flexCompactDim);
    const fch = cells[0];
    if (!fch) continue;
    const D = (fch.flexCompactDim as [number, number])[0];
    const L = fch.cx - D / 2; // :806, the block's near breadth edge
    for (let i = 1; i < cells.length; i++) {
      // :807-808; the library's `i & i % 2 - 1` is truthy exactly for even i > 0 (§5.5).
      cells[i].cx = i % 2 === 0 ? L + D * 0.25 - pair / 4 : L + D * 0.75 + pair / 4;
    }
    const centerX = L + D * 0.5;
    fch.cx = L + D * 0.25 - pair / 4;
    const offsetX = n.cx - centerX;
    if (Math.abs(offsetX) < 10) for (const c of cells) c.cx += offsetX; // the snap (§5.5)

    // Placement form (:817-818): row max without margin, margin added after the max.
    let acc = 0;
    const cumSum = rowMaxima(cells, (c) => c.depthSize).map((h) => (acc += h + between));
    for (const c of cells) {
      const row = c.row as number;
      c.cy = row ? fch.cy + cumSum[row - 1] : fch.cy;
    }
  }
}
