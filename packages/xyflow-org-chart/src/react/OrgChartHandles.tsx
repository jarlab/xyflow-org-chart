import { Handle, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';
import type { HandleId } from '../types';

/**
 * Zero-size, invisible box with explicit offsets, so the endpoint React Flow reads from the
 * handle's bounds is exactly the border midpoint, with or without React Flow's stylesheet (whose
 * default handle puts endpoints 4 px outside the card, layout-algorithm.md §7.8). The handle must
 * stay measurable: never display:none.
 */
const BASE: CSSProperties = {
  position: 'absolute',
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  padding: 0,
  margin: 0,
  borderRadius: 0,
  transform: 'none',
  background: 'transparent',
  pointerEvents: 'none',
  right: 'auto',
  bottom: 'auto',
};

const PLACEMENT: Record<'top' | 'right' | 'bottom' | 'left', CSSProperties> = {
  top: { ...BASE, left: '50%', top: 0 },
  right: { ...BASE, left: '100%', top: '50%' },
  bottom: { ...BASE, left: '50%', top: '100%' },
  left: { ...BASE, left: 0, top: '50%' },
};

const POSITION = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left } as const;

const HANDLES: { id: HandleId; type: 'source' | 'target'; side: keyof typeof PLACEMENT }[] = [
  { id: 't-top', type: 'target', side: 'top' },
  { id: 't-right', type: 'target', side: 'right' },
  { id: 't-bottom', type: 'target', side: 'bottom' },
  { id: 't-left', type: 'target', side: 'left' },
  { id: 's-top', type: 'source', side: 'top' },
  { id: 's-right', type: 'source', side: 'right' },
  { id: 's-bottom', type: 'source', side: 'bottom' },
  { id: 's-left', type: 'source', side: 'left' },
];

/**
 * Renders the 8 zero-size, non-connectable handles (s-top/s-right/s-bottom/s-left and
 * t-top/t-right/t-bottom/t-left) that useOrgChart's edges attach to. Zero size puts the edge
 * endpoints exactly on the card border, at d3-org-chart's anchor points
 * (layout-algorithm.md §7.8, §10.5). Render it inside every custom node, in an element that fills
 * the node box: the node root itself, or a `position: relative` wrapper of the node's size.
 *
 * That element must have NO border (and its nearest positioned ancestor must be it, or React Flow's
 * node wrapper): absolute offsets start at the padding box, so a 1px border moves every endpoint
 * 1px into the card. Put the border on an inner element, as OrgChartNode does.
 */
export function OrgChartHandles(): ReactNode {
  return (
    <>
      {HANDLES.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type={h.type}
          position={POSITION[h.side]}
          isConnectable={false}
          isConnectableStart={false}
          isConnectableEnd={false}
          style={PLACEMENT[h.side]}
        />
      ))}
    </>
  );
}
