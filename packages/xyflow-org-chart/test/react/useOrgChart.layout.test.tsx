// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../../src/core/layout';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { UseOrgChartOptions } from '../../src/react/types';
import type { OrgChartLayout, Orientation } from '../../src/types';
import { inputFor, loadGoldenFixtures, randomInput, ROWS, type Row } from './helpers';

const ORIENTATIONS: Orientation[] = ['top', 'bottom', 'left', 'right'];

function hook<T>(options: UseOrgChartOptions<T>) {
  return renderHook((props: UseOrgChartOptions<T>) => useOrgChart<T>(props), { initialProps: options });
}

/** Asserts that the hook's nodes/edges are exactly `layout` converted to React Flow elements. */
function expectMatchesLayout(result: ReturnType<typeof useOrgChart<Row>>, layout: OrgChartLayout) {
  expect(result.nodes.map((n) => n.id)).toEqual(layout.nodes.map((n) => n.id));
  for (const n of result.nodes) {
    const ln = layout.nodeById.get(n.id)!;
    expect([n.id, n.position]).toEqual([n.id, ln.position]);
    expect([n.id, n.width, n.height]).toEqual([n.id, ln.width, ln.height]);
    expect(n.data).toMatchObject({ depth: ln.depth, parentId: ln.parentId, width: ln.width, height: ln.height });
    expect(n.data.compact).toEqual(ln.compact);
  }
  expect(result.edges.map((e) => e.id)).toEqual(layout.edges.map((e) => e.id));
  for (const e of result.edges) {
    const le = layout.edges.find((x) => x.id === e.id)!;
    expect([e.source, e.target, e.sourceHandle, e.targetHandle]).toEqual([le.source, le.target, le.sourceHandle, le.targetHandle]);
    expect(e.data!.spineFromTarget).toEqual(
      le.spineTop ? { dx: le.spineTop.x - le.targetPoint.x, dy: le.spineTop.y - le.targetPoint.y } : null,
    );
  }
}

describe('useOrgChart: fixed sizes, no animation', () => {
  describe.each(ORIENTATIONS.flatMap((o) => [true, false].map((c) => [o, c] as const)))('%s compact=%s', (orientation, compact) => {
    it('matches layoutOrgChart for the same visible tree (initialExpandLevel 2, variable sizes)', () => {
      const rows: Row[] = ROWS.map((r, i) => ({ ...r, w: 120 + 37 * i, h: 60 + 23 * ((i * 3) % 5) }));
      const { result } = hook<Row>({
        data: rows,
        orientation,
        compact,
        initialExpandLevel: 2,
        nodeSize: (r) => ({ width: r.w!, height: r.h! }),
        animationDuration: 0,
      });
      const visible = ['r', 'a', 'b', 'a1', 'a2', 'b1'];
      const expected = layoutOrgChart(inputFor(rows, visible), { orientation, compact });
      expectMatchesLayout(result.current, expected);
      expect(result.current.orientation).toBe(orientation);
      expect(result.current.layout!.nodes.map((n) => n.position)).toEqual(expected.nodes.map((n) => n.position));
      for (const e of result.current.edges) expect(e.data!.orientation).toBe(orientation);
    });

    it('matches layoutOrgChart on a random 150-node tree with custom margins', () => {
      const input = randomInput(150, orientation.length * 7 + (compact ? 1 : 0));
      const margins = { siblingsMargin: 13, childrenMargin: 41, neighbourMargin: 55, compactMarginPair: 70, compactMarginBetween: 9 };
      const rows: Row[] = input.map((n) => ({ id: n.id, parentId: n.parentId, name: n.id, w: n.width, h: n.height }));
      const { result } = hook<Row>({
        data: rows,
        orientation,
        compact,
        ...margins,
        initialExpandLevel: Infinity,
        nodeSize: (r) => ({ width: r.w!, height: r.h! }),
        animationDuration: 0,
      });
      expectMatchesLayout(result.current, layoutOrgChart(input, { orientation, compact, ...margins }));
    });
  });

  it('reproduces the real d3-org-chart golden fixtures (positions = drawn DOM boxes)', () => {
    const fixtures = loadGoldenFixtures();
    expect(fixtures).toHaveLength(10);
    for (const f of fixtures) {
      const rows = f.nodes.map((n) => ({ id: n.id, parentId: n.parentId, w: n.width, h: n.height }));
      const { result, unmount } = hook({
        data: rows,
        orientation: f.meta.layout,
        compact: f.meta.compact,
        ...f.meta.margins,
        initialExpandLevel: Infinity,
        nodeSize: (r: (typeof rows)[number]) => ({ width: r.w, height: r.h }),
        animationDuration: 0,
      });
      const byId = new Map(result.current.nodes.map((n) => [n.id, n]));
      expect(byId.size).toBe(f.nodes.length);
      for (const fn of f.nodes) {
        const n = byId.get(fn.id)!;
        expect([f.name, fn.id, n.position.x, n.position.y]).toEqual([f.name, fn.id, fn.box.left, fn.box.top]);
      }
      unmount();
    }
  });

  it('fills node data fields from the full hierarchy', () => {
    const { result } = hook<Row>({ data: ROWS, animationDuration: 0, compact: false, initialExpandLevel: 2 });
    const data = Object.fromEntries(result.current.nodes.map((n) => [n.id, n.data]));
    expect(data.r).toMatchObject({
      kind: 'node',
      item: ROWS[0],
      orientation: 'top',
      depth: 0,
      parentId: null,
      width: 250,
      height: 150,
      hasChildren: true,
      expanded: true,
      directReports: 2,
      totalReports: 6,
      hiddenCount: 0,
      compact: null,
    });
    expect(data.a).toMatchObject({ depth: 1, hasChildren: true, expanded: true, directReports: 2, totalReports: 3 });
    // a1 has a child but sits at depth 2 = initialExpandLevel: visible, collapsed.
    expect(data.a1).toMatchObject({ depth: 2, hasChildren: true, expanded: false, directReports: 1, totalReports: 1 });
    expect(data.a2).toMatchObject({ hasChildren: false, expanded: false, directReports: 0, totalReports: 0 });
    expect(data.a2.nextPageCount).toBeUndefined();
    for (const n of result.current.nodes) {
      expect(n.type).toBe('orgChart');
      expect(n.width).toBe(250);
      expect(n.height).toBe(150);
    }
  });

  it('sets compact cell info on the nodes of a compact grid', () => {
    const { result } = hook<Row>({ data: ROWS, animationDuration: 0, compact: true, initialExpandLevel: 2 });
    const a1 = result.current.nodes.find((n) => n.id === 'a1')!;
    expect(a1.data.compact).toMatchObject({ index: 0, even: true, row: 0, firstCellId: 'a1' });
    const a2 = result.current.nodes.find((n) => n.id === 'a2')!;
    expect(a2.data.compact).toMatchObject({ index: 1, even: false, row: 0, firstCellId: 'a1' });
  });

  it('honours nodeType / edgeType / linkYOffset and the default 250×150 size', () => {
    const { result } = hook<Row>({ data: ROWS, animationDuration: 0, nodeType: 'card', edgeType: 'link', linkYOffset: 0 });
    expect(result.current.nodes.every((n) => n.type === 'card' && n.width === 250 && n.height === 150)).toBe(true);
    expect(result.current.edges.every((e) => e.type === 'link' && e.data!.linkYOffset === 0)).toBe(true);
    expect(result.current.edges.every((e) => e.selectable === false && e.focusable === false && !e.hidden)).toBe(true);
  });

  it('accepts numeric ids, custom accessors and "" as the root parent', () => {
    const rows = [
      { key: 1, boss: '' },
      { key: 2, boss: 1 },
      { key: 3, boss: 1 },
    ];
    const { result } = hook({
      data: rows,
      getId: (r: (typeof rows)[number]) => r.key,
      getParentId: (r: (typeof rows)[number]) => r.boss,
      nodeSize: { width: 100, height: 40 },
      animationDuration: 0,
    });
    expect(result.current.error).toBeNull();
    expect(result.current.nodes.map((n) => n.id)).toEqual(['1', '2', '3']);
    expect(result.current.nodes[1].data.parentId).toBe('1');
    expect(result.current.edges.map((e) => e.id)).toEqual(['1->2', '1->3']);
    expect(result.current.nodes[0].width).toBe(100);
  });

  it('relayouts when a layout option changes, and only then', () => {
    const { result, rerender } = hook<Row>({ data: ROWS, animationDuration: 0 });
    expect(result.current.layoutVersion).toBe(1);
    rerender({ data: ROWS, animationDuration: 0, orientation: 'top' });
    expect(result.current.layoutVersion).toBe(1);
    rerender({ data: ROWS, animationDuration: 0, orientation: 'left' });
    expect(result.current.layoutVersion).toBe(2);
    expect(result.current.orientation).toBe('left');
    expectMatchesLayout(result.current, layoutOrgChart(inputFor(ROWS, ['r', 'a', 'b']), { orientation: 'left' }));
    rerender({ data: ROWS, animationDuration: 0, orientation: 'left', nodeSize: { width: 250, height: 150 } });
    expect(result.current.layoutVersion).toBe(2);
    rerender({ data: ROWS, animationDuration: 0, orientation: 'left', nodeSize: { width: 200, height: 150 } });
    expect(result.current.layoutVersion).toBe(3);
    expect(result.current.nodes[0].width).toBe(200);
  });

  // Anchors (x = centre, y = top) printed by the real d3-org-chart 3.1.1 under the lab's jsdom
  // harness: root 300×100, children 180×90 except c3 220×120, minPagingVisibleNodes 3, pagingStep 2.
  // d3-org-chart turns children[3] into the button, so the button keeps c3's 220×120 card.
  it.each([
    [true, [[-160, 160], [160, 160], [-160, 270], [160, 270]]],
    [false, [[-320, 160], [-120, 160], [80, 160], [300, 160]]],
  ])('sizes the paging node like the hidden child it stands for (compact=%s, nodeSize function)', (compact, anchors) => {
    const rows: Row[] = [{ id: 'r', parentId: null, name: 'R', w: 300, h: 100 }];
    for (let i = 0; i < 6; i++) rows.push({ id: `c${i}`, parentId: 'r', name: `C${i}`, w: i === 3 ? 220 : 180, h: i === 3 ? 120 : 90 });
    const { result } = hook<Row>({
      data: rows,
      compact,
      paging: { pageSize: 3, step: 2 },
      nodeSize: (r) => ({ width: r.w!, height: r.h! }),
      animationDuration: 0,
    });
    const layout = result.current.layout!;
    expect(layout.nodes.map((n) => n.id)).toEqual(['r', 'c0', 'c1', 'c2', 'r::more']);
    expect(layout.nodes.slice(1).map((n) => [n.x, n.y])).toEqual(anchors);
    expect(layout.nodeById.get('r::more')).toMatchObject({ width: 220, height: 120 });
  });

  it('keeps an explicit pagingNodeSize, and nodeSize objects, for paging nodes', () => {
    const rows: Row[] = [{ id: 'r', parentId: null, name: 'R' }];
    for (let i = 0; i < 4; i++) rows.push({ id: `c${i}`, parentId: 'r', name: `C${i}` });
    const paging = { pageSize: 2, step: 2 };
    const explicit = hook<Row>({ data: rows, paging, nodeSize: () => ({ width: 90, height: 40 }), pagingNodeSize: { width: 70, height: 30 }, animationDuration: 0 });
    expect(explicit.result.current.layout!.nodeById.get('r::more')).toMatchObject({ width: 70, height: 30 });
    const fixed = hook<Row>({ data: rows, paging, nodeSize: { width: 90, height: 40 }, animationDuration: 0 });
    expect(fixed.result.current.layout!.nodeById.get('r::more')).toMatchObject({ width: 90, height: 40 });
    const none = hook<Row>({ data: rows, paging, animationDuration: 0 });
    expect(none.result.current.layout!.nodeById.get('r::more')).toMatchObject({ width: 250, height: 150 });
  });

  it('applies data-only changes (same geometry) without a relayout', () => {
    const { result, rerender } = hook<Row>({ data: ROWS, animationDuration: 0 });
    const renamed = ROWS.map((r) => (r.id === 'a' ? { ...r, name: 'Renamed' } : r));
    rerender({ data: renamed, animationDuration: 0 });
    expect(result.current.layoutVersion).toBe(1);
    expect(result.current.nodes.find((n) => n.id === 'a')!.data.item).toEqual({ id: 'a', parentId: 'r', name: 'Renamed' });
  });
});

describe('useOrgChart: data errors', () => {
  const cases: [string, Row[], string][] = [
    ['empty', [], 'empty'],
    ['no root', [{ id: 'x', parentId: 'y', name: '' }, { id: 'y', parentId: 'x', name: '' }], 'no-root'],
    ['multiple roots', [{ id: 'x', parentId: null, name: '' }, { id: 'y', parentId: null, name: '' }], 'multiple-roots'],
    ['missing parent', [{ id: 'x', parentId: null, name: '' }, { id: 'y', parentId: 'nope', name: '' }], 'missing-parent'],
    ['duplicate id', [{ id: 'x', parentId: null, name: '' }, { id: 'x', parentId: 'x', name: '' }], 'duplicate-id'],
    [
      'cycle',
      [
        { id: 'r', parentId: null, name: '' },
        { id: 'x', parentId: 'y', name: '' },
        { id: 'y', parentId: 'x', name: '' },
      ],
      'cycle',
    ],
  ];
  it.each(cases)('%s → error set, empty nodes/edges, no throw', (_, data, code) => {
    const { result } = hook<Row>({ data, animationDuration: 0 });
    expect(result.current.error?.name).toBe('OrgChartDataError');
    expect(result.current.error?.code).toBe(code);
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
    expect(result.current.layout).toBeNull();
    expect(result.current.hierarchy).toBeNull();
    // Actions are no-ops.
    expect(() => {
      result.current.toggle('x');
      result.current.expandAll();
      result.current.showMore('x');
    }).not.toThrow();
  });

  it("rows without an id and no getId → 'missing-id', not a confusing duplicate \"undefined\"", () => {
    const rows = [
      { key: 'x', boss: null },
      { key: 'y', boss: 'x' },
    ];
    const { result } = hook({ data: rows, animationDuration: 0 });
    expect(result.current.error?.code).toBe('missing-id');
    expect(result.current.error?.message).toMatch(/getId/);
    expect(result.current.nodes).toEqual([]);
    // Numeric 0 is a valid id.
    const ok = hook({ data: [{ id: 0, parentId: null }, { id: 1, parentId: 0 }], animationDuration: 0 });
    expect(ok.result.current.error).toBeNull();
    expect(ok.result.current.nodes.map((n) => n.id)).toEqual(['0', '1']);
  });

  it('recovers when the data becomes valid, and errors again when it breaks', () => {
    const { result, rerender } = hook<Row>({ data: [{ id: 'x', parentId: 'nope', name: '' }], animationDuration: 400 });
    expect(result.current.error).not.toBeNull();
    rerender({ data: ROWS, animationDuration: 400 });
    expect(result.current.error).toBeNull();
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b']);
    // Nothing was displayed before: the first valid layout appears in place.
    expect(result.current.isAnimating).toBe(false);
    expect(result.current.nodes[1].position).toEqual(result.current.layout!.nodeById.get('a')!.position);
    rerender({ data: [...ROWS, { id: 'r', parentId: null, name: 'dup' }], animationDuration: 400 });
    expect(result.current.error?.code).toBe('duplicate-id');
    expect(result.current.nodes).toEqual([]);
    expect(result.current.layout).toBeNull();
  });
});
