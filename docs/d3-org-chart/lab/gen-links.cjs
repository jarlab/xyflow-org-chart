#!/usr/bin/env node
/*
 * Golden data for the link path generators, taken from the REAL d3-org-chart 3.1.1 under jsdom.
 *
 * Writes ./fixtures-links/:
 *   <config>.json    for the same 10 configurations as run.cjs ({top,left,bottom,right}-{true,false}
 *                    plus extra-top-true-interleaved / extra-top-true-managerfirst): every tree
 *                    link's final DOM `d` attribute keyed by its child id (the link datum IS the
 *                    child node, d3-org-chart.js:855, :881-883), plus the node fields needed to
 *                    recompute the anchors of layout-algorithm.md §7.1.
 *   generators.json  the real diagonal / hdiagonal called on seeded random inputs + edge cases.
 *
 * Usage:  node gen-links.cjs            # (re)write fixtures-links/
 *         node gen-links.cjs --check    # regenerate in memory and byte-compare (exit 1 on drift)
 *
 * Final-value check: the update transition (duration 0) tweens `d` with d3's interpolateString,
 * which at t = 1 yields a*0 + b*1 = b for every number, so the DOM value should equal a direct
 * call of the layout binding's diagonal with the inputs update() uses (d3-org-chart.js:923-947).
 * This script makes that direct call for every link and fails if the two differ token-wise
 * (whitespace differs: the DOM keeps the template's layout).
 *
 * Requires run.cjs for the jsdom globals + polyfills (it must be loaded before d3/OrgChart).
 */
'use strict';
const path = require('path');
const fs = require('fs');

const lab = require('./run.cjs'); // installs jsdom globals and polyfills
const { DATA, DATA_INTERLEAVED, DATA_MANAGER_FIRST, MARGINS } = lab;

function pkgDir(name) {
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === name) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`cannot find package root of ${name}`);
    dir = up;
  }
}
// Same module instance as run.cjs (same resolved file -> require cache hit).
const { OrgChart } = require(path.join(pkgDir('d3-org-chart'), 'build', 'd3-org-chart.js'));

const DEFAULT_W = 250, DEFAULT_H = 150;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Path string -> tokens (command letters and numeric strings). */
function tokens(d) {
  return String(d).trim().split(/\s+/);
}
function sameTokens(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    const isCmd = /^[A-Za-z]$/.test(ta[i]);
    if (isCmd ? ta[i] !== tb[i] : !Object.is(Number(ta[i]), Number(tb[i]))) return false;
  }
  return true;
}

function makeChart(container, { layout, compact, data }) {
  // Identical settings to run.cjs runConfig().
  return new OrgChart()
    .container(container)
    .svgWidth(1200)
    .svgHeight(800)
    .data(data.map((d) => ({ ...d })))
    .layout(layout)
    .compact(compact)
    .duration(0)
    .initialExpandLevel(99)
    .nodeWidth((d) => d.data.w || DEFAULT_W)
    .nodeHeight((d) => d.data.h || DEFAULT_H)
    .siblingsMargin(() => MARGINS.siblingsMargin)
    .childrenMargin(() => MARGINS.childrenMargin)
    .neighbourMargin(() => MARGINS.neighbourMargin)
    .compactMarginPair(() => MARGINS.compactMarginPair)
    .compactMarginBetween(() => MARGINS.compactMarginBetween)
    .nodeContent((d) => `<div>${d.data.id}</div>`);
}

function freshContainer() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.id = 'chart';
  container.style.width = '1200px';
  container.style.height = '800px';
  document.body.appendChild(container);
  return container;
}

async function linksForConfig(cfg) {
  const container = freshContainer();
  const chart = makeChart(container, cfg);
  chart.render();
  chart.expandAll();
  await tick(120); // let the duration(0) transitions flush, as run.cjs does

  const attrs = chart.getChartState();
  const B = attrs.layoutBindings[attrs.layout];
  const nodes = attrs.root.descendants();

  const domD = {};
  container.querySelectorAll('path.link').forEach((p) => {
    domD[p.__data__.data.id] = p.getAttribute('d');
  });

  const problems = [];
  const links = nodes.slice(1).map((d) => {
    const id = d.data.id;
    const dom = domD[id];
    if (dom == null) problems.push(`${cfg.name}: no DOM link for ${id}`);
    // Same inputs as update() (d3-org-chart.js:923-947).
    const compactCell = !!(attrs.compact && d.flexCompactDim);
    const n = compactCell
      ? { x: B.compactLinkMidX(d, attrs), y: B.compactLinkMidY(d, attrs) }
      : { x: B.linkX(d), y: B.linkY(d) };
    const p = { x: B.linkParentX(d), y: B.linkParentY(d) };
    const m = compactCell ? { x: B.linkCompactXStart(d), y: B.linkCompactYStart(d) } : n;
    const direct = B.diagonal(n, p, m, { sy: attrs.linkYOffset });
    if (dom != null && !sameTokens(dom, direct)) problems.push(`${cfg.name}: ${id} DOM d differs from direct call\n  dom:    ${dom}\n  direct: ${direct}`);
    return { id, parentId: d.parent.data.id, compactCell, d: dom };
  });
  if (Object.keys(domD).length !== links.length) problems.push(`${cfg.name}: ${Object.keys(domD).length} DOM links vs ${links.length} tree links`);

  const out = {
    meta: {
      library: 'd3-org-chart@3.1.1 (UMD build) under jsdom',
      config: cfg.name,
      layout: cfg.layout,
      compact: cfg.compact,
      dataset: cfg.dataset,
      margins: MARGINS,
      linkYOffset: attrs.linkYOffset,
      fields: 'links[].d is the final DOM d attribute of path.link (post-transition; verified token-equal to layoutBindings[layout].diagonal(n, p, m, {sy: linkYOffset}) with update()\'s inputs). nodes[] are the hierarchy nodes (post-swap x/y) in breadth-first order. compactCell = attrs.compact && !!d.flexCompactDim.',
    },
    nodes: nodes.map((n) => ({
      id: n.data.id,
      parentId: n.parent ? n.parent.data.id : null,
      depth: n.depth,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      compactEven: n.compactEven === undefined ? null : n.compactEven,
      row: n.row === undefined ? null : n.row,
      flexCompactDim: n.flexCompactDim || null,
      firstCompactNode: n.firstCompactNode ? n.firstCompactNode.data.id : null,
    })),
    links,
  };
  chart.clear();

  // Sanity: same node geometry as the committed layout fixture.
  const golden = path.join(__dirname, 'fixtures', `${cfg.name}.json`);
  if (fs.existsSync(golden)) {
    const g = JSON.parse(fs.readFileSync(golden, 'utf8'));
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const n of out.nodes) {
      const o = byId.get(n.id);
      if (!o || o.x !== n.x || o.y !== n.y || o.width !== n.width || o.height !== n.height) problems.push(`${cfg.name}: node ${n.id} differs from fixtures/${cfg.name}.json`);
    }
  }
  return { out, problems };
}

// ---------------------------------------------------------------- generators
// mulberry32: small, deterministic, seedable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSampler(rand) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const coord = () => {
    switch (Math.floor(rand() * 5)) {
      case 0: return Math.round((rand() - 0.5) * 4000); // integers
      case 1: return Math.round((rand() - 0.5) * 4000) / 2; // halves (typical layout values)
      case 2: return (rand() - 0.5) * 4000; // full-precision floats
      case 3: return (rand() - 0.5) * 200; // close together -> radius clamping
      default: return Math.round((rand() - 0.5) * 400) / 4; // quarters
    }
  };
  const near = (v) => {
    // Relation of a target coordinate to a source coordinate: edge cases dominate here.
    switch (Math.floor(rand() * 10)) {
      case 0: return v; // delta 0
      case 1: return v + pick([1e-9, -1e-9, 1e-12, -1e-12, Number.EPSILON, -Number.EPSILON]); // tiny delta
      case 2: return v + pick([0.5, -0.5, 1, -1, 30, -30, 35, -35, 60, -60, 69.9, -69.9, 70, -70, 70.1, -70.1]); // around clamp thresholds
      case 3: return v + (rand() - 0.5) * 140; // within 2*rdef
      default: return coord();
    }
  };
  const point = () => ({ x: coord(), y: coord() });
  const mFor = (s) => {
    switch (Math.floor(rand() * 9)) {
      case 0: return { kind: 'undefined' };
      case 1: return { kind: 'value', m: null };
      case 2: return { kind: 'value', m: { x: null, y: null } };
      case 3: return { kind: 'value', m: { x: null, y: coord() } };
      case 4: return { kind: 'value', m: { x: coord(), y: null } };
      case 5: return { kind: 'value', m: { y: coord() } }; // x undefined
      case 6: return { kind: 'value', m: { x: s.x, y: s.y } }; // non-compact call: m = n
      default: return { kind: 'value', m: { x: near(s.x), y: near(s.y) } };
    }
  };
  const offsets = () => {
    switch (Math.floor(rand() * 6)) {
      case 0: return { kind: 'undefined' }; // default parameter {sy: 0}
      case 1: return { kind: 'value', offsets: { sy: 0 } };
      case 2: return { kind: 'value', offsets: { sy: 30 } };
      case 3: return { kind: 'value', offsets: { sy: -30 } };
      case 4: return { kind: 'value', offsets: {} }; // sy undefined -> NaN in the library
      default: return { kind: 'value', offsets: { sy: pick([15, 45, 60, -60, 0.5, 100]) } };
    }
  };
  return { point, near, mFor, offsets };
}

/** Deterministic hand-written edge cases (same for both generators). */
function edgeCases() {
  const cases = [];
  const S = { x: 10, y: 20 };
  const deltas = [0, 1e-9, -1e-9, 0.5, -0.5, 1, -1, 29.99, 30, 30.01, -30, 35, -35, 60, -60, 70, -70, 140, -140, 1000, -1000];
  for (const dx of deltas) for (const dy of deltas) cases.push({ s: S, t: { x: S.x + dx, y: S.y + dy } });
  const ms = [undefined, null, { x: null, y: null }, { x: 5, y: null }, { x: null, y: 5 }, {}, { x: -3.25, y: 7.5 }];
  const offs = [undefined, { sy: 0 }, { sy: 30 }, { sy: -30 }, {}];
  const out = [];
  for (const c of cases) out.push({ ...c, m: undefined, offsets: undefined });
  for (const m of ms) for (const o of offs) out.push({ s: { x: 0, y: 0 }, t: { x: -220, y: -60 }, m, offsets: o });
  return out;
}

function runGenerators(chart, count) {
  // Call through the layout bindings, exactly as update() does (d3-org-chart.js:946):
  // layoutBindings.top.diagonal = OrgChart.prototype.diagonal bound to the chart (:373), which
  // forwards to state.diagonal(s, t, m, offsets) with this = state (:1278-1281); .left.diagonal is
  // the hdiagonal counterpart (:336, :1272-1275). NOTE: chart.diagonal(...) on the instance is NOT
  // the generator: the attrs-generated getter/setter shadows the prototype method and would SET
  // attrs.diagonal and return the chart.
  const bindings = chart.getChartState().layoutBindings;
  const fns = { diagonal: bindings.top.diagonal, hdiagonal: bindings.left.diagonal };
  const call = (fn, s, t, mWrap, oWrap) => {
    const d = fns[fn](s, t, mWrap.kind === 'undefined' ? undefined : mWrap.m, oWrap.kind === 'undefined' ? undefined : oWrap.offsets);
    if (typeof d !== 'string') throw new Error(`${fn} returned ${typeof d}`);
    return d;
  };
  const result = { diagonal: [], hdiagonal: [] };
  for (const [fn, seed] of [['diagonal', 0xd1a6], ['hdiagonal', 0x4d1a]]) {
    const rand = mulberry32(seed);
    const g = makeSampler(rand);
    const list = result[fn];
    for (const e of edgeCases()) {
      const mWrap = e.m === undefined ? { kind: 'undefined' } : { kind: 'value', m: e.m };
      const oWrap = e.offsets === undefined ? { kind: 'undefined' } : { kind: 'value', offsets: e.offsets };
      list.push(sample(fn, e.s, e.t, mWrap, oWrap));
    }
    while (list.length < count) {
      const s = g.point();
      const t = { x: g.near(s.x), y: g.near(s.y) };
      list.push(sample(fn, s, t, g.mFor(s), g.offsets()));
    }
  }
  return result;

  function sample(fn, s, t, mWrap, oWrap) {
    const d = call(fn, s, t, mWrap, oWrap);
    // JSON encoding: an absent key means `undefined`.
    const rec = { s, t };
    if (mWrap.kind !== 'undefined') rec.m = mWrap.m;
    if (oWrap.kind !== 'undefined') rec.offsets = oWrap.offsets;
    rec.d = tokens(d).join(' ');
    return rec;
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const outDir = path.join(__dirname, 'fixtures-links');
  const files = {};
  const problems = [];

  const configs = [];
  for (const layout of ['top', 'left', 'bottom', 'right']) for (const compact of [true, false]) configs.push({ layout, compact, name: `${layout}-${compact}`, data: DATA, dataset: 'DATA' });
  configs.push({ layout: 'top', compact: true, name: 'extra-top-true-interleaved', data: DATA_INTERLEAVED, dataset: 'DATA_INTERLEAVED' });
  configs.push({ layout: 'top', compact: true, name: 'extra-top-true-managerfirst', data: DATA_MANAGER_FIRST, dataset: 'DATA_MANAGER_FIRST' });

  let linkCount = 0;
  for (const cfg of configs) {
    const { out, problems: p } = await linksForConfig(cfg);
    problems.push(...p);
    linkCount += out.links.length;
    files[`${cfg.name}.json`] = JSON.stringify(out, null, 2) + '\n';
  }

  const chart = makeChart(freshContainer(), { layout: 'top', compact: true, data: DATA });
  const gens = runGenerators(chart, 3000);
  files['generators.json'] = JSON.stringify({
    meta: {
      library: 'd3-org-chart@3.1.1 (UMD build) under jsdom',
      fields: 'Each sample: s, t, optional m, optional offsets (an ABSENT key means the argument was undefined; null is null) and d = the real chart.diagonal()/chart.hdiagonal() output with whitespace collapsed to single spaces. Seeded (mulberry32) random inputs plus hand-written edge cases.',
      counts: { diagonal: gens.diagonal.length, hdiagonal: gens.hdiagonal.length },
    },
    diagonal: gens.diagonal,
    hdiagonal: gens.hdiagonal,
  }) + '\n';

  if (problems.length) {
    console.error('PROBLEMS:\n' + problems.join('\n'));
    return 1;
  }
  if (check) {
    let drift = 0;
    for (const [name, text] of Object.entries(files)) {
      const f = path.join(outDir, name);
      const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text;
      if (!same) drift++;
      console.log(`  ${same ? 'identical' : 'DIFFERS  '} fixtures-links/${name}`);
    }
    console.log(drift ? `check FAILED: ${drift} files differ` : `check OK: ${Object.keys(files).length} files reproduced byte-for-byte`);
    return drift ? 1 : 0;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), text);
  console.log(`wrote ${Object.keys(files).length} files to ${path.relative(process.cwd(), outDir) || outDir}: ${linkCount} tree links (all DOM d == direct binding call), ${gens.diagonal.length} diagonal + ${gens.hdiagonal.length} hdiagonal samples`);
  return 0;
}

if (require.main === module) main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
