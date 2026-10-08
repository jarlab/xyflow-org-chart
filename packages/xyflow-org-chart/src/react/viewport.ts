import { getViewportForBounds, useReactFlow, useStoreApi } from '@xyflow/react';
import { useMemo, useRef } from 'react';
import type { LayoutNode, OrgChartLayout } from '../types';
import { useOrgChartContext } from './context';
import { boxesBounds, padBounds } from './internal/geometry';
import { useIsomorphicLayoutEffect } from './internal/hooks';
import type { OrgChartFlowEdge, OrgChartFlowNode } from './types';

export interface FitOrgChartOptions {
  /** Restrict to these node ids (default: every laid-out node). */
  nodeIds?: readonly string[];
  /** Padding around the cards' bounding box, in flow units (d3-org-chart: 50). */
  padding?: number;
  /** Transition duration in ms (default 400). */
  duration?: number;
  /** false keeps the current zoom and only pans (d3-org-chart fit({scale:false})). Default true. */
  scale?: boolean;
  /** Cap on the zoom when scaling (d3-org-chart: 8). React Flow's own maxZoom also applies. */
  maxZoom?: number;
}

export interface OrgChartViewport {
  /** d3-org-chart's fit(): frame the bbox padded by 50 at 0.9 of the pane (zoom ≤ 8). */
  fit(options?: FitOrgChartOptions): Promise<boolean>;
  /** Centre on a node (and, by default, its visible children) keeping the current zoom. */
  centerOn(id: string, options?: { withChildren?: boolean; duration?: number }): Promise<boolean>;
}

/**
 * fitBounds' numeric padding p gives zoom ≈ W / ((1 + p)·bw); p = 1/9 reproduces d3-org-chart's
 * k = 0.9 / max(bw/W, bh/H) (layout-algorithm.md §10.7).
 */
const D3_FIT_PADDING = 1 / 9;

function layoutNodes(layout: OrgChartLayout, ids: readonly string[] | undefined): LayoutNode[] {
  if (!ids) return layout.nodes;
  const out: LayoutNode[] = [];
  for (const id of ids) {
    const n = layout.nodeById.get(id);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Viewport helpers with d3-org-chart semantics. Must be used inside <ReactFlow> (or a
 * ReactFlowProvider) and an OrgChartProvider. They frame the TARGET layout, so calling them while
 * nodes are still animating frames where the cards will end up.
 */
export function useOrgChartViewport(): OrgChartViewport {
  const { setViewport, setCenter, getZoom } = useReactFlow<OrgChartFlowNode, OrgChartFlowEdge>();
  const store = useStoreApi<OrgChartFlowNode, OrgChartFlowEdge>();
  const { layout } = useOrgChartContext();
  const layoutRef = useRef(layout);
  useIsomorphicLayoutEffect(() => {
    layoutRef.current = layout;
  });

  return useMemo((): OrgChartViewport => {
    const centerOnBoxes = async (boxes: LayoutNode[], duration: number) => {
      const b = boxesBounds(boxes);
      if (!b) return false;
      return setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom: getZoom(), duration });
    };
    return {
      async fit({ nodeIds, padding = 50, duration = 400, scale = true, maxZoom = 8 } = {}) {
        const current = layoutRef.current;
        if (!current) return false;
        const boxes = layoutNodes(current, nodeIds);
        if (!scale) return centerOnBoxes(boxes, duration);
        const bounds = boxesBounds(boxes);
        const { width, height, minZoom, maxZoom: flowMaxZoom } = store.getState();
        if (!bounds || !width || !height) return false;
        const zoomCap = Math.min(maxZoom, flowMaxZoom);
        const viewport = getViewportForBounds(
          padBounds(bounds, padding),
          width,
          height,
          Math.min(minZoom, zoomCap),
          zoomCap,
          D3_FIT_PADDING,
        );
        return setViewport(viewport, { duration });
      },
      async centerOn(id, { withChildren = true, duration = 400 } = {}) {
        const current = layoutRef.current;
        const node = current?.nodeById.get(id);
        if (!current || !node) return false;
        const ids = withChildren ? [id, ...node.childIds] : [id];
        return centerOnBoxes(layoutNodes(current, ids), duration);
      },
    };
  }, [setViewport, setCenter, getZoom, store]);
}
