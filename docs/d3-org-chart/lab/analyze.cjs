#!/usr/bin/env node
/*
 * Analyse d3-org-chart layout dumps produced by run.cjs.
 *
 *   node analyze.cjs                  # every fixtures/*.json next to this file
 *   node analyze.cjs some/dir/*.json  # explicit files
 *
 * 1. Convention check: recompute each node's drawn box from (x, y, width, height) with the
 *    per-layout convention below and compare to the DOM box (translate() written by
 *    layoutBindings[layout].nodeUpdateTransform, d3-org-chart.js:338/375/413/447).
 * 2. Overlap check: every pair of boxes, strict positive-area intersection = overlap.
 * 3. Gaps: sibling / cousin gaps along the cross axis, parent->child gap along the main axis.
 * 4. Compact grids: columns, rows, offsets.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Box convention per layout, derived from nodeUpdateTransform:
//   top    translate(x - w/2, y)       -> x = horizontal CENTER, y = TOP edge
//   bottom translate(x - w/2, y - h)   -> x = horizontal CENTER, y = BOTTOM edge
//   left   translate(x, y - h/2)       -> x = LEFT edge,          y = vertical CENTER
//   right  translate(x - w, y - h/2)   -> x = RIGHT edge,         y = vertical CENTER
const CONVENTION = {
  top: (n) => ({ left: n.x - n.width / 2, top: n.y, right: n.x + n.width / 2, bottom: n.y + n.height }),
  bottom: (n) => ({ left: n.x - n.width / 2, top: n.y - n.height, right: n.x + n.width / 2, bottom: n.y }),
  left: (n) => ({ left: n.x, top: n.y - n.height / 2, right: n.x + n.width, bottom: n.y + n.height / 2 }),
  right: (n) => ({ left: n.x - n.width, top: n.y - n.height / 2, right: n.x, bottom: n.y + n.height / 2 }),
};
// main axis = parent->child direction; cross axis = sibling direction
const AXES = {
  top: { cross: ['left', 'right'], main: ['top', 'bottom'], dir: +1 },
  bottom: { cross: ['left', 'right'], main: ['top', 'bottom'], dir: -1 },
  left: { cross: ['top', 'bottom'], main: ['left', 'right'], dir: +1 },
  right: { cross: ['top', 'bottom'], main: ['left', 'right'], dir: -1 },
};
const EPS = 1e-6;
const r2 = (v) => Math.round(v * 100) / 100;

function boxesOf(dump) {
  const layout = dump.meta.layout;
  return dump.nodes.map((n) => ({ ...n, cbox: CONVENTION[layout](n) }));
}

function conventionCheck(dump) {
  const bad = [];
  for (const n of boxesOf(dump)) {
    if (!n.box) { bad.push(`${n.id}: no DOM box`); continue; }
    for (const k of ['left', 'top', 'right', 'bottom']) {
      if (Math.abs(n.box[k] - n.cbox[k]) > EPS) bad.push(`${n.id}.${k}: dom=${n.box[k]} conv=${n.cbox[k]}`);
    }
  }
  return bad;
}

function overlapCheck(dump) {
  const ns = boxesOf(dump);
  const overlaps = [];
  let minSep = { d: Infinity };
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i].cbox, b = ns[j].cbox;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left); // >0 => x-ranges overlap
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > EPS && iy > EPS) overlaps.push({ a: ns[i].id, b: ns[j].id, ix: r2(ix), iy: r2(iy) });
      // separation = the larger of the two axis gaps (negative intersection = gap)
      const sep = Math.max(-ix, -iy);
      if (sep < minSep.d) minSep = { d: r2(sep), a: ns[i].id, b: ns[j].id, axis: -ix >= -iy ? 'x' : 'y' };
    }
  }
  return { overlaps, minSep };
}

function gapReport(dump) {
  const layout = dump.meta.layout;
  const ax = AXES[layout];
  const ns = boxesOf(dump);
  const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
  const [c0, c1] = ax.cross, [m0, m1] = ax.main;
  const lines = [];

  // parent -> child main-axis gap (child near edge - parent far edge)
  const pc = [];
  for (const n of ns) {
    if (!n.parentId) continue;
    const p = byId[n.parentId];
    const gap = ax.dir > 0 ? n.cbox[m0] - p.cbox[m1] : p.cbox[m0] - n.cbox[m1];
    pc.push(`${n.parentId}->${n.id}:${r2(gap)}`);
  }
  lines.push(`  parent->child main-axis gaps: ${pc.join(' ')}`);

  // same-depth neighbours along the cross axis whose main-axis ranges overlap (same "band")
  const depths = [...new Set(ns.map((n) => n.depth))].sort();
  for (const d of depths) {
    const row = ns.filter((n) => n.depth === d).sort((a, b) => a.cbox[c0] - b.cbox[c0] || a.cbox[m0] - b.cbox[m0]);
    const pairs = [];
    for (let i = 0; i < row.length; i++) {
      for (let j = i + 1; j < row.length; j++) {
        const a = row[i], b = row[j];
        const mOverlap = Math.min(a.cbox[m1], b.cbox[m1]) - Math.max(a.cbox[m0], b.cbox[m0]);
        if (mOverlap <= EPS) continue; // not in the same band (e.g. different compact rows)
        // only the immediate next box in this band
        const between = row.slice(i + 1, j).some((c) =>
          Math.min(a.cbox[m1], c.cbox[m1]) - Math.max(a.cbox[m0], c.cbox[m0]) > EPS);
        if (between) continue;
        const rel = a.parentId === b.parentId ? 'sib' : 'cousin';
        pairs.push(`${a.id}|${b.id}(${rel})=${r2(b.cbox[c0] - a.cbox[c1])}`);
        break;
      }
    }
    if (pairs.length) lines.push(`  depth ${d} cross gaps: ${pairs.join(' ')}`);
    const mains = [...new Set(row.map((n) => r2(ax.dir > 0 ? n.cbox[m0] : n.cbox[m1])))];
    lines.push(`  depth ${d} near-edge main coords: ${mains.join(', ')}`);
  }
  return lines;
}

function compactReport(dump) {
  const layout = dump.meta.layout;
  const ax = AXES[layout];
  const ns = boxesOf(dump);
  const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
  const groups = {};
  ns.filter((n) => n.firstCompactNode).forEach((n) => (groups[n.firstCompactNode] = groups[n.firstCompactNode] || []).push(n));
  const lines = [];
  const [c0, c1] = ax.cross, [m0, m1] = ax.main;
  const crossCenter = (b) => (b[c0] + b[c1]) / 2;
  for (const [fc, kids] of Object.entries(groups)) {
    const p = byId[kids[0].parentId];
    const cols = [...new Set(kids.map((k) => r2(crossCenter(k.cbox))))];
    const rows = [...new Set(kids.map((k) => k.row))];
    const ext = { c0: Math.min(...kids.map((k) => k.cbox[c0])), c1: Math.max(...kids.map((k) => k.cbox[c1])),
      m0: Math.min(...kids.map((k) => k.cbox[m0])), m1: Math.max(...kids.map((k) => k.cbox[m1])) };
    lines.push(`  grid under ${p.id} (first=${fc}, flexCompactDim=${byId[fc].flexCompactDim}) ${kids.length} kids, ${cols.length} cols x ${rows.length} rows`);
    lines.push(`    column centres (cross): ${cols.join(', ')}  (parent cross centre ${r2(crossCenter(p.cbox))}; grid drawn extent centre ${r2((ext.c0 + ext.c1) / 2)}, offset ${r2((ext.c0 + ext.c1) / 2 - crossCenter(p.cbox))})`);
    lines.push(`    cells: ${kids.map((k) => `${k.id}[r${k.row},${k.compactEven ? 'even/L' : 'odd/R'}] cross ${r2(k.cbox[c0])}..${r2(k.cbox[c1])} main ${r2(k.cbox[m0])}..${r2(k.cbox[m1])}`).join('; ')}`);
    // column gap per row
    const rg = rows.map((r) => {
      const inRow = kids.filter((k) => k.row === r).sort((a, b) => a.cbox[c0] - b.cbox[c0]);
      return inRow.length === 2 ? `r${r}:${r2(inRow[1].cbox[c0] - inRow[0].cbox[c1])}` : `r${r}:single`;
    });
    lines.push(`    gap between the two columns per row: ${rg.join(' ')}`);
    // row gap per column
    for (const ev of [true, false]) {
      const col = kids.filter((k) => !!k.compactEven === ev).sort((a, b) => a.row - b.row);
      const g = [];
      for (let i = 1; i < col.length; i++) g.push(r2(ax.dir > 0 ? col[i].cbox[m0] - col[i - 1].cbox[m1] : col[i - 1].cbox[m0] - col[i].cbox[m1]));
      if (g.length) lines.push(`    main-axis gap between consecutive rows in ${ev ? 'even/left' : 'odd/right'} column: ${g.join(', ')}`);
    }
  }
  return lines;
}

function analyze(file) {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const name = path.basename(file, '.json');
  const conv = conventionCheck(dump);
  const ov = overlapCheck(dump);
  const out = [];
  out.push(`== ${name} (layout=${dump.meta.layout}, compact=${dump.meta.compact}, nodes=${dump.nodes.length}, centerG=${dump.meta.centerGTransform})`);
  out.push(`  convention check (box from x,y,w,h vs DOM translate): ${conv.length ? 'MISMATCH ' + conv.join('; ') : 'OK for all nodes'}`);
  out.push(`  overlaps: ${ov.overlaps.length ? ov.overlaps.map((o) => `${o.a}x${o.b}(${o.ix}x${o.iy})`).join(', ') : 'none'}; min separation ${ov.minSep.d} between ${ov.minSep.a} & ${ov.minSep.b} (along ${ov.minSep.axis})`);
  out.push(...gapReport(dump));
  out.push(...compactReport(dump));
  return { name, text: out.join('\n'), overlaps: ov.overlaps, minSep: ov.minSep, conv };
}

function analyzeAll(files) {
  const results = files.map(analyze);
  results.forEach((r) => console.log(r.text));
  console.log('\n== OVERLAP SUMMARY');
  results.forEach((r) => console.log(`  ${r.name}: ${r.overlaps.length} overlapping pairs; min separation ${r.minSep.d} (${r.minSep.a}/${r.minSep.b}); convention ${r.conv.length ? 'MISMATCH' : 'OK'}`));
  return results;
}

module.exports = { analyze, analyzeAll, CONVENTION, overlapCheck };
if (require.main === module) {
  const files = process.argv.slice(2);
  const results = analyzeAll(files.length ? files : fs.readdirSync(path.join(__dirname, 'fixtures')).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(__dirname, 'fixtures', f)));
  // Non-zero exit if any fixture has overlapping boxes or breaks the per-layout box convention.
  process.exitCode = results.some((r) => r.overlaps.length || r.conv.length) ? 1 : 0;
}
