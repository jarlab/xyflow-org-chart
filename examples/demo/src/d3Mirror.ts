/**
 * Drives the real d3-org-chart from xyflow-org-chart's state so the compare view shows the same
 * visible tree with the same card sizes. Pure; React-free.
 */
import type { D3OrgChartNode, D3OrgChartRowFlags } from 'd3-org-chart';
import { pagingNodeId, type OrgChartLayout, type Size } from 'xyflow-org-chart/core';

export interface MirrorRow {
  id: string;
  parentId: string | null;
}

export interface D3Mirror {
  /** Rows visible in our layout (synthetic paging nodes excluded). */
  visible: Set<string>;
  /** Parents that currently page: number of real children shown before "show more". */
  pageLimits: Map<string, number>;
  /** The root's children are shown. */
  rootExpanded: boolean;
}

export function mirrorLayout(layout: OrgChartLayout, isRow: (id: string) => boolean): D3Mirror {
  const visible = new Set<string>();
  const pageLimits = new Map<string, number>();
  for (const node of layout.nodes) {
    if (isRow(node.id)) {
      visible.add(node.id);
    } else if (node.parentId !== null) {
      const parent = layout.nodeById.get(node.parentId);
      pageLimits.set(node.parentId, parent ? parent.childIds.filter(isRow).length : 0);
    }
  }
  const root = layout.nodes[0];
  return { visible, pageLimits, rootExpanded: root !== undefined && root.childIds.length > 0 };
}

/**
 * Fresh rows flagged so that d3-org-chart's visible tree equals ours (layout-algorithm.md §8.2-8.3):
 * - `_expanded` ("must be visible") on every row we show. d3-org-chart reopens every ancestor of a
 *   flagged node, which shows the node with all its siblings; in our model visibility is also per
 *   sibling group, so flagging exactly our visible rows reproduces our visible set.
 * - `_pagingStep` preset to our page limit for parents that page, else MAX_SAFE_INTEGER (no paging).
 *   d3-org-chart then shows children[0..P-1], turns children[P] into its "show more" node and drops
 *   the rest: the same footprint as our P children + synthetic paging node.
 * Pair with `initialExpandLevel(mirror.rootExpanded ? 1 : 0)`: 1 flags nothing, 0 collapses the root.
 */
export function toD3Rows<R extends MirrorRow>(rows: readonly R[], mirror: D3Mirror): Array<R & D3OrgChartRowFlags> {
  return rows.map((row) => ({
    ...row,
    _expanded: mirror.visible.has(row.id),
    _pagingStep: mirror.pageLimits.get(row.id) ?? Number.MAX_SAFE_INTEGER,
  }));
}

/**
 * Card size of a d3-org-chart node, taken from our layout (fixed or measured). d3-org-chart's
 * "show more" node is the real child at index P, which our layout replaces by a synthetic node:
 * it gets that node's size.
 */
export function d3NodeSize<R extends MirrorRow>(layout: OrgChartLayout, node: D3OrgChartNode<R>, fallback: Size): Size {
  const own = layout.nodeById.get(node.data.id);
  if (own) return own;
  const paging = node.data.parentId !== null ? layout.nodeById.get(pagingNodeId(node.data.parentId)) : undefined;
  return paging ?? fallback;
}
