'use strict';
/*
 * reference-layout.cjs: an independent reimplementation of the d3-org-chart 3.1.1 layout.
 *
 * Provenance. A "clean-room" agent wrote this from ../layout-algorithm.md alone, without
 * reading the d3-org-chart or d3-flextree sources (only the test datasets were copied from
 * run.cjs). This copy is the round-1 clean-room code, tidied. It transcribes:
 *   - flextree (van der Ploeg non-layered tidy tree) from section 3.4,
 *   - the compact pre-/post-passes from sections 5.3 and 5.11 (the pre-pass uses the
 *     library's form: compactMarginBetween is added per cell inside the row max),
 *   - nodeFlexSize from sections 4.1 / 6:
 *       compact && flexCompactDim ? flexCompactDim : [breadth + siblingsMargin, depth + childrenMargin],
 *       with (breadth, depth) = (w, h) in top/bottom and (h, w) in left/right,
 *   - spacing from section 4.1: same parent -> 0, otherwise neighbourMargin,
 *   - the orientation swap from section 6: bottom y = -y; left x <-> y; right x = -y, y = x.
 * It matched all 10 ground-truth fixtures in fixtures/ exactly (max |dx|, |dy| = 0) on its
 * first run, with no iterations. Re-check with `node check-reference.cjs`.
 * The only dependency is d3-hierarchy (for stratify). It is loaded with require('d3-hierarchy'),
 * which needs require(esm) (Node >= 20.19 / >= 22.12); see layout-algorithm.md 11.2.
 *
 * Options (all optional; defaults are d3-org-chart's):
 *   layout                'top' | 'bottom' | 'left' | 'right'      (default 'top')
 *   compact               boolean                                   (default true)
 *   nodeWidth(node)       drawn card width / height. Like d3-org-chart, they receive the
 *   nodeHeight(node)      d3-hierarchy node (the input row is node.data). Defaults: 250 / 150.
 *                         Each is called once per node; the result is reused everywhere.
 *   siblingsMargin 20, childrenMargin 60, neighbourMargin 80,
 *   compactMarginPair 100, compactMarginBetween 20                 (constants, not accessors)
 *
 * Input: flat rows [{ id, parentId, ... }], one root with parentId null. Pass only the
 * VISIBLE rows; collapsed and paged-out nodes must be filtered out beforehand.
 *
 * Output: one object per node, in root.descendants() (breadth-first) order, the same order
 * as the fixtures' nodes[] (compare by id anyway):
 *   { id, x, y, width, height, compactEven, row, flexCompactDim, firstCompactNode }
 *   - x, y: post-swap coordinates in d3-org-chart's g.center-group space, root at (0,0).
 *     (x, y) is the centre of the card's root-facing edge:
 *       top: (centre, top)  bottom: (centre, bottom)  left: (left, middle)  right: (right, middle)
 *     The card's top-left corner is
 *       top (x - w/2, y)  bottom (x - w/2, y - h)  left (x, y - h/2)  right (x - w, y - h/2).
 *   - width, height: the drawn card size (never swapped).
 *   - compactEven / row / flexCompactDim (array) / firstCompactNode (the first cell's id):
 *     set on compact grid cells; null everywhere else and in non-compact layouts, matching
 *     the fixtures (layout-algorithm.md 5.11).
 */
const { stratify } = require('d3-hierarchy');

// ------------------------------------------------------------------ flextree (doc section 3.4)
// nodeSize(node) -> [xSize, ySize] with margins included; spacing(left, right) -> extra gap.
// Writes node.x = breadth centre and node.y = depth top onto the hierarchy nodes; root at (0,0).
function flextreeLayout(root, nodeSize, spacing) {
  const wrap = (d, parent) => {
    const [xs, ys] = nodeSize(d);
    const w = { d, parent, xs, ys, y: 0, relX: 0, prelim: 0, shift: 0, change: 0,
      lThr: null, rThr: null, lExtRelX: 0, rExtRelX: 0 };
    w.lExt = w; w.rExt = w;
    w.kids = d.children && d.children.length ? d.children.map((c) => wrap(c, w)) : null;
    return w;
  };
  const bottom = (n) => n.y + n.ys;
  const nextL = (n) => (n.kids ? n.kids[0] : n.lThr);
  const nextR = (n) => (n.kids ? n.kids[n.kids.length - 1] : n.rThr);
  const moveSubtree = (s, d) => { s.relX += d; s.lExtRelX += d; s.rExtRelX += d; };
  const distributeExtra = (w, i, si, dist) => {
    const n = i - si;
    if (n > 1) {
      const delta = dist / n;
      w.kids[si + 1].shift += delta; w.kids[i].shift -= delta; w.kids[i].change -= dist - delta;
    }
  };
  const setLThr = (w, i, lC, lSum) => {
    const k0 = w.kids[0], e = k0.lExt;
    e.lThr = lC;
    const diff = lSum - lC.relX - k0.lExtRelX;
    e.relX += diff; e.prelim -= diff;
    k0.lExt = w.kids[i].lExt; k0.lExtRelX = w.kids[i].lExtRelX;
  };
  const setRThr = (w, i, rC, rSum) => {
    const cur = w.kids[i], e = cur.rExt;
    e.rThr = rC;
    const diff = rSum - rC.relX - cur.rExtRelX;
    e.relX += diff; e.prelim -= diff;
    cur.rExt = w.kids[i - 1].rExt; cur.rExtRelX = w.kids[i - 1].rExtRelX;
  };
  const separate = (w, i, lows) => {
    let r = w.kids[i - 1], rSum = r.relX;
    let l = w.kids[i], lSum = l.relX;
    let isFirst = true;
    while (r && l) {
      if (bottom(r) > lows.lowY) lows = lows.next;
      const dist = (rSum + r.prelim + r.xs / 2) - (lSum + l.prelim - l.xs / 2) + spacing(r.d, l.d);
      if (dist > 0 || (dist < 0 && isFirst)) {
        lSum += dist; moveSubtree(w.kids[i], dist); distributeExtra(w, i, lows.index, dist);
      }
      isFirst = false; // unconditional (differs from the Java reference)
      const rb = bottom(r), lb = bottom(l);
      if (rb <= lb) { r = nextR(r); if (r) rSum += r.relX; }
      if (rb >= lb) { l = nextL(l); if (l) lSum += l.relX; }
    }
    if (!r && l) setLThr(w, i, l, lSum);
    else if (r && !l) setRThr(w, i, r, rSum);
  };
  const firstWalk = (w, y) => {
    w.y = y;
    if (!w.kids) return;
    let lows = null;
    w.kids.forEach((k, i) => {
      firstWalk(k, w.y + w.ys);
      const lowY = bottom(i === 0 ? k.lExt : k.rExt); // read BEFORE separate
      if (i > 0) separate(w, i, lows);
      while (lows && lowY >= lows.lowY) lows = lows.next;
      lows = { lowY, index: i, next: lows };
    });
    let s = 0, c = 0;
    for (const k of w.kids) { s += k.shift; c += s + k.change; k.relX += c; }
    const k0 = w.kids[0], kf = w.kids[w.kids.length - 1];
    w.prelim = ((k0.relX + k0.prelim - k0.xs / 2) + (kf.relX + kf.prelim + kf.xs / 2)) / 2;
    w.lExt = k0.lExt; w.lExtRelX = k0.lExtRelX; w.rExt = kf.rExt; w.rExtRelX = kf.rExtRelX;
  };
  const secondWalk = (w, sum) => {
    sum += w.relX;
    w.d.x = sum + w.prelim;
    w.d.y = w.y;
    if (w.kids) w.kids.forEach((k) => secondWalk(k, sum));
  };
  const wr = wrap(root, null);
  firstWalk(wr, 0);
  secondWalk(wr, -wr.relX - wr.prelim);
  return root;
}

// ------------------------------------------------------------------ compact passes (doc 5.3 / 5.11)
// Canonical frame: breadth(n) = sizeColumn, depth(n) = sizeRow.
function rowMaxima(cells, size) {
  const rowMax = new Map();
  for (const c of cells) rowMax.set(c.row, Math.max(rowMax.has(c.row) ? rowMax.get(c.row) : -Infinity, size(c)));
  return rowMax;
}

function compactPrePass(root, { breadth, depth, pair, between }) {
  root.eachBefore((n) => { n.flexCompactDim = n.compactEven = n.firstCompactNode = null; });
  root.eachBefore((n) => {
    if (!n.children || n.children.length < 2) return;
    const cc = n.children.filter((c) => !c.children); // drawn without children
    if (cc.length < 2) return;
    cc.forEach((c, i) => { c.compactEven = i % 2 === 0; c.row = Math.floor(i / 2); c.firstCompactNode = cc[0]; });
    const colW = Math.max(...cc.map(breadth));
    // Library form (:780, :787): margin added per cell inside the row max, then one margin removed.
    let gridH = -between;
    for (const h of rowMaxima(cc, (c) => depth(c) + between).values()) gridH += h;
    cc.forEach((c, i) => { c.flexCompactDim = i === 0 ? [2 * colW + pair, gridH] : [0, 0]; });
    n.flexCompactDim = null; // redundant: already reset above
  });
}

function compactPostPass(root, { depth, pair, between }) {
  root.eachBefore((n) => {
    if (!n.children) return;
    const cc = n.children.filter((c) => c.flexCompactDim);
    if (!cc.length) return;
    const f = cc[0], D = f.flexCompactDim[0], L = f.x - D / 2;
    const leftX = L + D / 4 - pair / 4, rightX = L + (3 * D) / 4 + pair / 4, centerX = L + D / 2;
    cc.forEach((c, i) => { c.x = i % 2 === 0 ? leftX : rightX; });
    const off = n.x - centerX;
    if (Math.abs(off) < 10) cc.forEach((c) => { c.x += off; }); // the |offsetX| < 10 snap
    // Library form (:817-818): row max without margin, margin added after the max.
    const rowMax = rowMaxima(cc, depth);
    const rowTop = {}; let acc = 0;
    [...rowMax.keys()].sort((a, b) => a - b).forEach((r) => { rowTop[r] = acc; acc += rowMax.get(r) + between; });
    const y0 = f.y; // parent.y + parent depth size + childrenMargin
    cc.forEach((c) => { c.y = y0 + rowTop[c.row]; });
  });
}

// ------------------------------------------------------------------ public API
const DEFAULTS = {
  layout: 'top', compact: true,
  nodeWidth: () => 250, nodeHeight: () => 150,
  siblingsMargin: 20, childrenMargin: 60, neighbourMargin: 80,
  compactMarginPair: 100, compactMarginBetween: 20,
};

function layoutOrgChart(rows, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const root = stratify().id((d) => d.id).parentId((d) => d.parentId)(rows);
  // Size snapshot: computed once per node and reused by every pass.
  const size = new Map();
  root.each((n) => size.set(n, { w: o.nodeWidth(n), h: o.nodeHeight(n) }));
  const horiz = o.layout === 'left' || o.layout === 'right';
  const breadth = (n) => (horiz ? size.get(n).h : size.get(n).w);
  const depth = (n) => (horiz ? size.get(n).w : size.get(n).h);
  const compactOpts = { breadth, depth, pair: o.compactMarginPair, between: o.compactMarginBetween };

  if (o.compact) compactPrePass(root, compactOpts);
  const nodeSize = (n) => (o.compact && n.flexCompactDim
    ? n.flexCompactDim
    : [breadth(n) + o.siblingsMargin, depth(n) + o.childrenMargin]);
  flextreeLayout(root, nodeSize, (a, b) => (a.parent === b.parent ? 0 : o.neighbourMargin));
  if (o.compact) compactPostPass(root, compactOpts);

  const nn = (v) => (v === undefined ? null : v);
  return root.descendants().map((n) => {
    let x = n.x, y = n.y; // canonical: x = breadth centre, y = depth top
    switch (o.layout) {
      case 'bottom': y = -y; break;
      case 'left': [x, y] = [y, x]; break;
      case 'right': [x, y] = [-y, x]; break;
      default: break;
    }
    const { w, h } = size.get(n);
    return {
      id: n.id, x, y, width: w, height: h,
      compactEven: nn(n.compactEven),
      row: nn(n.row),
      flexCompactDim: n.flexCompactDim || null,
      firstCompactNode: n.firstCompactNode ? n.firstCompactNode.id : null,
    };
  });
}

module.exports = { layoutOrgChart, flextreeLayout, compactPrePass, compactPostPass, DEFAULTS };
