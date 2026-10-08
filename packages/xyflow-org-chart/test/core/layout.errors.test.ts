import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../../src/core';
import { DEFAULT_LAYOUT_OPTIONS, OrgChartDataError } from '../../src/types';
import type { LayoutInputNode } from '../../src/types';
import { randomInput } from './helpers';

const node = (id: string, parentId: string | null, width = 250, height = 150): LayoutInputNode => ({
  id,
  parentId,
  width,
  height,
});

function errorOf(nodes: LayoutInputNode[]): OrgChartDataError {
  try {
    layoutOrgChart(nodes);
  } catch (e) {
    expect(e).toBeInstanceOf(OrgChartDataError);
    return e as OrgChartDataError;
  }
  throw new Error('expected an OrgChartDataError');
}

describe('layoutOrgChart input validation', () => {
  it('rejects malformed input with the documented codes', () => {
    expect(errorOf([]).code).toBe('empty');
    expect(errorOf([node('a', 'b'), node('b', 'a')]).code).toBe('no-root');
    expect(errorOf([node('a', null), node('b', null)])).toMatchObject({ code: 'multiple-roots', id: 'b' });
    expect(errorOf([node('a', null), node('b', 'x')])).toMatchObject({ code: 'missing-parent', id: 'b' });
    expect(errorOf([node('a', null), node('a', 'a')])).toMatchObject({ code: 'duplicate-id', id: 'a' });
    expect(errorOf([node('r', null), node('a', 'b'), node('b', 'a')]).code).toBe('cycle');
    expect(errorOf([node('r', null), node('a', 'a')])).toMatchObject({ code: 'cycle', id: 'a' });
  });

  it('lays out a single node at the origin in every orientation', () => {
    for (const orientation of ['top', 'bottom', 'left', 'right'] as const) {
      const l = layoutOrgChart([node('r', null, 200, 100)], { orientation });
      expect(l.nodes[0]).toMatchObject({ x: 0, y: 0, childIds: [], compact: null, depth: 0 });
      expect(Object.is(l.nodes[0].x, 0) && Object.is(l.nodes[0].y, 0)).toBe(true);
      expect(l.edges).toEqual([]);
      expect(l.bounds.width).toBe(200);
      expect(l.bounds.height).toBe(100);
    }
  });

  it('fills defaults and ignores undefined option values', () => {
    const l = layoutOrgChart([node('r', null)], { compact: undefined, siblingsMargin: 5 });
    expect(l.options).toEqual({ ...DEFAULT_LAYOUT_OPTIONS, siblingsMargin: 5 });
  });

  it('accepts children listed before their parent and keeps input order', () => {
    const l = layoutOrgChart([node('b', 'r'), node('a', 'r'), node('r', null)], { compact: false });
    expect(l.nodes.map((n) => n.id)).toEqual(['r', 'b', 'a']);
    expect(l.nodeById.get('b')!.x).toBeLessThan(l.nodeById.get('a')!.x);
  });

  it('two leaves form a compact grid; one leaf does not (§5.1)', () => {
    const two = layoutOrgChart([node('r', null), node('a', 'r'), node('b', 'r')]);
    expect(two.nodeById.get('a')!.compact).toMatchObject({ index: 0, even: true, flexCompactDim: [600, 150] });
    expect(two.nodeById.get('a')!.x).toBe(-175);
    expect(two.nodeById.get('b')!.x).toBe(175);
    const one = layoutOrgChart([node('r', null), node('a', 'r')]);
    expect(one.nodeById.get('a')!.compact).toBeNull();
  });
});

describe('scale', () => {
  it('a 20k-deep chain does not throw', () => {
    const nodes = [node('0', null)];
    for (let i = 1; i < 20_000; i++) nodes.push(node(String(i), String(i - 1)));
    for (const orientation of ['top', 'left'] as const) {
      const l = layoutOrgChart(nodes, { orientation });
      expect(l.nodes).toHaveLength(20_000);
      const last = l.nodeById.get('19999')!;
      // Each level adds the parent's depth size + childrenMargin: 150 + 60 (top), 250 + 60 (left).
      expect(orientation === 'top' ? last.y : last.x).toBe(19_999 * (orientation === 'top' ? 210 : 310));
    }
  });

  it('a 5000-node random tree lays out quickly', () => {
    const nodes = randomInput(5000, 42);
    layoutOrgChart(nodes); // warm-up
    const t0 = performance.now();
    const l = layoutOrgChart(nodes);
    const ms = performance.now() - t0;
    console.log(`5000-node layout: ${ms.toFixed(1)} ms`);
    expect(l.nodes).toHaveLength(5000);
    expect(l.edges).toHaveLength(4999);
    expect(ms).toBeLessThan(500);
  });
});
