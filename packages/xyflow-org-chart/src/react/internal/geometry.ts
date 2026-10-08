import type { Bounds, Orientation, Point, Size } from '../../types';

/**
 * Top-left at which d3-org-chart places a card entering from (or exiting to) `anchorNode`:
 * layoutBindings nodeJoinX/Y evaluated on the anchor node (d3-org-chart.js:302-452,
 * layout-algorithm.md §8.5). Expressed on the anchor's top-left it is a shift by one card size
 * toward the children: top (x0 − w/2, y0 + h) = (left, top + h); bottom (x0 − w/2, y0 − 2h) =
 * (left, top − h); left (x0 + w, y0 − h/2) = (left + w, top); right (x0 − 2w, y0 − h/2) = (left − w, top).
 */
export function joinTopLeft(anchorTopLeft: Point, anchorSize: Size, orientation: Orientation): Point {
  const { x, y } = anchorTopLeft;
  switch (orientation) {
    case 'top':
      return { x, y: y + anchorSize.height };
    case 'bottom':
      return { x, y: y - anchorSize.height };
    case 'left':
      return { x: x + anchorSize.width, y };
    case 'right':
      return { x: x - anchorSize.width, y };
  }
}

export interface Box {
  position: Point;
  width: number;
  height: number;
}

/** Bounding box of card boxes, or null for an empty set. */
export function boxesBounds(boxes: Iterable<Box>): Bounds | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.position.x);
    y0 = Math.min(y0, b.position.y);
    x1 = Math.max(x1, b.position.x + b.width);
    y1 = Math.max(y1, b.position.y + b.height);
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function padBounds(b: Bounds, padding: number): Bounds {
  return { x: b.x - padding, y: b.y - padding, width: b.width + 2 * padding, height: b.height + 2 * padding };
}

/** d3.easeCubicInOut. */
export function easeCubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
