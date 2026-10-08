import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../../src/core';
import type { LayoutEdge, OrgChartLayout } from '../../src/types';
import { fixtureInput, fixtureOptions, loadFixture, loadFixtures, randomInput } from './helpers';

const layoutOf = (name: string) => {
  const f = loadFixture(name);
  return layoutOrgChart(fixtureInput(f), fixtureOptions(f));
};
const edgeTo = (l: OrgChartLayout, id: string): LayoutEdge => l.edges.find((e) => e.target === id)!;

describe('edge anchors: worked numbers from layout-algorithm.md', () => {
  it('top-true, mA grid (§5.7)', () => {
    const l = layoutOf('top-true');
    const a1 = edgeTo(l, 'a1');
    expect(a1).toEqual({
      id: 'mA->a1',
      source: 'mA',
      target: 'a1',
      sourceHandle: 's-bottom',
      targetHandle: 't-right',
      sourcePoint: { x: -767.5, y: 360 },
      targetPoint: { x: -852.5, y: 495 },
      spineTop: { x: -767.5, y: 420 },
    });
    expect(edgeTo(l, 'a2')).toMatchObject({ targetHandle: 't-left', targetPoint: { x: -682.5, y: 495 } });
    // "stubs at y 685 / 665" for row 1, "stub at y 875" for row 2
    expect(edgeTo(l, 'a3').targetPoint).toEqual({ x: -817.5, y: 685 });
    expect(edgeTo(l, 'a4').targetPoint).toEqual({ x: -682.5, y: 665 });
    expect(edgeTo(l, 'a5').targetPoint).toEqual({ x: -852.5, y: 875 });
    for (const id of ['a2', 'a3', 'a4', 'a5']) expect(edgeTo(l, id).spineTop).toEqual({ x: -767.5, y: 420 });
  });

  it('top-true, mB mixed group: spine at the grid centre, 135 px left of mB (§5.7)', () => {
    const l = layoutOf('top-true');
    const b1 = edgeTo(l, 'b1');
    expect(b1.sourcePoint).toEqual({ x: 117.5, y: 410 });
    expect(b1.spineTop).toEqual({ x: -17.5, y: 470 });
    expect(edgeTo(l, 'b2').spineTop).toEqual({ x: -17.5, y: 470 });
    // The sub-manager is a normal child: top-centre target, no spine.
    expect(edgeTo(l, 'bS')).toMatchObject({
      targetHandle: 't-top',
      targetPoint: { x: 417.5, y: 470 },
      spineTop: null,
    });
    // A single leaf is never compacted.
    expect(edgeTo(l, 'c1')).toMatchObject({ targetHandle: 't-top', spineTop: null });
  });

  it('left-true, mA grid is transposed (§5.10)', () => {
    const l = layoutOf('left-true');
    const mA = l.nodeById.get('mA')!;
    const a1 = edgeTo(l, 'a1');
    expect(a1.sourceHandle).toBe('s-right');
    expect(a1.sourcePoint).toEqual({ x: mA.x + mA.width, y: mA.y });
    expect(a1.targetHandle).toBe('t-bottom');
    expect(a1.targetPoint).toEqual({ x: 745, y: -597.5 });
    // spine between the two screen rows -672.5 and -382.5
    expect(a1.spineTop).toEqual({ x: 620, y: -527.5 });
    expect(edgeTo(l, 'a2')).toMatchObject({ targetHandle: 't-top', targetPoint: { x: 745, y: -457.5 } });
  });

  it('bottom and right mirror top and left', () => {
    const top = layoutOf('top-true');
    const bottom = layoutOf('bottom-true');
    const left = layoutOf('left-true');
    const right = layoutOf('right-true');
    for (const e of top.edges) {
      const b = edgeTo(bottom, e.target);
      expect(b.sourcePoint).toEqual({ x: e.sourcePoint.x, y: -e.sourcePoint.y });
      expect(b.targetPoint).toEqual({ x: e.targetPoint.x, y: -e.targetPoint.y + 0 });
      expect(b.spineTop).toEqual(e.spineTop && { x: e.spineTop.x, y: -e.spineTop.y });
      expect(b.sourceHandle).toBe('s-top');
    }
    for (const e of left.edges) {
      const r = edgeTo(right, e.target);
      expect(r.sourcePoint).toEqual({ x: -e.sourcePoint.x, y: e.sourcePoint.y });
      expect(r.targetPoint).toEqual({ x: -e.targetPoint.x, y: e.targetPoint.y });
      expect(r.spineTop).toEqual(e.spineTop && { x: -e.spineTop.x, y: e.spineTop.y });
      expect(r.sourceHandle).toBe('s-left');
    }
  });

  it('no-compact fixtures have plain anchor edges', () => {
    const l = layoutOf('top-false');
    for (const e of l.edges) {
      const c = l.nodeById.get(e.target)!;
      expect(e.targetPoint).toEqual({ x: c.x, y: c.y });
      expect(e.targetHandle).toBe('t-top');
      expect(e.spineTop).toBeNull();
    }
  });
});

const HANDLES = {
  top: { s: 's-bottom', t: 't-top', even: 't-right', odd: 't-left' },
  bottom: { s: 's-top', t: 't-bottom', even: 't-right', odd: 't-left' },
  left: { s: 's-right', t: 't-left', even: 't-bottom', odd: 't-top' },
  right: { s: 's-left', t: 't-right', even: 't-bottom', odd: 't-top' },
} as const;

/** Checks every edge against §7.1 and the spine offsets of §10.5 (which use columnSize/rowOffset). */
function checkEdges(l: OrgChartLayout): void {
  const o = l.options;
  const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
  expect(l.edges.map((e) => e.target)).toEqual(l.nodes.slice(1).map((n) => n.id));
  for (const e of l.edges) {
    const c = l.nodeById.get(e.target)!;
    const p = l.nodeById.get(e.source)!;
    expect(c.parentId).toBe(p.id);
    expect(e.id).toBe(`${p.id}->${c.id}`);
    const h = HANDLES[o.orientation];
    expect(e.sourceHandle).toBe(h.s);
    const join = {
      top: { x: p.x, y: p.y + p.height },
      bottom: { x: p.x, y: p.y - p.height },
      left: { x: p.x + p.width, y: p.y },
      right: { x: p.x - p.width, y: p.y },
    }[o.orientation];
    expect(e.sourcePoint).toEqual(join);
    if (!c.compact) {
      expect(e.targetHandle).toBe(h.t);
      expect(e.targetPoint).toEqual({ x: c.x, y: c.y });
      expect(e.spineTop).toBeNull();
      continue;
    }
    const { even, columnSize, rowOffset } = c.compact;
    expect(e.targetHandle).toBe(even ? h.even : h.odd);
    const sign = even ? 1 : -1;
    const dx = e.spineTop!.x - e.targetPoint.x;
    const dy = e.spineTop!.y - e.targetPoint.y;
    const across = (columnSize / 2 + o.compactMarginPair / 2) * sign;
    switch (o.orientation) {
      case 'top':
        close(dx, across - (sign * c.width) / 2);
        close(dy, -(rowOffset + c.height / 2));
        break;
      case 'bottom':
        close(dx, across - (sign * c.width) / 2);
        close(dy, rowOffset + c.height / 2);
        break;
      case 'left':
        close(dy, across - (sign * c.height) / 2);
        close(dx, -(rowOffset + c.width / 2));
        break;
      case 'right':
        close(dy, across - (sign * c.height) / 2);
        close(dx, rowOffset + c.width / 2);
        break;
    }
  }
}

describe('edge invariants', () => {
  for (const f of loadFixtures()) {
    it(`${f.name}: anchors, handles and spine offsets (§7.1, §10.5)`, () => {
      checkEdges(layoutOrgChart(fixtureInput(f), fixtureOptions(f)));
    });
  }
  it('random trees in every orientation', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const input = randomInput(5 + seed * 3, seed);
      for (const orientation of ['top', 'bottom', 'left', 'right'] as const) {
        for (const compact of [true, false]) checkEdges(layoutOrgChart(input, { orientation, compact }));
      }
    }
  });
});
