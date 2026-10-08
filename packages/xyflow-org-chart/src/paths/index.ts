import type { Orientation, Point, SpineOffset } from '../types';

/**
 * Exact port of d3-org-chart 3.1.1's vertical link generator `diagonal(s, t, m, offsets)`
 * (d3-org-chart.js:225-262, layout-algorithm.md §7.2). Emits the same 24-number
 * `M L L L C L C L` path string (whitespace may differ; numbers and commands must not).
 *
 * - `s`: the child end (child anchor, or the spine top for compact cells); shifted by `offsets.sy`
 *   on y. `t`: the parent join. `m`: the compact stub start; a missing `m`, or a null/undefined
 *   `m.x` / `m.y`, falls back to `s.x` / `s.y` (pre-offset).
 * - `offsets` defaults to `{ sy: 0 }` only when omitted. Like the library, an object without `sy`
 *   (e.g. `{}`) adds `undefined` and yields `NaN` coordinates; pass `{ sy: 0 }` instead.
 *
 * Arithmetic order is kept from the library so every number is bit-identical to its output.
 */
export function diagonal(s: Point, t: Point, m?: Point | null, offsets: { sy?: number } = { sy: 0 }): string {
  const x = s.x;
  let y = s.y;
  const ex = t.x;
  const ey = t.y;

  const mx = m && m.x != null ? m.x : x;
  const my = m && m.y != null ? m.y : y;

  // Directions are taken BEFORE the offset is applied (§7.2).
  const xrvs = ex - x < 0 ? -1 : 1;
  const yrvs = ey - y < 0 ? -1 : 1;

  // `as number`: the library adds `undefined` (-> NaN) when `sy` is missing; kept on purpose.
  y += offsets.sy as number;

  const rdef = 35;
  // Ternaries rather than Math.min: they differ on NaN and the port must not.
  let r = Math.abs(ex - x) / 2 < rdef ? Math.abs(ex - x) / 2 : rdef;
  r = Math.abs(ey - y) / 2 < r ? Math.abs(ey - y) / 2 : r;

  const h = Math.abs(ey - y) / 2 - r;
  const w = Math.abs(ex - x) - r * 2;

  const busY = y + h * yrvs + r * yrvs;
  return (
    `M ${mx} ${my} L ${x} ${my} L ${x} ${y} L ${x} ${y + h * yrvs} ` +
    `C ${x} ${busY} ${x} ${busY} ${x + r * xrvs} ${busY} ` +
    `L ${x + w * xrvs + r * xrvs} ${busY} ` +
    `C ${ex} ${busY} ${ex} ${busY} ${ex} ${ey - h * yrvs} ` +
    `L ${ex} ${ey}`
  );
}

/**
 * Exact port of d3-org-chart 3.1.1's horizontal link generator `hdiagonal(s, t, m)`
 * (d3-org-chart.js:181-223, layout-algorithm.md §7.3). It ignores offsets.
 *
 * Same argument roles as {@link diagonal}; the compact stub runs vertically first
 * (`m` → `(m.x, s.y)` → `s`). Numbers are bit-identical to the library's output.
 */
export function hdiagonal(s: Point, t: Point, m?: Point | null): string {
  const x = s.x;
  const y = s.y;
  const ex = t.x;
  const ey = t.y;

  const mx = m && m.x != null ? m.x : x;
  const my = m && m.y != null ? m.y : y;

  const xrvs = ex - x < 0 ? -1 : 1;
  const yrvs = ey - y < 0 ? -1 : 1;

  const rdef = 35;
  let r = Math.abs(ex - x) / 2 < rdef ? Math.abs(ex - x) / 2 : rdef;
  r = Math.abs(ey - y) / 2 < r ? Math.abs(ey - y) / 2 : r;

  // HALF of dx here, unlike diagonal (the library's `h` is unused and omitted).
  const w = Math.abs(ex - x) / 2 - r;

  const busX = x + w * xrvs + r * xrvs;
  return (
    `M ${mx} ${my} L ${mx} ${y} L ${x} ${y} L ${x + w * xrvs} ${y} ` +
    `C ${busX} ${y} ${busX} ${y} ${busX} ${y + r * yrvs} ` +
    `L ${busX} ${ey - r * yrvs} ` +
    `C ${busX} ${ey} ${busX} ${ey} ${ex - w * xrvs} ${ey} ` +
    `L ${ex} ${ey}`
  );
}

export interface OrgChartEdgePathInput {
  orientation: Orientation;
  /** The parent's outgoing join point (React Flow sourceX/sourceY). */
  source: Point;
  /** The child anchor, or the compact stub start (React Flow targetX/targetY). */
  target: Point;
  /** Compact cells only: spineTop − target. */
  spineFromTarget?: SpineOffset | null;
  /** d3-org-chart's linkYOffset (default 30). Only used by top/bottom (diagonal). */
  linkYOffset?: number;
}

/**
 * The SVG path d3-org-chart draws for one tree link (d3-org-chart.js:923-947):
 * n = spine top (compact) or child anchor, p = parent join, m = stub start (compact) or n;
 * top/bottom → diagonal(n, p, m, {sy: linkYOffset}); left/right → hdiagonal(n, p, m).
 *
 * The path runs child → parent, like d3-org-chart's (layout-algorithm.md §7.8).
 */
export function orgChartEdgePath(input: OrgChartEdgePathInput): string {
  const { orientation, source, target, spineFromTarget, linkYOffset } = input;
  const n = spineFromTarget
    ? { x: target.x + spineFromTarget.dx, y: target.y + spineFromTarget.dy }
    : target;
  if (orientation === 'left' || orientation === 'right') return hdiagonal(n, source, target);
  return diagonal(n, source, target, { sy: linkYOffset ?? 30 });
}
