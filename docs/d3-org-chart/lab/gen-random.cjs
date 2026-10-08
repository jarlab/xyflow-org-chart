#!/usr/bin/env node
/*
 * gen-random.cjs: dumps the REAL d3-org-chart 3.1.1 layout of seeded random trees.
 *
 *   node gen-random.cjs                 # writes fixtures-random/layouts.json
 *   node gen-random.cjs --trees 10      # fewer trees (quick look)
 *   node gen-random.cjs --out FILE
 *   node gen-random.cjs --check         # regenerate in memory and byte-compare with the file (exit 1 on drift)
 *
 * It reuses run.cjs's harness (jsdom globals, polyfills, runConfig) via require(), so the charts are
 * rendered exactly like the golden fixtures: render() + expandAll(), default margins (run.cjs MARGINS),
 * nodeWidth = d.data.w, nodeHeight = d.data.h. Every tree is run in the 4 layouts x compact on/off.
 *
 * Tree shapes (1-40 nodes) mix uneven fan-outs: hubs with many leaf siblings, mixed leaf/manager
 * groups, chains, and random attachment. Sizes are per node, width 80-400 and height 50-300:
 * integer sizes, fractional sizes (arbitrary doubles), or mostly-uniform sizes, depending on the tree.
 * Some trees list rows in shuffled order (a child before its parent), which d3.stratify accepts; the
 * child order is then the order of appearance in the rows, which is what layoutOrgChart also uses.
 *
 * Output schema (compact JSON, keep < 1.5 MB):
 * {
 *   meta: { library, generator, seed, margins, layouts, compacts, trees },
 *   trees: [{
 *     seed, shape, sizes,
 *     rows: [[id, parentId|null, w, h], ...]       // the input, in data order
 *     order: [id, ...]                              // root.descendants() (BFS) order, same for every config
 *     configs: {
 *       "top-true": {
 *         x: [...], y: [...],                       // per node, in `order` order
 *         compact: { [id]: [compactEven ? 1 : 0, row, firstCompactNodeId, flexD, flexH] }   // grid cells only
 *       }, ...
 *     }
 *   }]
 * }
 * compact is {} in compact-off configs (the library writes none of the fields then).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { runConfig, MARGINS } = require('./run.cjs');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const TREES = Number(arg('trees', 60));
const OUT = arg('out', path.join(__dirname, 'fixtures-random', 'layouts.json'));
const CHECK = args.includes('--check');
const SEED = 20261008;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = ['random', 'hubs', 'mixed', 'wide', 'chainy'];
const SIZES = ['int', 'float', 'uniform'];

function makeTree(seed) {
  const rnd = mulberry32(seed);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const n = seed % 7 === 0 ? int(1, 4) : int(2, 40);
  const shape = SHAPES[int(0, SHAPES.length - 1)];
  const sizes = SIZES[int(0, SIZES.length - 1)];
  const parents = [null];
  const hubs = [0];
  for (let i = 1; i < n; i++) {
    let p;
    switch (shape) {
      case 'hubs': // a few nodes collect many (mostly leaf) children
        if (rnd() < 0.15 && i > 1) hubs.push(int(0, i - 1));
        p = rnd() < 0.8 ? hubs[int(0, hubs.length - 1)] : int(0, i - 1);
        break;
      case 'mixed': // groups that mix leaves and managers
        p = rnd() < 0.5 ? int(0, Math.min(i - 1, 3)) : int(Math.max(0, i - 6), i - 1);
        break;
      case 'wide': // root-heavy fan-out
        p = rnd() < 0.6 ? 0 : int(0, i - 1);
        break;
      case 'chainy': // long chains with occasional side leaves
        p = rnd() < 0.6 ? i - 1 : int(0, i - 1);
        break;
      default:
        p = int(0, i - 1);
    }
    parents.push(p);
  }
  const size = () => {
    if (sizes === 'uniform') return rnd() < 0.8 ? [250, 150] : [int(80, 400), int(50, 300)];
    if (sizes === 'float') return [80 + rnd() * 320, 50 + rnd() * 250];
    return [int(80, 400), int(50, 300)];
  };
  let rows = parents.map((p, i) => {
    const [w, h] = size();
    return [`n${i}`, p === null ? null : `n${p}`, w, h];
  });
  if (rnd() < 0.25) {
    for (let i = rows.length - 1; i > 0; i--) { const j = int(0, i); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  }
  return { seed, shape, sizes, rows };
}

async function main() {
  const trees = [];
  const t0 = Date.now();
  for (let t = 0; t < TREES; t++) {
    const tree = makeTree(SEED + t * 7919);
    const data = tree.rows.map(([id, parentId, w, h]) => ({ id, parentId, w, h }));
    tree.configs = {};
    for (const layout of ['top', 'left', 'bottom', 'right']) {
      for (const compact of [true, false]) {
        const dump = await runConfig({ layout, compact, data });
        const order = dump.nodes.map((d) => d.id);
        if (!tree.order) tree.order = order;
        else if (order.join() !== tree.order.join()) throw new Error(`tree ${t}: order differs in ${layout}-${compact}`);
        if (dump.nodes.length !== data.length) throw new Error(`tree ${t}: ${dump.nodes.length} of ${data.length} nodes visible`);
        const c = {};
        for (const d of dump.nodes) {
          if (d.width !== data.find((r) => r.id === d.id).w) throw new Error(`tree ${t}: size snapshot mismatch`);
          if (d.flexCompactDim) c[d.id] = [d.compactEven ? 1 : 0, d.row, d.firstCompactNode, d.flexCompactDim[0], d.flexCompactDim[1]];
          else if (d.compactEven !== null || d.firstCompactNode !== null) throw new Error(`tree ${t}: unexpected compact fields on ${d.id}`);
        }
        tree.configs[`${layout}-${compact}`] = { x: dump.nodes.map((d) => d.x), y: dump.nodes.map((d) => d.y), compact: c };
      }
    }
    trees.push(tree);
    process.stderr.write(`\rtree ${t + 1}/${TREES} (${tree.rows.length} nodes, ${tree.shape}/${tree.sizes})   `);
  }
  process.stderr.write('\n');
  const out = {
    meta: {
      library: 'd3-org-chart@3.1.1 (UMD build) under jsdom, via run.cjs runConfig',
      generator: 'gen-random.cjs',
      seed: SEED,
      margins: MARGINS,
      layouts: ['top', 'left', 'bottom', 'right'],
      compacts: [true, false],
      trees: trees.length,
    },
    trees,
  };
  const json = JSON.stringify(out);
  if (CHECK) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (current !== json) {
      console.error(`DRIFT: regenerated output differs from ${OUT}`);
      process.exit(1);
    }
    console.log(`check ok: ${OUT} is identical to a fresh run (${trees.length} trees, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${OUT}: ${trees.length} trees, ${trees.reduce((s, t) => s + t.rows.length, 0)} nodes, ${(json.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
