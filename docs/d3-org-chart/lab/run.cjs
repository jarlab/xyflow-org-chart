#!/usr/bin/env node
/*
 * Ground-truth harness for d3-org-chart 3.1.1 layout.
 *
 * Runs the REAL OrgChart class (UMD build, node_modules/d3-org-chart/build/d3-org-chart.js,
 * which is byte-for-byte the same logic as src/d3-org-chart.js apart from the module wrapper)
 * under jsdom, renders a synthetic org for every layout x compact combination, waits for the
 * (duration 0) d3 transitions to flush, and dumps per-node layout fields plus the DOM transform
 * that d3-org-chart actually wrote to each <g class="node">.
 *
 * Usage (run `npm install` in this directory first):
 *   node run.cjs                     # all 8 configs + extra fixtures, writes ./fixtures/*.json, prints analysis
 *   node run.cjs --out DIR           # same, but write the JSON files into DIR
 *   node run.cjs --check             # regenerate into a temp dir and byte-compare with ./fixtures (exit 1 on drift)
 *   node run.cjs --layout top --compact true --print   # one config, print table
 *   flags: --no-analyze skips the analysis printout
 *
 * Programmatic:
 *   const { runConfig, DATA } = require('./run.cjs');
 *   const dump = await runConfig({ layout: 'left', compact: true, data: DATA });
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

// All packages resolve from this directory's own node_modules (see package.json).
// d3-org-chart's package.json "exports" hides every subpath (build/*, even package.json), so
// resolve its public entry point and walk up to the package root.
function pkgDir(name) {
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === name) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`cannot find package root of ${name}; run npm install in ${__dirname}`);
    dir = up;
  }
}
const ORGCHART_DIR = pkgDir('d3-org-chart');
const ORGCHART_VERSION = JSON.parse(fs.readFileSync(path.join(ORGCHART_DIR, 'package.json'), 'utf8')).version;
if (ORGCHART_VERSION !== '3.1.1') console.warn(`warning: fixtures were generated with d3-org-chart 3.1.1, found ${ORGCHART_VERSION}`);

// ---------------------------------------------------------------- jsdom globals
// Must exist BEFORE d3-timer / d3-org-chart are loaded: d3-timer captures
// window.requestAnimationFrame at module load (d3-timer/src/timer.js:11) and the
// OrgChart constructor touches document/window (d3-org-chart.js:33, :45).
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true, // gives window.requestAnimationFrame
});
const { window } = dom;

// Polyfills / stubs for APIs jsdom does not implement. None of them influence
// layout math (layout is pure flextree + arithmetic), they only keep render() alive.
const polyfills = [];
function stub(obj, key, val, label) {
  if (!(key in obj) || obj[key] == null) {
    obj[key] = val;
    polyfills.push(label);
  }
}
// Canvas 2D context: OrgChart constructor calls document.createElement('canvas').getContext('2d')
// (d3-org-chart.js:33). jsdom returns null + logs "not implemented"; we return a tiny fake
// so getTextWidth() (only used for connection labels) would not crash.
window.HTMLCanvasElement.prototype.getContext = function () {
  return { font: '', measureText: (t) => ({ width: String(t || '').length * 6 }) };
};
polyfills.push('HTMLCanvasElement.prototype.getContext -> fake {measureText}');
stub(window.SVGElement.prototype, 'getBBox', function () { return { x: 0, y: 0, width: 0, height: 0 }; }, 'SVGElement.prototype.getBBox -> zero box');
stub(window.SVGElement.prototype, 'getComputedTextLength', function () { return 0; }, 'SVGElement.prototype.getComputedTextLength -> 0');
// SVG transform list: d3-transition's attr('transform') tween calls d3-interpolate's
// parseSvg(), which does svgNode.transform.baseVal.consolidate().matrix
// (d3-interpolate/src/transform/parse.js:15). jsdom has no SVGAnimatedTransformList,
// so we parse translate()/scale()/matrix() from the attribute into an affine matrix.
function parseTransformAttr(str) {
  let m = [1, 0, 0, 1, 0, 0]; // a b c d e f
  const mul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
  const re = /(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g;
  let t; let any = false;
  while ((t = re.exec(str || ''))) {
    any = true;
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (t[1] === 'translate') m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
    else if (t[1] === 'scale') m = mul(m, [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]);
    else if (t[1] === 'matrix') m = mul(m, a);
    else if (t[1] === 'rotate') { const r = (a[0] * Math.PI) / 180; m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]); }
  }
  if (!any) return null;
  return { matrix: { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] } };
}
if (!('transform' in window.SVGElement.prototype)) {
  Object.defineProperty(window.SVGElement.prototype, 'transform', {
    configurable: true,
    get() { const el = this; return { baseVal: { consolidate: () => parseTransformAttr(el.getAttribute('transform')) } }; },
  });
  polyfills.push('SVGElement.prototype.transform.baseVal.consolidate() -> parses transform attribute (needed by d3-interpolate parseSvg for transform transitions)');
}
stub(window, 'matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }), 'window.matchMedia -> never matches');
stub(window, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }, 'window.ResizeObserver -> no-op');

// Expose the browser globals d3 + d3-org-chart reach for.
for (const k of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement',
  'Node', 'NodeFilter', 'XMLSerializer', 'requestAnimationFrame', 'cancelAnimationFrame',
  'getComputedStyle', 'Event', 'MouseEvent', 'CustomEvent']) {
  if (k === 'window') global.window = window;
  else if (window[k] !== undefined) {
    try { global[k] = typeof window[k] === 'function' && /^[a-z]/.test(k) ? window[k].bind(window) : window[k]; }
    catch (e) { Object.defineProperty(global, k, { value: window[k], configurable: true, writable: true }); }
  }
}

// ---------------------------------------------------------------- load REAL OrgChart
// The UMD build is loaded by file path; it has the same layout logic as src/. (On Node
// >= 20.19 / 22.12, require('d3-org-chart') would also work: it resolves through
// "exports.default" to the ESM src file, and that file's bare 'd3-flextree' import resolves
// through "main" to flextree's UMD build. Only a deep import of d3-flextree/index.js fails.)
// The UMD build's own require('d3-selection') etc. resolve to the d3 v3 ESM packages via
// require(esm) (Node >= 20.19 / 22.12). d3-zoom side-imports
// d3-transition, which installs selection.prototype.transition used by update().
const { OrgChart } = require(path.join(ORGCHART_DIR, 'build', 'd3-org-chart.js'));

// ---------------------------------------------------------------- synthetic org
// root
//  ├─ mA  (5 leaf reports a1..a5; a3 is a wide+tall leaf to test heterogeneous compact grids)
//  ├─ mB  (wide+tall manager 360x200; 2 leaf reports b1,b2 + sub-manager bS with s1..s3)
//  └─ mC  (single leaf report c1 -> never compacted: compact needs >=2 leaf children)
const DEFAULT_W = 250, DEFAULT_H = 150; // d3-org-chart defaults (d3-org-chart.js:52-53)
const DATA = [
  { id: 'root', parentId: null, name: 'CEO' },
  { id: 'mA', parentId: 'root', name: 'Manager A' },
  { id: 'a1', parentId: 'mA' }, { id: 'a2', parentId: 'mA' },
  { id: 'a3', parentId: 'mA', w: 320, h: 190 },
  { id: 'a4', parentId: 'mA' }, { id: 'a5', parentId: 'mA' },
  { id: 'mB', parentId: 'root', name: 'Manager B', w: 360, h: 200 },
  { id: 'b1', parentId: 'mB' }, { id: 'b2', parentId: 'mB' },
  { id: 'bS', parentId: 'mB', name: 'Sub-manager' },
  { id: 's1', parentId: 'bS' }, { id: 's2', parentId: 'bS' }, { id: 's3', parentId: 'bS' },
  { id: 'mC', parentId: 'root', name: 'Manager C' },
  { id: 'c1', parentId: 'mC' },
];
// Variant: leaf/manager children interleaved under mB (b1, bS, b2). Shows that the compact
// block is anchored at the FIRST leaf's slot and that parent centring uses the pre-compact
// flextree span.
const DATA_INTERLEAVED = DATA.map((d) => ({ ...d }));
{
  const iB2 = DATA_INTERLEAVED.findIndex((d) => d.id === 'b2');
  const [b2] = DATA_INTERLEAVED.splice(iB2, 1);
  const iBS = DATA_INTERLEAVED.findIndex((d) => d.id === 'bS');
  DATA_INTERLEAVED.splice(iBS + 1, 0, b2); // b1, bS, b2 ; s1..s3 still after
}

// Variant: sub-manager listed BEFORE the leaves under mB (bS, b1, b2) -> the compact grid is
// anchored at b1's flextree slot, i.e. to the right of bS.
const DATA_MANAGER_FIRST = DATA.map((d) => ({ ...d }));
{
  const iBS = DATA_MANAGER_FIRST.findIndex((d) => d.id === 'bS');
  const [bS] = DATA_MANAGER_FIRST.splice(iBS, 1);
  const iB1 = DATA_MANAGER_FIRST.findIndex((d) => d.id === 'b1');
  DATA_MANAGER_FIRST.splice(iB1, 0, bS);
}

const MARGINS = { siblingsMargin: 20, childrenMargin: 60, neighbourMargin: 80, compactMarginPair: 100, compactMarginBetween: 20 };

function parseTranslate(t) {
  const m = /translate\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)/.exec(t || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

async function runConfig({ layout, compact, data = DATA }) {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.id = 'chart';
  container.style.width = '1200px';
  container.style.height = '800px';
  document.body.appendChild(container);

  const chart = new OrgChart()
    .container(container)
    .svgWidth(1200)
    .svgHeight(800)
    .data(data.map((d) => ({ ...d }))) // fresh copy: OrgChart mutates rows (_expanded etc.)
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

  chart.render();
  // expandAll(): sets _expanded on every data row and re-renders (d3-org-chart.js:1789-1795)
  chart.expandAll();
  // Let duration(0) transitions flush (d3-timer frame -> transition end) so DOM transforms are final.
  await tick(120);

  const attrs = chart.getChartState();
  const nodes = attrs.root.descendants();

  // DOM ground truth: each g.node's transform (nodeUpdateTransform) + its rect size.
  const domById = {};
  container.querySelectorAll('g.node').forEach((g) => {
    const d = g.__data__;
    const rect = g.querySelector('rect.node-rect');
    domById[d.data.id] = {
      transform: g.getAttribute('transform'),
      translate: parseTranslate(g.getAttribute('transform')),
      rectW: rect ? Number(rect.getAttribute('width')) : null,
      rectH: rect ? Number(rect.getAttribute('height')) : null,
    };
  });

  const out = nodes.map((n) => {
    const dom = domById[n.data.id] || {};
    const tl = dom.translate; // top-left corner of the drawn node in centerG space
    return {
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
      // Drawn box (from the DOM transform written by nodeUpdateTransform, NOT recomputed):
      box: tl ? { left: tl[0], top: tl[1], right: tl[0] + dom.rectW, bottom: tl[1] + dom.rectH } : null,
      domTransform: dom.transform || null,
    };
  });

  const centerG = container.querySelector('g.center-group');
  const result = {
    meta: {
      library: 'd3-org-chart@3.1.1 (UMD build) under jsdom',
      layout, compact,
      margins: MARGINS,
      defaultNodeSize: [DEFAULT_W, DEFAULT_H],
      centerGTransform: centerG ? centerG.getAttribute('transform') : null,
      visibleNodeCount: out.length,
      domNodeCount: container.querySelectorAll('g.node').length,
      fields: 'x,y are the values d3-org-chart stores on the hierarchy node after update() (post flextree, post calculateCompactFlexPositions, post layoutBindings[layout].swap). box = DOM translate() of g.node + rect width/height.',
    },
    nodes: out,
  };
  chart.clear();
  return result;
}

const LAYOUTS = ['top', 'left', 'bottom', 'right'];
const COMPACTS = [true, false];

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  const GOLDEN = path.join(__dirname, 'fixtures');
  const check = args.includes('--check');
  const outDir = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'd3oc-fixtures-')) : get('out') || GOLDEN;
  fs.mkdirSync(outDir, { recursive: true });

  let configs = [];
  for (const layout of LAYOUTS) for (const compact of COMPACTS) configs.push({ layout, compact, name: `${layout}-${compact}`, data: DATA });
  if (get('layout')) configs = configs.filter((c) => c.layout === get('layout'));
  if (get('compact')) configs = configs.filter((c) => String(c.compact) === get('compact'));
  if (!get('layout') && !get('compact')) {
    configs.push({ layout: 'top', compact: true, name: 'extra-top-true-interleaved', data: DATA_INTERLEAVED, dataset: 'DATA_INTERLEAVED' });
    configs.push({ layout: 'top', compact: true, name: 'extra-top-true-managerfirst', data: DATA_MANAGER_FIRST, dataset: 'DATA_MANAGER_FIRST' });
  }

  const written = [];
  for (const c of configs) {
    const dump = await runConfig(c);
    dump.meta.dataset = c.dataset || 'DATA';
    const file = path.join(outDir, `${c.name}.json`);
    fs.writeFileSync(file, JSON.stringify(dump, null, 2));
    written.push(file);
    if (args.includes('--print')) console.table(dump.nodes.map(({ box, domTransform, ...r }) => ({ ...r, flexCompactDim: r.flexCompactDim && r.flexCompactDim.join('x') })));
  }
  console.log('polyfills:', polyfills);
  if (check) {
    // Byte-for-byte comparison of the regenerated dumps against the committed golden files.
    let drift = 0;
    for (const file of written) {
      const name = path.basename(file);
      const golden = path.join(GOLDEN, name);
      const same = fs.existsSync(golden) && fs.readFileSync(golden).equals(fs.readFileSync(file));
      if (!same) drift++;
      console.log(`  ${same ? 'identical' : 'DIFFERS  '} fixtures/${name}`);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
    console.log(drift ? `check FAILED: ${drift} of ${written.length} fixtures differ` : `check OK: ${written.length} fixtures reproduced byte-for-byte`);
    return drift ? 1 : 0;
  }
  console.log('wrote:\n  ' + written.map((f) => (path.relative(process.cwd(), f).startsWith('..') ? f : path.relative(process.cwd(), f))).join('\n  '));
  if (!args.includes('--no-analyze')) require('./analyze.cjs').analyzeAll(written);
  return 0;
}

module.exports = { runConfig, DATA, DATA_INTERLEAVED, DATA_MANAGER_FIRST, MARGINS, polyfills };
if (require.main === module) main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
