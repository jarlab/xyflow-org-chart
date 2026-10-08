/**
 * End to end against the REAL d3-org-chart 3.1.1: rows → layoutOrgChart → the anchors the React
 * edge receives → orgChartEdgePath must reproduce every link `d` the library drew in the DOM
 * (docs/d3-org-chart/lab/fixtures-links, recorded by gen-links.cjs), token for token.
 *
 * The geometry block checks the assumption OrgChartEdge relies on: a zero-size handle with the
 * edge's handle id, placed on the card box (`position` + size), sits exactly on the edge's
 * sourcePoint / targetPoint, so React Flow's sourceX/Y and targetX/Y are d3-org-chart's anchors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../src/core';
import { orgChartEdgePath } from '../src/paths';
import type { HandleId, LayoutInputNode, LayoutNode, Orientation, Point } from '../src/types';
import { LAB_DIR, fixtureInput, fixtureOptions, loadFixtures } from './core/helpers';
import { diffPaths } from './paths/tokens';

interface LinksFixture {
  meta: { config: string; linkYOffset: number };
  links: { id: string; parentId: string; compactCell: boolean; d: string }[];
}

interface RandomLayouts {
  meta: { margins: Record<string, number>; layouts: Orientation[]; compacts: boolean[] };
  trees: { seed: number; rows: [string, string | null, number, number][] }[];
}

const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(LAB_DIR, ...parts), 'utf8')) as T;

/** Where a zero-size handle on `side` of the card box sits (React Flow's handle-bounds rule). */
function handlePoint(n: LayoutNode, handle: HandleId): Point {
  const { x, y } = n.position;
  switch (handle.slice(2)) {
    case 'top':
      return { x: x + n.width / 2, y };
    case 'right':
      return { x: x + n.width, y: y + n.height / 2 };
    case 'bottom':
      return { x: x + n.width / 2, y: y + n.height };
    default:
      return { x, y: y + n.height / 2 };
  }
}

const FIXTURES = loadFixtures();

it('covers all 10 golden configs', () => {
  expect(FIXTURES.map((f) => f.name)).toHaveLength(10);
});

describe.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (name, fx) => {
  const layout = layoutOrgChart(fixtureInput(fx), fixtureOptions(fx));
  const links = readJson<LinksFixture>('fixtures-links', `${name}.json`);
  const dById = new Map(links.links.map((l) => [l.id, l.d]));

  it('has one edge per recorded DOM link', () => {
    expect(links.meta.linkYOffset).toBe(30);
    expect(layout.edges.map((e) => e.target).sort()).toEqual([...dById.keys()].sort());
  });

  it.each(layout.edges.map((e) => [e.id, e] as const))('%s: path equals the DOM d', (_id, edge) => {
    const spineFromTarget = edge.spineTop
      ? { dx: edge.spineTop.x - edge.targetPoint.x, dy: edge.spineTop.y - edge.targetPoint.y }
      : null;
    const path = orgChartEdgePath({
      orientation: fx.meta.layout,
      source: edge.sourcePoint,
      target: edge.targetPoint,
      spineFromTarget,
      linkYOffset: 30,
    });
    expect(diffPaths(path, dById.get(edge.target)!)).toBeNull();
  });

  it('every edge endpoint is exactly where its zero-size handle sits on the card box', () => {
    for (const e of layout.edges) {
      expect(handlePoint(layout.nodeById.get(e.source)!, e.sourceHandle), `${e.id} source`).toEqual(e.sourcePoint);
      expect(handlePoint(layout.nodeById.get(e.target)!, e.targetHandle), `${e.id} target`).toEqual(e.targetPoint);
    }
  });
});

describe('handle geometry on random real-library trees', () => {
  const random = readJson<RandomLayouts>('fixtures-random', 'layouts.json');

  it.each(random.meta.layouts.flatMap((l) => random.meta.compacts.map((c) => [l, c] as const)))(
    '%s compact=%s: every endpoint equals its handle point exactly',
    (orientation, compact) => {
      let checked = 0;
      for (const tree of random.trees) {
        const input: LayoutInputNode[] = tree.rows.map(([id, parentId, width, height]) => ({ id, parentId, width, height }));
        const layout = layoutOrgChart(input, { ...random.meta.margins, orientation, compact });
        for (const e of layout.edges) {
          for (const [nodeId, handle, point] of [
            [e.source, e.sourceHandle, e.sourcePoint],
            [e.target, e.targetHandle, e.targetPoint],
          ] as const) {
            const h = handlePoint(layout.nodeById.get(nodeId)!, handle);
            // == rather than Object.is: a -0 vs 0 difference is not a geometric one.
            expect(h.x === point.x && h.y === point.y, `${e.id} ${handle}: (${h.x}, ${h.y}) vs (${point.x}, ${point.y})`).toBe(true);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
    },
  );
});
