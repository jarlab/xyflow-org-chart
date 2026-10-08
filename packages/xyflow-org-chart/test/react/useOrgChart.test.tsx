// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutOrgChart } from '../../src/core/layout';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { UseOrgChartOptions } from '../../src/react/types';

interface Row {
  id: string;
  parentId: string | null;
  name: string;
}

const rows: Row[] = [
  { id: 'r', parentId: null, name: 'Root' },
  { id: 'a', parentId: 'r', name: 'A' },
  { id: 'b', parentId: 'r', name: 'B' },
  { id: 'a1', parentId: 'a', name: 'A1' },
  { id: 'a2', parentId: 'a', name: 'A2' },
  { id: 'b1', parentId: 'b', name: 'B1' },
];

function render(options: Partial<UseOrgChartOptions<Row>> = {}) {
  return renderHook((props: Partial<UseOrgChartOptions<Row>>) => useOrgChart<Row>({ data: rows, animationDuration: 0, ...props }), {
    initialProps: options,
  });
}

describe('useOrgChart (no animation)', () => {
  it('lays out the initially visible tree (initialExpandLevel 1) with fixed sizes', () => {
    const { result } = render({ compact: false });
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toEqual(['r', 'a', 'b']);
    const expected = layoutOrgChart(
      [
        { id: 'r', parentId: null, width: 250, height: 150 },
        { id: 'a', parentId: 'r', width: 250, height: 150 },
        { id: 'b', parentId: 'r', width: 250, height: 150 },
      ],
      { compact: false },
    );
    for (const n of result.current.nodes) {
      expect(n.position).toEqual(expected.nodeById.get(n.id)!.position);
      expect(n.width).toBe(250);
      expect(n.height).toBe(150);
      expect(n.type).toBe('orgChart');
    }
    expect(result.current.layoutVersion).toBe(1);
    expect(result.current.edges.map((e) => [e.id, e.sourceHandle, e.targetHandle, e.selectable, e.focusable])).toEqual([
      ['r->a', 's-bottom', 't-top', false, false],
      ['r->b', 's-bottom', 't-top', false, false],
    ]);
    const root = result.current.nodes[0].data;
    expect(root).toMatchObject({ kind: 'node', hasChildren: true, expanded: true, directReports: 2, totalReports: 5 });
    expect(result.current.nodes[1].data).toMatchObject({ expanded: false, directReports: 2, depth: 1, parentId: 'r' });
  });

  it('toggle expands/collapses, bumps layoutVersion and sets lastActionNodeId', () => {
    const { result } = render();
    const toggle = result.current.toggle;
    act(() => result.current.toggle('a'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b', 'a1', 'a2']);
    expect(result.current.layoutVersion).toBe(2);
    expect(result.current.lastActionNodeId).toBe('a');
    expect(result.current.toggle).toBe(toggle);
    act(() => result.current.toggle('a'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b']);
    act(() => result.current.expandAll());
    expect(result.current.nodes).toHaveLength(6);
    expect(result.current.lastActionNodeId).toBeNull();
    act(() => result.current.collapseToLevel(1));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b']);
    act(() => result.current.collapseAll());
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r']);
    act(() => result.current.expand('a1'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b', 'a1', 'a2']);
  });

  it('keeps node object identity (and measured) for unchanged nodes', () => {
    const { result } = render();
    act(() =>
      result.current.onNodesChange([{ type: 'dimensions', id: 'r', dimensions: { width: 250, height: 150 } }]),
    );
    const before = result.current.nodes[0];
    expect(before.measured).toEqual({ width: 250, height: 150 });
    act(() => result.current.toggle('b'));
    const after = result.current.nodes.find((n) => n.id === 'r')!;
    expect(after.measured).toEqual({ width: 250, height: 150 });
  });

  it('after a data-only change, a node change gives a new object only to the changed node', () => {
    const { result, rerender } = render({ initialExpandLevel: 2, animationDuration: 400 });
    rerender({ initialExpandLevel: 2, animationDuration: 400, data: rows.map((r) => ({ ...r, name: `${r.name}!` })) });
    expect(result.current.nodes.every((n) => (n.data.item as Row).name.endsWith('!'))).toBe(true);
    const before = new Map(result.current.nodes.map((n) => [n.id, n]));
    act(() => result.current.onNodesChange([{ type: 'select', id: 'a1', selected: true }]));
    const changed = result.current.nodes.filter((n) => before.get(n.id) !== n).map((n) => n.id);
    expect(changed).toEqual(['a1']);
    expect(result.current.nodes.find((n) => n.id === 'a1')!.selected).toBe(true);
    const selected = new Map(result.current.nodes.map((n) => [n.id, n]));
    rerender({ initialExpandLevel: 2, animationDuration: 400, data: rows.map((r) => ({ ...r, name: `${r.name}!` })) });
    expect(result.current.nodes.every((n) => selected.get(n.id) === n)).toBe(true);
  });

  it('controlled mode reports changes and does not mutate internal state', () => {
    const onChange = vi.fn();
    const { result, rerender } = render({ expandedIds: ['r'], onExpandedIdsChange: onChange });
    act(() => result.current.toggle('a'));
    expect(onChange).toHaveBeenCalledWith(['r', 'a']);
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b']);
    rerender({ expandedIds: ['r', 'a'], onExpandedIdsChange: onChange });
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b', 'a1', 'a2']);
    expect(result.current.lastActionNodeId).toBe('a');
  });

  it('controlled mode: chained actions in one handler compose, like uncontrolled ones', () => {
    const { result } = renderHook(() => {
      const [ids, setIds] = useState<string[]>(['r']);
      return useOrgChart<Row>({ data: rows, animationDuration: 0, expandedIds: ids, onExpandedIdsChange: setIds });
    });
    act(() => {
      result.current.expand('a');
      result.current.expand('b');
    });
    expect([...result.current.expandedIds]).toEqual(['r', 'a', 'b']);
    act(() => {
      result.current.collapse('a');
      result.current.toggle('b');
    });
    expect([...result.current.expandedIds]).toEqual(['r']);
  });

  it('controlled mode: an ignored change does not leak into the next action', async () => {
    const onChange = vi.fn();
    const { result } = render({ expandedIds: ['r'], onExpandedIdsChange: onChange });
    act(() => {
      result.current.expand('a');
      result.current.collapse('r');
    });
    expect(onChange).toHaveBeenLastCalledWith(['a']);
    await Promise.resolve(); // a later event runs in a later task
    act(() => result.current.expand('b'));
    expect(onChange).toHaveBeenLastCalledWith(['r', 'b']);
    expect([...result.current.expandedIds]).toEqual(['r']);
  });

  it('reports data errors without throwing', () => {
    const { result } = render({ data: [{ id: 'x', parentId: 'nope', name: 'X' }] });
    expect(result.current.error?.name).toBe('OrgChartDataError');
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
    expect(result.current.layout).toBeNull();
  });

  it('pages children and hides the edge to the paging node', () => {
    const many: Row[] = [{ id: 'r', parentId: null, name: 'R' }];
    for (let i = 0; i < 7; i++) many.push({ id: `c${i}`, parentId: 'r', name: `C${i}` });
    const { result } = render({ data: many, paging: { pageSize: 2, step: 3 } });
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'c0', 'c1', 'r::more']);
    const more = result.current.nodes[3];
    expect(more.type).toBe('orgChartPaging');
    expect(more.data).toMatchObject({ kind: 'paging', hiddenCount: 5, nextPageCount: 3 });
    expect(result.current.edges.map((e) => e.target)).toEqual(['c0', 'c1']);
    act(() => result.current.showMore('r'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'c0', 'c1', 'c2', 'c3', 'c4', 'r::more']);
    expect(result.current.lastActionNodeId).toBe('r');
    act(() => result.current.reveal('c6'));
    expect(result.current.nodes.map((n) => n.id)).toContain('c6');
  });

  it('compact edges carry the spine offset', () => {
    const { result } = render({ initialExpandLevel: 2 });
    const e = result.current.edges.find((x) => x.target === 'a1')!;
    expect(e.targetHandle).toMatch(/^t-(left|right)$/);
    expect(e.data?.spineFromTarget).not.toBeNull();
    expect(e.data?.linkYOffset).toBe(30);
  });

  it('is stable under inline data/accessors (no relayout, no new nodes array)', () => {
    const { result, rerender } = renderHook(() =>
      useOrgChart<Row>({
        data: rows.map((r) => ({ ...r })),
        getId: (r) => r.id,
        nodeSize: { width: 200, height: 100 },
        animationDuration: 0,
      }),
    );
    const v = result.current.layoutVersion;
    const nodes = result.current.nodes;
    rerender();
    expect(result.current.layoutVersion).toBe(v);
    expect(result.current.nodes.map((n) => n.position)).toEqual(nodes.map((n) => n.position));
  });
});

describe('useOrgChart measure mode', () => {
  it('hides unmeasured nodes until a layout with their measured size is applied', () => {
    const { result } = render({ measure: true, nodeSize: { width: 100, height: 50 } });
    expect(result.current.nodes.every((n) => n.style?.visibility === 'hidden')).toBe(true);
    expect(result.current.nodes[0].width).toBeUndefined();
    const v = result.current.layoutVersion;
    act(() =>
      result.current.onNodesChange([
        { type: 'dimensions', id: 'r', dimensions: { width: 100, height: 50 } },
        { type: 'dimensions', id: 'a', dimensions: { width: 300, height: 80 } },
        { type: 'dimensions', id: 'b', dimensions: { width: 100.3, height: 50 } },
      ]),
    );
    expect(result.current.nodes.every((n) => n.style?.visibility !== 'hidden')).toBe(true);
    expect(result.current.layoutVersion).toBe(v + 1);
    expect(result.current.nodes.find((n) => n.id === 'a')!.data.width).toBe(300);
    // A sub-pixel change does not relayout.
    act(() =>
      result.current.onNodesChange([{ type: 'dimensions', id: 'a', dimensions: { width: 300.2, height: 80 } }]),
    );
    expect(result.current.layoutVersion).toBe(v + 1);
  });
});

describe('useOrgChart animation', () => {
  let now = 0;
  let queue: FrameRequestCallback[] = [];
  const flushFrame = (dt: number) => {
    now += dt;
    const q = queue;
    queue = [];
    act(() => q.forEach((cb) => cb(now)));
  };
  beforeEach(() => {
    now = 0;
    queue = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      queue = [];
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true])('enters children from the parent join point, then settles (StrictMode: %s)', (strict) => {
    const { result } = renderHook(() => useOrgChart<Row>({ data: rows, animationDuration: 400 }), {
      wrapper: strict ? StrictMode : undefined,
    });
    const a = result.current.nodes.find((n) => n.id === 'a')!;
    act(() => result.current.toggle('a'));
    expect(result.current.isAnimating).toBe(true);
    const a1 = result.current.nodes.find((n) => n.id === 'a1')!;
    // top: nodeJoin = (x0 − w/2, y0 + h) as top-left = parent's previous top-left + (0, h)
    expect(a1.position).toEqual({ x: a.position.x, y: a.position.y + 150 });
    expect(a1.style?.opacity).toBe(0);
    flushFrame(200);
    expect(result.current.isAnimating).toBe(true);
    flushFrame(250);
    expect(result.current.isAnimating).toBe(false);
    const target = result.current.layout!.nodeById.get('a1')!.position;
    const settled = result.current.nodes.find((n) => n.id === 'a1')!;
    expect(settled.position).toEqual(target);
    expect(settled.style?.opacity).toBeUndefined();
  });

  it('keeps exiting nodes and their edges until the exit ends', () => {
    const { result } = renderHook(() => useOrgChart<Row>({ data: rows, animationDuration: 400, initialExpandLevel: 2 }));
    expect(result.current.nodes).toHaveLength(6);
    act(() => result.current.toggle('a'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['a1', 'a2']));
    expect(result.current.edges.map((e) => e.target)).toEqual(expect.arrayContaining(['a1', 'a2']));
    flushFrame(500);
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'b1', 'r']);
    expect(result.current.edges.map((e) => e.target).sort()).toEqual(['a', 'b', 'b1']);
    const a = result.current.layout!.nodeById.get('a')!;
    expect(a).toBeDefined();
  });

  it('interrupting restarts from the displayed positions', () => {
    const { result } = renderHook(() => useOrgChart<Row>({ data: rows, animationDuration: 400 }));
    act(() => result.current.toggle('a'));
    flushFrame(200);
    const mid = result.current.nodes.find((n) => n.id === 'a1')!.position;
    act(() => result.current.toggle('b'));
    const restarted = result.current.nodes.find((n) => n.id === 'a1')!.position;
    expect(restarted).toEqual(mid);
    flushFrame(500);
    expect(result.current.isAnimating).toBe(false);
    for (const n of result.current.nodes) expect(n.position).toEqual(result.current.layout!.nodeById.get(n.id)!.position);
  });

  it('honours prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    const { result } = renderHook(() => useOrgChart<Row>({ data: rows, animationDuration: 400 }));
    act(() => result.current.toggle('a'));
    expect(result.current.isAnimating).toBe(false);
    expect(result.current.animationDuration).toBe(0);
    expect(result.current.nodes.find((n) => n.id === 'a1')!.position).toEqual(
      result.current.layout!.nodeById.get('a1')!.position,
    );
  });
});
