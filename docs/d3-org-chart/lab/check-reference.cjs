#!/usr/bin/env node
'use strict';
/*
 * check-reference.cjs: compares reference-layout.cjs against the golden fixtures in ./fixtures.
 *
 *   npm install            # only d3-hierarchy is needed for this check
 *   node check-reference.cjs        (or: npm run check-reference)
 *
 * For every fixtures/*.json it re-runs the layout with the fixture's meta.layout, meta.compact and
 * meta.dataset, then compares per node (by id): x and y within 1e-6; width, height, compactEven,
 * row, flexCompactDim and firstCompactNode exactly; and the node order (root.descendants(), BFS).
 * Exits 1 on any mismatch.
 *
 * The datasets, node sizes and margins are copied from run.cjs (not imported, because run.cjs
 * needs jsdom). Only d3-hierarchy is required, loaded by reference-layout.cjs via require(esm).
 */
const path = require('path');
const fs = require('fs');
const { layoutOrgChart } = require('./reference-layout.cjs');

// ---- datasets: keep in sync with DATA / DATA_INTERLEAVED / DATA_MANAGER_FIRST in run.cjs
const DATA = [
  { id: 'root', parentId: null },
  { id: 'mA', parentId: 'root' },
  { id: 'a1', parentId: 'mA' }, { id: 'a2', parentId: 'mA' },
  { id: 'a3', parentId: 'mA', w: 320, h: 190 },
  { id: 'a4', parentId: 'mA' }, { id: 'a5', parentId: 'mA' },
  { id: 'mB', parentId: 'root', w: 360, h: 200 },
  { id: 'b1', parentId: 'mB' }, { id: 'b2', parentId: 'mB' },
  { id: 'bS', parentId: 'mB' },
  { id: 's1', parentId: 'bS' }, { id: 's2', parentId: 'bS' }, { id: 's3', parentId: 'bS' },
  { id: 'mC', parentId: 'root' },
  { id: 'c1', parentId: 'mC' },
];
const moveBefore = (rows, id, beforeId, after = false) => {
  const out = rows.map((d) => ({ ...d }));
  const [row] = out.splice(out.findIndex((d) => d.id === id), 1);
  out.splice(out.findIndex((d) => d.id === beforeId) + (after ? 1 : 0), 0, row);
  return out;
};
const DATASETS = {
  DATA,
  DATA_INTERLEAVED: moveBefore(DATA, 'b2', 'bS', true), // mB's children: b1, bS, b2
  DATA_MANAGER_FIRST: moveBefore(DATA, 'bS', 'b1'),     // mB's children: bS, b1, b2
};

// ---- chart settings: keep in sync with run.cjs (sizes d.data.w || 250 x d.data.h || 150, MARGINS)
const SETTINGS = {
  nodeWidth: (d) => d.data.w || 250,   // receives the d3-hierarchy node, as in d3-org-chart
  nodeHeight: (d) => d.data.h || 150,
  siblingsMargin: 20, childrenMargin: 60, neighbourMargin: 80,
  compactMarginPair: 100, compactMarginBetween: 20,
};

const FIXTURES = path.join(__dirname, 'fixtures');
const TOL = 1e-6;
let failed = 0, total = 0;

for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()) {
  total++;
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
  const { layout, compact, dataset = 'DATA' } = fx.meta;
  const out = layoutOrgChart(DATASETS[dataset], { ...SETTINGS, layout, compact });
  const byId = new Map(out.map((n) => [n.id, n]));
  const errs = [];
  if (out.length !== fx.nodes.length) errs.push(`node count ${out.length} vs ${fx.nodes.length}`);
  for (const e of fx.nodes) {
    const g = byId.get(e.id);
    if (!g) { errs.push(`${e.id} missing`); continue; }
    for (const k of ['x', 'y']) if (!(Math.abs(g[k] - e[k]) <= TOL)) errs.push(`${e.id}.${k} ${g[k]} vs ${e[k]}`);
    for (const k of ['width', 'height', 'compactEven', 'row', 'firstCompactNode']) {
      if (g[k] !== e[k]) errs.push(`${e.id}.${k} ${g[k]} vs ${e[k]}`);
    }
    if (JSON.stringify(g.flexCompactDim) !== JSON.stringify(e.flexCompactDim)) {
      errs.push(`${e.id}.flexCompactDim ${JSON.stringify(g.flexCompactDim)} vs ${JSON.stringify(e.flexCompactDim)}`);
    }
  }
  if (!fx.nodes.every((n, i) => out[i] && out[i].id === n.id)) errs.push('node order differs from root.descendants()');
  const name = file.replace(/\.json$/, '');
  if (errs.length) { failed++; console.log(`MISMATCH ${name}\n  ${errs.join('\n  ')}`); }
  else console.log(`ok       ${name}`);
}

console.log(failed ? `\nFAILED: ${failed} of ${total} fixtures differ` : `\nOK: all ${total} fixtures match`);
process.exitCode = failed ? 1 : 0;
