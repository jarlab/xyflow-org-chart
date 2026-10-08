// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { OrgChartFlowNode, UseOrgChartOptions, UseOrgChartResult } from '../../src/react/types';
import type { Orientation, Point } from '../../src/types';
import { createFrameClock, ROWS, type Row } from './helpers';

type Opts = Partial<UseOrgChartOptions<Row>>;
type Result = { current: UseOrgChartResult<Row> };

const clock = createFrameClock();
beforeEach(() => clock.install());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function hook(options: Opts = {}) {
  return renderHook((props: Opts) => useOrgChart<Row>({ data: ROWS, animationDuration: 400, ...props }), {
    initialProps: options,
  });
}

const node = (r: Result, id: string): OrgChartFlowNode<Row> => {
  const n = r.current.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
const target = (r: Result, id: string): Point => r.current.layout!.nodeById.get(id)!.position;
const between = (v: number, a: number, b: number) => v > Math.min(a, b) && v < Math.max(a, b);

function expectSettled(r: Result) {
  expect(r.current.isAnimating).toBe(false);
  expect(r.current.nodes.map((n) => n.id)).toEqual(r.current.layout!.nodes.map((n) => n.id));
  for (const n of r.current.nodes) {
    expect([n.id, n.position]).toEqual([n.id, target(r, n.id)]);
    expect(n.style?.opacity).toBeUndefined();
    expect(n.style?.pointerEvents).toBeUndefined();
  }
}

describe('useOrgChart animation', () => {
  it('the first layout appears in place, without frames', () => {
    const { result } = hook();
    expect(result.current.isAnimating).toBe(false);
    expect(clock.queue).toHaveLength(0);
    expectSettled(result);
  });

  it('moves updated nodes through intermediate positions (eased) to the target', () => {
    const { result } = hook({ compact: false, initialExpandLevel: 2 });
    const before = Object.fromEntries(result.current.nodes.map((n) => [n.id, n.position]));
    act(() => result.current.toggle('a'));
    const mover = ['r', 'a', 'b', 'b1'].find((id) => target(result, id).x !== before[id].x)!;
    expect(mover).toBeDefined();
    const b0 = before[mover];
    const b1 = target(result, mover);
    // Layout and version are the target immediately; positions are not.
    expect(result.current.layoutVersion).toBe(2);
    expect(node(result, mover).position).toEqual(b0);
    clock.frame(100);
    const q1 = node(result, mover).position.x;
    clock.frame(100); // t = 0.5 → easeCubicInOut = 0.5
    const half = node(result, mover).position.x;
    expect(half).toBeCloseTo((b0.x + b1.x) / 2, 9);
    expect(between(q1, b0.x, half)).toBe(true);
    clock.frame(100);
    expect(between(node(result, mover).position.x, half, b1.x)).toBe(true);
    expect(result.current.isAnimating).toBe(true);
    clock.frame(100);
    expectSettled(result);
    expect(clock.queue).toHaveLength(0);
  });

  it.each<[Orientation, (p: Point, w: number, h: number) => Point]>([
    ['top', (p, _w, h) => ({ x: p.x, y: p.y + h })],
    ['bottom', (p, _w, h) => ({ x: p.x, y: p.y - h })],
    ['left', (p, w) => ({ x: p.x + w, y: p.y })],
    ['right', (p, w) => ({ x: p.x - w, y: p.y })],
  ])('%s: entering nodes start at the parent nodeJoin point and fade in', (orientation, join) => {
    const { result } = hook({ orientation, nodeSize: { width: 200, height: 80 } });
    const a = node(result, 'a').position;
    act(() => result.current.toggle('a'));
    const start = join(a, 200, 80);
    for (const id of ['a1', 'a2']) {
      expect([id, node(result, id).position]).toEqual([id, start]);
      expect(node(result, id).style?.opacity).toBe(0);
    }
    clock.frame(200);
    const mid = node(result, 'a1');
    expect(mid.style?.opacity).toBeCloseTo(0.5, 9);
    const t = target(result, 'a1');
    expect(mid.position.x).toBeCloseTo((start.x + t.x) / 2, 9);
    expect(mid.position.y).toBeCloseTo((start.y + t.y) / 2, 9);
    clock.frame(200);
    expectSettled(result);
  });

  it('nested entering nodes start at the nearest previously displayed ancestor', () => {
    const { result } = hook();
    const a = node(result, 'a').position;
    act(() => result.current.expand('a1'));
    expect(node(result, 'a1x').position).toEqual({ x: a.x, y: a.y + 150 });
    expect(node(result, 'a1').position).toEqual({ x: a.x, y: a.y + 150 });
  });

  it('entering nodes start from the ancestor’s current (mid-animation) position', () => {
    const data = [...ROWS, { id: 'b1x', parentId: 'b1', name: 'B1X' }];
    const { result } = hook({ data, compact: false });
    act(() => result.current.expand('b'));
    clock.frame(400);
    const b1Before = node(result, 'b1').position;
    act(() => result.current.expand('a')); // a2 pushes b1 aside
    expect(target(result, 'b1').x).not.toBe(b1Before.x);
    clock.frame(200);
    const b1Now = node(result, 'b1').position;
    expect(between(b1Now.x, b1Before.x, target(result, 'b1').x)).toBe(true);
    act(() => result.current.expand('b1'));
    expect(node(result, 'b1x').position).toEqual({ x: b1Now.x, y: b1Now.y + 150 });
    clock.frame(400);
    expectSettled(result);
  });

  it('exiting nodes slide to the parent join point, fade out, stay under the others, then go', () => {
    const { result } = hook({ initialExpandLevel: 3 });
    const before = Object.fromEntries(result.current.nodes.map((n) => [n.id, n.position]));
    act(() => result.current.toggle('a'));
    const ids = result.current.nodes.map((n) => n.id);
    // Exiting nodes render first (under the remaining ones).
    expect(ids.slice(0, 3).sort()).toEqual(['a1', 'a1x', 'a2']);
    expect(result.current.layout!.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b', 'b1']);
    for (const id of ['a1', 'a2', 'a1x']) {
      expect(node(result, id).position).toEqual(before[id]);
      expect(node(result, id).style).toMatchObject({ opacity: 1, pointerEvents: 'none' });
    }
    expect(result.current.edges.map((e) => e.target).sort()).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b1']);
    clock.frame(200);
    const aTarget = target(result, 'a');
    const exitTo = { x: aTarget.x, y: aTarget.y + 150 };
    const a2 = node(result, 'a2');
    expect(a2.style?.opacity).toBeCloseTo(0.5, 9);
    expect(a2.position.y).toBeCloseTo((before.a2.y + exitTo.y) / 2, 9);
    expect(result.current.nodes).toHaveLength(7);
    clock.frame(200);
    expectSettled(result);
    expect(result.current.edges.map((e) => e.target).sort()).toEqual(['a', 'b', 'b1']);
  });

  it('interrupting restarts from the displayed positions; a re-entering exit node regains pointer events', () => {
    const { result } = hook({ initialExpandLevel: 2 });
    act(() => result.current.toggle('a'));
    clock.frame(200);
    const mid = node(result, 'a1');
    expect(mid.style?.pointerEvents).toBe('none');
    act(() => result.current.toggle('a'));
    const restarted = node(result, 'a1');
    expect(restarted.position).toEqual(mid.position);
    expect(restarted.style?.opacity).toBeCloseTo(mid.style!.opacity as number, 9);
    expect(restarted.style?.pointerEvents).toBeUndefined();
    // Exactly one frame loop is running.
    expect(clock.queue).toHaveLength(1);
    clock.frame(400);
    expectSettled(result);
    expect(result.current.nodes.map((n) => n.id)).toContain('a1');
  });

  it('an exit interrupted by another exit keeps its edge until the end', () => {
    const { result } = hook({ initialExpandLevel: 3 });
    act(() => result.current.collapse('a1'));
    clock.frame(100);
    act(() => result.current.collapse('a'));
    expect(result.current.edges.map((e) => e.target)).toEqual(expect.arrayContaining(['a1', 'a2', 'a1x']));
    clock.frame(400);
    expectSettled(result);
    expect(result.current.edges.map((e) => e.target).sort()).toEqual(['a', 'b', 'b1']);
  });

  it('re-expanding while the children are still exiting never yields duplicate edge ids', () => {
    const renders: string[][] = [];
    const { result } = renderHook(() => {
      const chart = useOrgChart<Row>({ data: ROWS, animationDuration: 400, initialExpandLevel: 2 });
      renders.push(chart.edges.map((e) => e.id));
      return chart;
    });
    act(() => result.current.collapse('a'));
    clock.frame(100);
    renders.length = 0;
    act(() => result.current.expand('a'));
    expect(renders.length).toBeGreaterThan(0);
    for (const ids of renders) expect(ids).toEqual([...new Set(ids)]);
    clock.frame(400);
    expectSettled(result);
    expect(result.current.edges.map((e) => e.id)).toEqual(['r->a', 'r->b', 'a->a1', 'a->a2', 'b->b1']);
  });

  it('a data-only change mid-animation neither restarts nor stops it', () => {
    const { result, rerender } = hook({ compact: false });
    act(() => result.current.toggle('a'));
    clock.frame(200);
    const pos = node(result, 'b').position;
    rerender({ compact: false, data: ROWS.map((r) => (r.id === 'b' ? { ...r, name: 'Bee' } : r)) });
    expect(node(result, 'b').position).toEqual(pos);
    expect(node(result, 'b').data.item?.name).toBe('Bee');
    expect(result.current.isAnimating).toBe(true);
    clock.frame(200);
    expectSettled(result);
    expect(node(result, 'b').data.item?.name).toBe('Bee');
  });

  it('animationDuration 0 never requests frames', () => {
    const { result } = hook({ animationDuration: 0 });
    act(() => result.current.toggle('a'));
    expect(clock.queue).toHaveLength(0);
    expectSettled(result);
  });

  it('unmount cancels the running animation', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = hook();
    act(() => result.current.toggle('a'));
    expect(clock.queue).toHaveLength(1);
    const cancelledBefore = clock.cancelled;
    unmount();
    expect(clock.cancelled).toBe(cancelledBefore + 1);
    expect(clock.queue).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it('measure mode: revealed children enter from the parent once measured', () => {
    const { result } = hook({ measure: true, nodeSize: { width: 100, height: 50 } });
    act(() =>
      result.current.onNodesChange(['r', 'a', 'b'].map((id) => ({ type: 'dimensions', id, dimensions: { width: 100, height: 50 } }))),
    );
    // Nothing was visible before: appears in place.
    expect(result.current.isAnimating).toBe(false);
    act(() => result.current.toggle('a'));
    clock.frame(400);
    const hidden = result.current.nodes.filter((n) => n.style?.visibility === 'hidden').map((n) => n.id);
    expect(hidden).toEqual(['a1', 'a2']);
    const a = node(result, 'a').position;
    act(() =>
      result.current.onNodesChange(['a1', 'a2'].map((id) => ({ type: 'dimensions', id, dimensions: { width: 100, height: 50 } }))),
    );
    expect(node(result, 'a1').style?.visibility).toBeUndefined();
    expect(node(result, 'a1').position).toEqual({ x: a.x, y: a.y + 50 });
    expect(node(result, 'a1').style?.opacity).toBe(0);
    clock.frame(400);
    expectSettled(result);
  });

  it('StrictMode: exits, interruptions and settling behave the same', () => {
    const { result } = renderHook(() => useOrgChart<Row>({ data: ROWS, animationDuration: 400, initialExpandLevel: 3 }), {
      wrapper: StrictMode,
    });
    act(() => result.current.toggle('a'));
    expect(result.current.nodes).toHaveLength(7);
    expect(clock.queue).toHaveLength(1);
    clock.frame(200);
    expect(node(result, 'a1').style?.opacity).toBeCloseTo(0.5, 9);
    act(() => result.current.toggle('b'));
    expect(clock.queue).toHaveLength(1);
    clock.frame(400);
    expectSettled(result);
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b']);
    expect(result.current.edges.map((e) => e.target)).toEqual(['a', 'b']);
  });
});
