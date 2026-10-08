/**
 * van der Ploeg's non-layered tidy tree ("flextree"), ported from d3-flextree 2.1.2
 * (layout-algorithm.md §3). Results are bit-identical to the library: every expression keeps the
 * library's operand order, because floating-point addition is not associative.
 *
 * Differences from the library that do not change any number:
 * - sizes are read once per node (the library re-calls nodeSize on every read, §3.6);
 * - all three walks use explicit stacks, so arbitrarily deep chains do not overflow the call stack
 *   (the library throws RangeError past ~1700 levels).
 */

/** [xSize, ySize]: breadth and depth extents of a node's box, margins included. */
export type FlextreeSize = readonly [number, number];

export interface FlextreeOptions<N> {
  /** Child list of a node, in order. null/undefined/[] = leaf. */
  children: (node: N) => readonly N[] | null | undefined;
  /** Called exactly once per node. */
  nodeSize: (node: N) => FlextreeSize;
  /** Extra breadth gap between two horizontally adjacent contour nodes (left, right). Default 0. */
  spacing?: number | ((left: N, right: N) => number);
}

/** x = centre of the node's box on the breadth axis, y = its top on the depth axis. */
export interface FlextreePoint {
  x: number;
  y: number;
}

interface Lows {
  lowY: number;
  index: number;
  next: Lows | null;
}

/** Wrapper node: the fields of d3-flextree's wrapper class (§3.2). */
interface W<N> {
  data: N;
  parent: W<N> | null;
  kids: W<N>[] | null;
  xs: number;
  ys: number;
  x: number;
  y: number;
  relX: number;
  prelim: number;
  shift: number;
  change: number;
  lExt: W<N>;
  lExtRelX: number;
  lThr: W<N> | null;
  rExt: W<N>;
  rExtRelX: number;
  rThr: W<N> | null;
  /** First walk: index of the next child to lay out, and the IYL list of the children so far. */
  next: number;
  lows: Lows | null;
  /** Second walk: the parent's modifier sum and x. */
  prevSum: number;
  parentX: number;
}

/**
 * Lays out `root`'s tree and returns each node's position (root at (0, 0)), keyed by node.
 * Iteration order of the returned map is breadth-first.
 */
export function flextree<N>(root: N, options: FlextreeOptions<N>): Map<N, FlextreePoint> {
  const { children, nodeSize } = options;
  const sp = options.spacing ?? 0;
  const spacing = typeof sp === 'function' ? sp : () => sp;

  const wr = wrapTree(root, children, nodeSize);
  firstWalk(wr, spacing);
  secondWalk(wr);

  const out = new Map<N, FlextreePoint>();
  const queue: W<N>[] = [wr];
  for (let i = 0; i < queue.length; i++) {
    const w = queue[i];
    out.set(w.data, { x: w.x, y: w.y });
    if (w.kids) for (const k of w.kids) queue.push(k);
  }
  return out;
}

function wrapTree<N>(
  root: N,
  children: FlextreeOptions<N>['children'],
  nodeSize: FlextreeOptions<N>['nodeSize'],
): W<N> {
  const make = (data: N, parent: W<N> | null): W<N> => {
    const size = nodeSize(data);
    const w = {
      data,
      parent,
      kids: null,
      xs: size[0],
      ys: size[1],
      x: 0,
      y: 0,
      relX: 0,
      prelim: 0,
      shift: 0,
      change: 0,
      lExtRelX: 0,
      lThr: null,
      rExtRelX: 0,
      rThr: null,
      next: 0,
      lows: null,
      prevSum: 0,
      parentX: 0,
    } as unknown as W<N>;
    w.lExt = w;
    w.rExt = w;
    return w;
  };
  const wr = make(root, null);
  const queue: W<N>[] = [wr];
  for (let i = 0; i < queue.length; i++) {
    const w = queue[i];
    const kids = children(w.data);
    if (kids && kids.length) {
      w.kids = kids.map((k) => make(k, w));
      for (const k of w.kids) queue.push(k);
    }
  }
  return wr;
}

const bottom = <N>(w: W<N>): number => w.y + w.ys;

/** layoutChildren (flextree.js:175-190) as a post-order walk on an explicit stack. */
function firstWalk<N>(wr: W<N>, spacing: (a: N, b: N) => number): void {
  wr.y = 0;
  const stack: W<N>[] = [wr];
  while (stack.length) {
    const w = stack[stack.length - 1];
    const kids = w.kids;
    if (kids && w.next < kids.length) {
      const kid = kids[w.next];
      kid.y = w.y + w.ys;
      stack.push(kid);
      continue;
    }
    stack.pop();
    if (kids) {
      shiftChange(kids);
      positionRoot(w, kids);
    }
    const p = w.parent;
    if (p) {
      // Back in the parent's per-child loop, right after layoutChildren(kid).
      const i = p.next;
      const lowY = bottom(i === 0 ? w.lExt : w.rExt); // read BEFORE separate (§3.3)
      if (i !== 0) separate(p, i, p.lows as Lows, spacing);
      p.lows = updateLows(lowY, i, p.lows);
      p.next = i + 1;
    }
  }
}

/** resolveX (flextree.js:196-209) as a pre-order walk on an explicit stack. */
function secondWalk<N>(wr: W<N>): void {
  wr.prevSum = -wr.relX - wr.prelim;
  wr.parentX = 0;
  const stack: W<N>[] = [wr];
  while (stack.length) {
    const w = stack.pop() as W<N>;
    const sum = w.prevSum + w.relX;
    w.relX = sum + w.prelim - w.parentX;
    w.prelim = 0;
    w.x = w.parentX + w.relX;
    if (w.kids) {
      for (const k of w.kids) {
        k.prevSum = sum;
        k.parentX = w.x;
        stack.push(k);
      }
    }
  }
}

function shiftChange<N>(kids: W<N>[]): void {
  let shiftSum = 0;
  let changeSum = 0;
  for (const child of kids) {
    shiftSum = shiftSum + child.shift;
    changeSum = changeSum + shiftSum + child.change;
    child.relX += changeSum;
  }
}

function separate<N>(w: W<N>, i: number, lowsIn: Lows, spacing: (a: N, b: N) => number): void {
  const kids = w.kids as W<N>[];
  const lSib = kids[i - 1];
  const curSubtree = kids[i];
  let lows: Lows = lowsIn;
  let rContour: W<N> | null = lSib;
  let rSumMods = lSib.relX;
  let lContour: W<N> | null = curSubtree;
  let lSumMods = curSubtree.relX;
  let isFirst = true;
  while (rContour && lContour) {
    if (bottom(rContour) > lows.lowY) lows = lows.next as Lows;
    const dist =
      rSumMods + rContour.prelim - (lSumMods + lContour.prelim) +
      rContour.xs / 2 + lContour.xs / 2 +
      spacing(rContour.data, lContour.data);
    if (dist > 0 || (dist < 0 && isFirst)) {
      lSumMods += dist;
      moveSubtree(curSubtree, dist);
      distributeExtra(kids, i, lows.index, dist);
    }
    isFirst = false; // unconditional, unlike the Java reference (§3.3)
    const rightBottom = bottom(rContour);
    const leftBottom = bottom(lContour);
    if (rightBottom <= leftBottom) {
      rContour = nextRContour(rContour);
      if (rContour) rSumMods += rContour.relX;
    }
    if (rightBottom >= leftBottom) {
      lContour = nextLContour(lContour);
      if (lContour) lSumMods += lContour.relX;
    }
  }
  if (!rContour && lContour) setLThr(kids, i, lContour, lSumMods);
  else if (rContour && !lContour) setRThr(kids, i, rContour, rSumMods);
}

function moveSubtree<N>(subtree: W<N>, distance: number): void {
  subtree.relX += distance;
  subtree.lExtRelX += distance;
  subtree.rExtRelX += distance;
}

function distributeExtra<N>(kids: W<N>[], curSubtreeI: number, leftSibI: number, dist: number): void {
  const curSubtree = kids[curSubtreeI];
  const n = curSubtreeI - leftSibI;
  if (n > 1) {
    const delta = dist / n;
    kids[leftSibI + 1].shift += delta;
    curSubtree.shift -= delta;
    curSubtree.change -= dist - delta;
  }
}

const nextLContour = <N>(w: W<N>): W<N> | null => (w.kids ? w.kids[0] : w.lThr);
const nextRContour = <N>(w: W<N>): W<N> | null => (w.kids ? w.kids[w.kids.length - 1] : w.rThr);

function setLThr<N>(kids: W<N>[], i: number, lContour: W<N>, lSumMods: number): void {
  const firstChild = kids[0];
  const lExt = firstChild.lExt;
  const curSubtree = kids[i];
  lExt.lThr = lContour;
  const diff = lSumMods - lContour.relX - firstChild.lExtRelX;
  lExt.relX += diff;
  lExt.prelim -= diff;
  firstChild.lExt = curSubtree.lExt;
  firstChild.lExtRelX = curSubtree.lExtRelX;
}

function setRThr<N>(kids: W<N>[], i: number, rContour: W<N>, rSumMods: number): void {
  const curSubtree = kids[i];
  const rExt = curSubtree.rExt;
  const lSib = kids[i - 1];
  rExt.rThr = rContour;
  const diff = rSumMods - rContour.relX - curSubtree.rExtRelX;
  rExt.relX += diff;
  rExt.prelim -= diff;
  curSubtree.rExt = lSib.rExt;
  curSubtree.rExtRelX = lSib.rExtRelX;
}

function positionRoot<N>(w: W<N>, kids: W<N>[]): void {
  const k0 = kids[0];
  const kf = kids[kids.length - 1];
  w.prelim = (k0.prelim + k0.relX - k0.xs / 2 + kf.relX + kf.prelim + kf.xs / 2) / 2;
  w.lExt = k0.lExt;
  w.lExtRelX = k0.lExtRelX;
  w.rExt = kf.rExt;
  w.rExtRelX = kf.rExtRelX;
}

function updateLows(lowY: number, index: number, lastLows: Lows | null): Lows {
  let lows = lastLows;
  while (lows !== null && lowY >= lows.lowY) lows = lows.next;
  return { lowY, index, next: lows };
}
