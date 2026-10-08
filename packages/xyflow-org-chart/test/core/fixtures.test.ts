import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../../src/core';
import { fixtureInput, fixtureOptions, loadFixtures } from './helpers';

const fixtures = loadFixtures();

describe('golden fixtures (real d3-org-chart 3.1.1)', () => {
  it('has all 10 fixtures', () => {
    expect(fixtures).toHaveLength(10);
  });

  for (const f of fixtures) {
    describe(f.name, () => {
      const layout = layoutOrgChart(fixtureInput(f), fixtureOptions(f));

      it('keeps breadth-first order, depth, parent and child links', () => {
        expect(layout.nodes.map((n) => n.id)).toEqual(f.nodes.map((n) => n.id));
        for (const fn of f.nodes) {
          const n = layout.nodeById.get(fn.id)!;
          expect(n.depth).toBe(fn.depth);
          expect(n.parentId).toBe(fn.parentId);
          expect(n.childIds).toEqual(f.nodes.filter((c) => c.parentId === fn.id).map((c) => c.id));
        }
      });

      it('reproduces x/y exactly', () => {
        for (const fn of f.nodes) {
          const n = layout.nodeById.get(fn.id)!;
          expect([fn.id, n.x, n.y]).toEqual([fn.id, fn.x, fn.y]);
        }
      });

      it('position equals the drawn DOM box', () => {
        for (const fn of f.nodes) {
          const n = layout.nodeById.get(fn.id)!;
          expect([fn.id, n.position.x, n.position.y]).toEqual([fn.id, fn.box.left, fn.box.top]);
          expect(n.position.x + n.width).toBe(fn.box.right);
          expect(n.position.y + n.height).toBe(fn.box.bottom);
        }
      });

      it('reproduces the compact fields', () => {
        for (const fn of f.nodes) {
          const c = layout.nodeById.get(fn.id)!.compact;
          if (!fn.flexCompactDim) {
            expect(c, fn.id).toBeNull();
            expect(fn.compactEven).toBeNull();
            continue;
          }
          expect(c, fn.id).not.toBeNull();
          expect(c!.even).toBe(fn.compactEven);
          expect(c!.row).toBe(fn.row);
          expect(c!.flexCompactDim).toEqual(fn.flexCompactDim);
          expect(c!.firstCellId).toBe(fn.firstCompactNode);
          expect(c!.row).toBe(Math.floor(c!.index / 2));
          expect(c!.even).toBe(c!.index % 2 === 0);
        }
      });
    });
  }

  it('compact geometry of mA in top-true matches §5.7', () => {
    const f = fixtures.find((x) => x.name === 'top-true')!;
    const l = layoutOrgChart(fixtureInput(f), fixtureOptions(f));
    const a = (id: string) => l.nodeById.get(id)!.compact!;
    expect(a('a1')).toMatchObject({ index: 0, flexCompactDim: [740, 530], columnSize: 320, rowOffset: 0 });
    expect(a('a2')).toMatchObject({ index: 1, flexCompactDim: [0, 0], columnSize: 320, rowOffset: 0 });
    expect(a('a3').rowOffset).toBe(170);
    expect(a('a4').rowOffset).toBe(170);
    expect(a('a5').rowOffset).toBe(380);
    expect(l.bounds).toEqual({
      x: Math.min(...f.nodes.map((n) => n.box.left)),
      y: Math.min(...f.nodes.map((n) => n.box.top)),
      width: Math.max(...f.nodes.map((n) => n.box.right)) - Math.min(...f.nodes.map((n) => n.box.left)),
      height: Math.max(...f.nodes.map((n) => n.box.bottom)) - Math.min(...f.nodes.map((n) => n.box.top)),
    });
  });
});
