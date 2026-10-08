import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../../src/core';
import type { Orientation } from '../../src/types';
import { LAB_DIR } from './helpers';

/** Written by docs/d3-org-chart/lab/gen-random.cjs from the real d3-org-chart (see its header). */
interface RandomDump {
  meta: { margins: Record<string, number>; trees: number };
  trees: {
    seed: number;
    shape: string;
    sizes: string;
    rows: [string, string | null, number, number][];
    order: string[];
    configs: Record<
      string,
      { x: number[]; y: number[]; compact: Record<string, [0 | 1, number, string, number, number]> }
    >;
  }[];
}

const dump = JSON.parse(readFileSync(join(LAB_DIR, 'fixtures-random', 'layouts.json'), 'utf8')) as RandomDump;

describe('random trees vs the real d3-org-chart', () => {
  it('has the dumped trees', () => {
    expect(dump.trees.length).toBeGreaterThanOrEqual(60);
  });

  let compared = 0;
  for (const [t, tree] of dump.trees.entries()) {
    it(`tree ${t} (${tree.rows.length} nodes, ${tree.shape}/${tree.sizes}) in all 8 configs`, () => {
      const input = tree.rows.map(([id, parentId, width, height]) => ({ id, parentId, width, height }));
      for (const [name, expected] of Object.entries(tree.configs)) {
        const [orientation, compact] = name.split('-') as [Orientation, string];
        const l = layoutOrgChart(input, { orientation, compact: compact === 'true', ...dump.meta.margins });
        expect(l.nodes.map((n) => n.id), name).toEqual(tree.order);
        l.nodes.forEach((n, i) => {
          expect([name, n.id, n.x, n.y]).toEqual([name, n.id, expected.x[i], expected.y[i]]);
          const c = expected.compact[n.id];
          if (!c) {
            expect(n.compact, `${name} ${n.id}`).toBeNull();
          } else {
            expect(n.compact, `${name} ${n.id}`).not.toBeNull();
            const { even, row, firstCellId, flexCompactDim } = n.compact!;
            expect([name, n.id, even ? 1 : 0, row, firstCellId, ...flexCompactDim]).toEqual([name, n.id, ...c]);
          }
          compared++;
        });
      }
    });
  }

  it('compared every node', () => {
    expect(compared).toBe(dump.trees.reduce((s, t) => s + t.rows.length * 8, 0));
  });
});
