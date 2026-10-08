import type { CSSProperties } from 'react';
import type { Orientation, Point } from '../../types';
import type { OrgChartFlowNode } from '../types';
import { samePoint, sameNodeData, sameStyle } from './equality';
import { isUnrevealed } from './flowElements';
import { joinTopLeft } from './geometry';

export interface Tween {
  from: Point;
  to: Point;
  fromOpacity: number;
  toOpacity: number;
}

export interface TransitionPlan<T> {
  /** Nodes at t = 0: targets merged into the previous objects, plus exiting nodes. */
  start: OrgChartFlowNode<T>[];
  tweens: Map<string, Tween>;
  /** Nodes kept only for their exit animation; removed by finishTransition. */
  exiting: Set<string>;
}

type FlowNode<T> = OrgChartFlowNode<T>;

function opacityOf(node: { style?: CSSProperties }): number {
  const o = node.style?.opacity;
  return typeof o === 'number' ? o : 1;
}

/** `base` with our animation keys applied; undefined values remove the key. */
function composeStyle(base: CSSProperties | undefined, patch: CSSProperties): CSSProperties | undefined {
  const out: CSSProperties = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof CSSProperties, unknown][]) {
    if (v === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function setOptional<O extends object, K extends keyof O>(obj: O, key: K, value: O[K] | undefined): void {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

/**
 * Merges a target node into the previously displayed object so React Flow's `measured`,
 * `selected` and other internals survive (layout-algorithm.md §10.6). Returns `prev` itself when
 * nothing changed.
 */
export function mergeNode<T>(
  prev: FlowNode<T> | undefined,
  target: FlowNode<T>,
  position: Point,
  opacity: number | undefined,
): FlowNode<T> {
  const style = composeStyle(target.style, { opacity, pointerEvents: undefined });
  if (!prev) {
    const node: FlowNode<T> = { ...target, position };
    setOptional(node, 'style', style);
    return node;
  }
  const data = sameNodeData(prev.data, target.data) ? prev.data : target.data;
  const pos = samePoint(prev.position, position) ? prev.position : position;
  const nextStyle = sameStyle(prev.style, style) ? prev.style : style;
  if (
    prev.type === target.type &&
    prev.data === data &&
    prev.position === pos &&
    prev.style === nextStyle &&
    prev.width === target.width &&
    prev.height === target.height
  ) {
    return prev;
  }
  const node: FlowNode<T> = { ...prev, type: target.type, data, position: pos };
  setOptional(node, 'style', nextStyle);
  setOptional(node, 'width', target.width);
  setOptional(node, 'height', target.height);
  return node;
}

function withFrame<T>(node: FlowNode<T>, position: Point, style: CSSProperties | undefined): FlowNode<T> {
  if (samePoint(node.position, position) && sameStyle(node.style, style)) return node;
  const next: FlowNode<T> = { ...node, position };
  setOptional(next, 'style', style);
  return next;
}

/** Target positions without any transition (first layout, animation off, reduced motion). */
export function instantNodes<T>(prev: readonly FlowNode<T>[], targets: readonly FlowNode<T>[]): FlowNode<T>[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  return targets.map((t) => mergeNode(prevById.get(t.id), t, t.position, undefined));
}

/**
 * Plans the transition from what is displayed now (possibly mid-animation) to a new layout,
 * mimicking d3-org-chart (layout-algorithm.md §8.5, §10.6):
 * - updated nodes tween from their current position;
 * - entering nodes start at the nodeJoin point of their nearest previously displayed ancestor
 *   (its current position) and fade in;
 * - exiting nodes tween to the nodeJoin point of their nearest still-visible ancestor's new
 *   position and fade out.
 * Nodes that were never displayed (unrevealed in measure mode) count as entering.
 */
export function planTransition<T>(
  prev: readonly FlowNode<T>[],
  targets: readonly FlowNode<T>[],
  orientation: Orientation,
): TransitionPlan<T> {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const targetById = new Map(targets.map((n) => [n.id, n]));
  const displayed = (n: FlowNode<T> | undefined): n is FlowNode<T> => !!n && !isUnrevealed(n);
  const sizeOf = (n: FlowNode<T>) => ({ width: n.data.width, height: n.data.height });
  const tweens = new Map<string, Tween>();
  const exiting = new Set<string>();
  const start: FlowNode<T>[] = [];

  const exitNodes: FlowNode<T>[] = [];
  for (const p of prev) {
    if (targetById.has(p.id) || !displayed(p)) continue;
    let anchor: FlowNode<T> | undefined;
    let parentId = p.data.parentId;
    while (parentId !== null) {
      anchor = targetById.get(parentId);
      if (anchor) break;
      parentId = prevById.get(parentId)?.data.parentId ?? null;
    }
    const to = anchor ? joinTopLeft(anchor.position, sizeOf(anchor), orientation) : p.position;
    const fromOpacity = opacityOf(p);
    tweens.set(p.id, { from: p.position, to, fromOpacity, toOpacity: 0 });
    exiting.add(p.id);
    exitNodes.push(withFrame(p, p.position, composeStyle(p.style, { opacity: fromOpacity, pointerEvents: 'none' })));
  }
  // Exiting cards render first, i.e. under the remaining ones.
  start.push(...exitNodes);

  for (const t of targets) {
    const p = prevById.get(t.id);
    if (isUnrevealed(t)) {
      start.push(mergeNode(p, t, t.position, undefined));
      continue;
    }
    let from: Point;
    let fromOpacity: number;
    if (displayed(p)) {
      from = p.position;
      fromOpacity = opacityOf(p);
    } else {
      let anchor: FlowNode<T> | undefined;
      let parentId = t.data.parentId;
      while (parentId !== null) {
        const candidate = prevById.get(parentId);
        if (displayed(candidate)) {
          anchor = candidate;
          break;
        }
        parentId = targetById.get(parentId)?.data.parentId ?? null;
      }
      from = anchor ? joinTopLeft(anchor.position, sizeOf(anchor), orientation) : t.position;
      fromOpacity = 0;
    }
    const moving = !samePoint(from, t.position) || fromOpacity !== 1;
    if (moving) tweens.set(t.id, { from, to: t.position, fromOpacity, toOpacity: 1 });
    start.push(mergeNode(p, t, from, moving ? fromOpacity : undefined));
  }
  return { start, tweens, exiting };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Applies eased progress `k` (0..1) to the displayed nodes, merging into the current objects. */
export function applyFrame<T>(nodes: readonly FlowNode<T>[], plan: TransitionPlan<T>, k: number): FlowNode<T>[] {
  return nodes.map((n) => {
    const tw = plan.tweens.get(n.id);
    if (!tw) return n;
    const position = { x: lerp(tw.from.x, tw.to.x, k), y: lerp(tw.from.y, tw.to.y, k) };
    return withFrame(n, position, composeStyle(n.style, { opacity: lerp(tw.fromOpacity, tw.toOpacity, k) }));
  });
}

/** Final frame: exact target positions, exiting nodes removed, animation styles cleared. */
export function finishTransition<T>(nodes: readonly FlowNode<T>[], plan: TransitionPlan<T>): FlowNode<T>[] {
  const out: FlowNode<T>[] = [];
  for (const n of nodes) {
    if (plan.exiting.has(n.id)) continue;
    const tw = plan.tweens.get(n.id);
    out.push(tw ? withFrame(n, tw.to, composeStyle(n.style, { opacity: undefined })) : n);
  }
  return out;
}

export function sameNodeList<N>(a: readonly N[], b: readonly N[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Same ids, order, boxes, parents and reveal state: a change elsewhere needs no new transition. */
export function sameGeometry<T>(a: readonly FlowNode<T>[], b: readonly FlowNode<T>[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      !samePoint(x.position, y.position) ||
      x.width !== y.width ||
      x.height !== y.height ||
      isUnrevealed(x) !== isUnrevealed(y) ||
      x.data.parentId !== y.data.parentId ||
      x.data.width !== y.data.width ||
      x.data.height !== y.data.height
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The displayed nodes with type and data (not position/style) taken from the targets. Returns
 * `nodes` itself when nothing differs.
 */
export function mergeContent<T>(nodes: FlowNode<T>[], targets: readonly FlowNode<T>[]): FlowNode<T>[] {
  const byId = new Map(targets.map((t) => [t.id, t]));
  let changed = false;
  const out = nodes.map((n) => {
    const t = byId.get(n.id);
    if (!t || (n.type === t.type && sameNodeData(n.data, t.data))) return n;
    changed = true;
    return { ...n, type: t.type, data: sameNodeData(n.data, t.data) ? n.data : t.data };
  });
  return changed ? out : nodes;
}
