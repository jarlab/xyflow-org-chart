// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { layoutOrgChart } from '../../src/core/layout';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { OrgChartFlowNode, UseOrgChartOptions, UseOrgChartResult } from '../../src/react/types';
import { ROWS, type Row } from './helpers';

type Opts = Partial<UseOrgChartOptions<Row>>;
type Result = { current: UseOrgChartResult<Row> };

function hook(options: Opts = {}) {
  return renderHook(
    (props: Opts) =>
      useOrgChart<Row>({ data: ROWS, animationDuration: 0, measure: true, nodeSize: { width: 100, height: 50 }, ...props }),
    { initialProps: options },
  );
}

const dims = (id: string, width: number, height: number): NodeChange<OrgChartFlowNode<Row>> => ({
  type: 'dimensions',
  id,
  dimensions: { width, height },
});

const SIZES: Record<string, [number, number]> = {
  r: [180, 70],
  a: [300, 80],
  b: [140, 120],
  a1: [90, 40],
  a2: [210, 60],
  b1: [160, 90],
  a1x: [120, 100],
};

function measureAll(result: Result) {
  act(() => result.current.onNodesChange(result.current.nodes.map((n) => dims(n.id, ...SIZES[n.id]))));
}

const hidden = (result: Result) =>
  result.current.nodes.filter((n) => n.style?.visibility === 'hidden').map((n) => n.id);

describe('useOrgChart measure mode', () => {
  it('starts hidden with the guessed size, no node.width/height, hidden edges', () => {
    const { result } = hook();
    expect(hidden(result)).toEqual(['r', 'a', 'b']);
    expect(result.current.nodes.every((n) => n.width === undefined && n.height === undefined)).toBe(true);
    expect(result.current.nodes.every((n) => n.data.width === 100 && n.data.height === 50)).toBe(true);
    expect(result.current.edges.every((e) => e.hidden === true)).toBe(true);
    expect(result.current.layoutVersion).toBe(1);
  });

  it('relayouts with the measured sizes and reveals every node', () => {
    const { result } = hook({ initialExpandLevel: 2 });
    measureAll(result);
    expect(hidden(result)).toEqual([]);
    expect(result.current.edges.some((e) => e.hidden)).toBe(false);
    expect(result.current.layoutVersion).toBe(2);
    const expected = layoutOrgChart(
      ROWS.filter((r) => r.id !== 'a1x').map((r) => ({
        id: r.id,
        parentId: r.parentId,
        width: SIZES[r.id][0],
        height: SIZES[r.id][1],
      })),
    );
    for (const n of result.current.nodes) {
      const ln = expected.nodeById.get(n.id)!;
      expect([n.id, n.position, n.data.width, n.data.height]).toEqual([n.id, ln.position, ln.width, ln.height]);
      expect(n.measured).toEqual({ width: SIZES[n.id][0], height: SIZES[n.id][1] });
    }
  });

  it('keeps unmeasured nodes (and their edges) hidden', () => {
    const { result } = hook();
    act(() => result.current.onNodesChange([dims('r', 180, 70), dims('a', 300, 80)]));
    expect(hidden(result)).toEqual(['b']);
    const edges = Object.fromEntries(result.current.edges.map((e) => [e.target, !!e.hidden]));
    expect(edges).toEqual({ a: false, b: true });
    expect(result.current.layout!.nodeById.get('a')!.width).toBe(300);
    expect(result.current.layout!.nodeById.get('b')!.width).toBe(100);
  });

  it('a first measurement equal to the guess reveals without a relayout', () => {
    const { result } = hook();
    act(() => result.current.onNodesChange(['r', 'a', 'b'].map((id) => dims(id, 100, 50))));
    expect(hidden(result)).toEqual([]);
    expect(result.current.layoutVersion).toBe(1);
  });

  it('ignores sub-pixel (< 0.5px) changes, relayouts on larger ones', () => {
    const { result } = hook();
    measureAll(result);
    const v = result.current.layoutVersion;
    const before = result.current.nodes.map((n) => n.position);
    act(() => result.current.onNodesChange([dims('a', 300.4, 80.3)]));
    act(() => result.current.onNodesChange([dims('a', 300.2, 79.7)]));
    expect(result.current.layoutVersion).toBe(v);
    expect(result.current.nodes.map((n) => n.position)).toEqual(before);
    act(() => result.current.onNodesChange([dims('a', 320, 80)]));
    expect(result.current.layoutVersion).toBe(v + 1);
    expect(result.current.layout!.nodeById.get('a')!.width).toBe(320);
  });

  it('preserves `measured` across relayouts; newly shown nodes stay hidden until measured', () => {
    const { result } = hook();
    measureAll(result);
    const rootBefore = result.current.nodes.find((n) => n.id === 'r')!;
    act(() => result.current.toggle('a'));
    const root = result.current.nodes.find((n) => n.id === 'r')!;
    expect(root.measured).toEqual(rootBefore.measured);
    expect(hidden(result)).toEqual(['a1', 'a2']);
    expect(result.current.nodes.find((n) => n.id === 'a')!.measured).toEqual({ width: 300, height: 80 });
    measureAll(result);
    expect(hidden(result)).toEqual([]);
    // Measured sizes are remembered: collapsing and re-expanding needs no new measurement.
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('a'));
    expect(hidden(result)).toEqual([]);
    expect(result.current.layout!.nodeById.get('a2')!.width).toBe(210);
  });

  it('lastActionNodeId survives the relayout that measures the action’s new nodes, not later resizes', () => {
    const { result } = hook();
    measureAll(result);
    act(() => result.current.toggle('a'));
    expect(result.current.lastActionNodeId).toBe('a');
    const v = result.current.layoutVersion;
    measureAll(result); // a1/a2 measured → relayout with the same action
    expect(result.current.layoutVersion).toBe(v + 1);
    expect(result.current.lastActionNodeId).toBe('a');
    // A card resizing later (e.g. an image loads) must not re-attach the old action to the layout
    // (<OrgChart> would re-centre on 'a' long after the click).
    act(() => result.current.onNodesChange([dims('b', 400, 120)]));
    expect(result.current.layoutVersion).toBe(v + 2);
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('measured sizes of removed rows are forgotten', () => {
    const { result, rerender } = hook();
    measureAll(result);
    rerender({ data: ROWS.filter((r) => r.id !== 'b' && r.id !== 'b1') });
    rerender({ data: ROWS });
    expect(hidden(result)).toEqual(['b']);
  });

  it('without measure, dimension changes never relayout; removals are ignored', () => {
    const { result } = hook({ measure: false });
    expect(result.current.nodes[0].width).toBe(100);
    act(() => result.current.onNodesChange([dims('a', 500, 500)]));
    expect(result.current.layoutVersion).toBe(1);
    expect(result.current.nodes.find((n) => n.id === 'a')!.measured).toEqual({ width: 500, height: 500 });
    act(() => result.current.onNodesChange([{ type: 'remove', id: 'a' }]));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['r', 'a', 'b']);
  });

  it('select changes are applied to the displayed nodes and survive a relayout', () => {
    const { result } = hook({ measure: false });
    act(() => result.current.onNodesChange([{ type: 'select', id: 'b', selected: true }]));
    expect(result.current.nodes.find((n) => n.id === 'b')!.selected).toBe(true);
    act(() => result.current.toggle('a'));
    expect(result.current.nodes.find((n) => n.id === 'b')!.selected).toBe(true);
  });
});
