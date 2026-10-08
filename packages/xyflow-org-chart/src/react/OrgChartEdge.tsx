import { BaseEdge, type EdgeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { orgChartEdgePath } from '../paths';
import type { OrgChartFlowEdge } from './types';

/**
 * d3-org-chart's link (rounded elbow "comb", compact stub + spine) as a React Flow custom edge.
 * The path is a pure function of the live handle positions + edge.data, so it follows animated
 * nodes on every frame (layout-algorithm.md §7.8). Like d3-org-chart's, the path runs child →
 * parent, so `markerEnd` renders at the parent. Stroke comes from React Flow's edge CSS variables.
 */
export function OrgChartEdge(props: EdgeProps<OrgChartFlowEdge>): ReactNode {
  const { id, sourceX, sourceY, targetX, targetY, data, style, markerStart, markerEnd } = props;
  const path = orgChartEdgePath({
    orientation: data?.orientation ?? 'top',
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    spineFromTarget: data?.spineFromTarget ?? null,
    linkYOffset: data?.linkYOffset ?? 30,
  });
  return (
    <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={0} />
  );
}
