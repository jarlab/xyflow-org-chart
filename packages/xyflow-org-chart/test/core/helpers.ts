import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { LayoutInputNode, OrgChartLayoutOptions, Orientation } from '../../src/types';

export const LAB_DIR = fileURLToPath(new URL('../../../../docs/d3-org-chart/lab/', import.meta.url));

export interface FixtureNode {
  id: string;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  compactEven: boolean | null;
  row: number | null;
  flexCompactDim: [number, number] | null;
  firstCompactNode: string | null;
  box: { left: number; top: number; right: number; bottom: number };
}

export interface Fixture {
  name: string;
  meta: {
    layout: Orientation;
    compact: boolean;
    margins: Omit<OrgChartLayoutOptions, 'orientation' | 'compact'>;
  };
  nodes: FixtureNode[];
}

export function loadFixtures(): Fixture[] {
  const dir = join(LAB_DIR, 'fixtures');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }) as Fixture);
}

export function loadFixture(name: string): Fixture {
  const f = loadFixtures().find((x) => x.name === name);
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}

/** BFS order preserves sibling order, so the fixture's nodes[] is a valid layout input. */
export function fixtureInput(f: Fixture): LayoutInputNode[] {
  return f.nodes.map((n) => ({ id: n.id, parentId: n.parentId, width: n.width, height: n.height }));
}

export function fixtureOptions(f: Fixture): Partial<OrgChartLayoutOptions> {
  return { orientation: f.meta.layout, compact: f.meta.compact, ...f.meta.margins };
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random tree as layout input: n nodes, each attached to a random earlier node (biased to recent ones). */
export function randomInput(n: number, seed: number): LayoutInputNode[] {
  const r = rng(seed);
  const out: LayoutInputNode[] = [{ id: 'n0', parentId: null, width: 250, height: 150 }];
  for (let i = 1; i < n; i++) {
    const p = r() < 0.5 ? Math.floor(r() * i) : Math.max(0, i - 1 - Math.floor(r() * 10));
    out.push({ id: `n${i}`, parentId: `n${p}`, width: 80 + Math.floor(r() * 320), height: 50 + Math.floor(r() * 250) });
  }
  return out;
}
