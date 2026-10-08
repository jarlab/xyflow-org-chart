// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { layoutOrgChart } from '../../src/core/layout';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { OrgChartActions, UseOrgChartOptions, UseOrgChartResult } from '../../src/react/types';
import { inputFor, ROWS, type Row } from './helpers';

type Opts = Partial<UseOrgChartOptions<Row>>;

function hook(options: Opts = {}) {
  return renderHook((props: Opts) => useOrgChart<Row>({ data: ROWS, animationDuration: 0, ...props }), {
    initialProps: options,
  });
}

const ids = (r: { current: UseOrgChartResult<Row> }) => r.current.nodes.map((n) => n.id);
const expanded = (r: { current: UseOrgChartResult<Row> }) => [...r.current.expandedIds].sort();

const ACTION_KEYS: (keyof OrgChartActions)[] = [
  'toggle',
  'expand',
  'collapse',
  'expandAll',
  'collapseAll',
  'collapseToLevel',
  'reveal',
  'showMore',
];

describe('useOrgChart expansion', () => {
  it.each([
    [0, ['r']],
    [1, ['r', 'a', 'b']],
    [2, ['r', 'a', 'b', 'a1', 'a2', 'b1']],
    [3, ['r', 'a', 'b', 'a1', 'a2', 'b1', 'a1x']],
  ])('initialExpandLevel %i shows depth <= level', (level, visible) => {
    const { result } = hook({ initialExpandLevel: level });
    expect(ids(result)).toEqual(visible);
    // Positions are the layout of exactly that visible tree.
    const expected = layoutOrgChart(inputFor(ROWS, visible));
    expect(result.current.nodes.map((n) => n.position)).toEqual(expected.nodes.map((n) => n.position));
  });

  it('toggle on a leaf or unknown id is a no-op', () => {
    const onChange = vi.fn();
    const { result } = hook({ onExpandedIdsChange: onChange });
    act(() => result.current.toggle('b1'));
    act(() => result.current.toggle('nope'));
    act(() => result.current.expand('nope'));
    act(() => result.current.collapse('a'));
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.layoutVersion).toBe(1);
  });

  it('expand(hidden deep node) expands its ancestors and itself', () => {
    const { result } = hook({ initialExpandLevel: 0 });
    act(() => result.current.expand('a1'));
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2', 'a1x']);
    expect(expanded(result)).toEqual(['a', 'a1', 'r']);
    expect(result.current.lastActionNodeId).toBe('a1');
  });

  it('reveal(deep leaf) expands ancestors only and clears lastActionNodeId', () => {
    const { result } = hook({ initialExpandLevel: 0 });
    act(() => result.current.toggle('r'));
    expect(result.current.lastActionNodeId).toBe('r');
    act(() => result.current.reveal('a1x'));
    expect(ids(result)).toContain('a1x');
    expect(expanded(result)).toEqual(['a', 'a1', 'r']);
    expect(result.current.lastActionNodeId).toBeNull();
    act(() => result.current.reveal('b'));
    expect(result.current.layoutVersion).toBe(3);
  });

  it('collapse keeps descendants expanded: re-expanding restores grandchildren', () => {
    const { result } = hook({ initialExpandLevel: 3 });
    act(() => result.current.collapse('a'));
    expect(ids(result)).toEqual(['r', 'a', 'b', 'b1']);
    expect(result.current.nodes.find((n) => n.id === 'a')!.data.expanded).toBe(false);
    act(() => result.current.toggle('a'));
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2', 'b1', 'a1x']);
  });

  it('expandAll / collapseAll / collapseToLevel', () => {
    const { result } = hook({ initialExpandLevel: 1 });
    act(() => result.current.expandAll());
    expect(ids(result)).toHaveLength(7);
    expect(expanded(result)).toEqual(['a', 'a1', 'b', 'r']);
    act(() => result.current.collapseToLevel(2));
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2', 'b1']);
    act(() => result.current.collapseToLevel(1));
    expect(ids(result)).toEqual(['r', 'a', 'b']);
    act(() => result.current.collapseAll());
    expect(ids(result)).toEqual(['r']);
    expect(expanded(result)).toEqual([]);
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('collapseAll collapses everything even with a deep initialExpandLevel (d3-org-chart collapseAll)', () => {
    const { result } = hook({ initialExpandLevel: 99 });
    expect(ids(result)).toHaveLength(7);
    act(() => result.current.collapseAll());
    expect(ids(result)).toEqual(['r']);
    act(() => result.current.collapseToLevel(99));
    expect(ids(result)).toHaveLength(7);
  });

  it('chained actions in one batch compose (uncontrolled)', () => {
    const { result } = hook();
    act(() => {
      result.current.toggle('a');
      result.current.toggle('b');
      result.current.toggle('a1');
    });
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2', 'b1', 'a1x']);
    expect(result.current.layoutVersion).toBe(2);
  });

  it('lastActionNodeId follows the action that produced the layout', () => {
    const { result, rerender } = hook();
    act(() => result.current.toggle('a'));
    expect(result.current.lastActionNodeId).toBe('a');
    // Unrelated re-render keeps it.
    rerender({});
    expect(result.current.lastActionNodeId).toBe('a');
    // A data change that alters the layout clears it.
    rerender({ data: [...ROWS, { id: 'c', parentId: 'r', name: 'C' }] });
    expect(ids(result)).toContain('c');
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('a nodeSize change after an action clears lastActionNodeId', () => {
    const { result, rerender } = hook();
    act(() => result.current.toggle('a'));
    rerender({ nodeSize: { width: 100, height: 60 } });
    expect(result.current.layoutVersion).toBe(3);
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('works under StrictMode (double render / effects)', () => {
    const onChange = vi.fn();
    const { result } = renderHook(
      () => useOrgChart<Row>({ data: ROWS, animationDuration: 0, onExpandedIdsChange: onChange }),
      { wrapper: StrictMode },
    );
    expect(result.current.layoutVersion).toBe(1);
    act(() => result.current.toggle('a'));
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2']);
    expect(result.current.layoutVersion).toBe(2);
    expect(result.current.lastActionNodeId).toBe('a');
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => result.current.reveal('a1x'));
    expect(ids(result)).toContain('a1x');
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('actions are referentially stable across renders, data changes and layouts', () => {
    const { result, rerender } = hook();
    const first = Object.fromEntries(ACTION_KEYS.map((k) => [k, result.current[k]]));
    act(() => result.current.toggle('a'));
    rerender({ data: ROWS.slice(0, 5), orientation: 'left', paging: { pageSize: 1, step: 1 } });
    for (const k of ACTION_KEYS) expect([k, result.current[k]]).toEqual([k, first[k]]);
  });

  it('prunes expanded ids of removed rows; re-added rows start collapsed', () => {
    const { result, rerender } = hook();
    act(() => result.current.toggle('a'));
    expect(expanded(result)).toEqual(['a', 'r']);
    const withoutA = ROWS.filter((r) => r.id !== 'a' && r.parentId !== 'a' && r.id !== 'a1x');
    rerender({ data: withoutA });
    expect(expanded(result)).toEqual(['r']);
    expect(ids(result)).toEqual(['r', 'b']);
    rerender({ data: ROWS });
    expect(ids(result)).toEqual(['r', 'a', 'b']);
    expect(result.current.nodes.find((n) => n.id === 'a')!.data.expanded).toBe(false);
  });

  it('follows initialExpandLevel on new data until the first action', () => {
    const { result, rerender } = hook();
    rerender({ data: [...ROWS, { id: 'c', parentId: 'r', name: 'C' }] });
    expect(ids(result)).toEqual(['r', 'a', 'b', 'c']);
  });
});

describe('useOrgChart controlled expansion', () => {
  it('reports changes and only changes when the prop changes', () => {
    const onChange = vi.fn();
    const { result, rerender } = hook({ expandedIds: ['r'], onExpandedIdsChange: onChange, initialExpandLevel: 3 });
    // initialExpandLevel is ignored in controlled mode.
    expect(ids(result)).toEqual(['r', 'a', 'b']);
    act(() => result.current.toggle('a'));
    expect(onChange).toHaveBeenLastCalledWith(['r', 'a']);
    expect(ids(result)).toEqual(['r', 'a', 'b']);
    expect(result.current.layoutVersion).toBe(1);

    rerender({ expandedIds: ['r', 'a'], onExpandedIdsChange: onChange });
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2']);
    expect(result.current.lastActionNodeId).toBe('a');

    act(() => result.current.collapse('a'));
    expect(onChange).toHaveBeenLastCalledWith(['r']);
    act(() => result.current.expandAll());
    expect([...onChange.mock.lastCall![0]].sort()).toEqual(['a', 'a1', 'b', 'r']);
    act(() => result.current.collapseToLevel(0));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(ids(result)).toEqual(['r', 'a', 'b', 'a1', 'a2']);
  });

  it('a prop change not caused by an action leaves lastActionNodeId null', () => {
    const { result, rerender } = hook({ expandedIds: ['r'] });
    rerender({ expandedIds: ['r', 'b'] });
    expect(ids(result)).toEqual(['r', 'a', 'b', 'b1']);
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('an ignored action does not attach its id to a later, unrelated layout', () => {
    const onChange = vi.fn();
    const { result, rerender } = hook({ expandedIds: ['r'], onExpandedIdsChange: onChange });
    act(() => result.current.toggle('a')); // parent rejects the change
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender({ expandedIds: ['r'], onExpandedIdsChange: onChange, data: [...ROWS, { id: 'c', parentId: 'r', name: 'C' }] });
    expect(ids(result)).toContain('c');
    expect(result.current.lastActionNodeId).toBeNull();
  });

  it('accepts unknown ids in the prop without crashing', () => {
    const { result } = hook({ expandedIds: ['r', 'ghost'] });
    expect(ids(result)).toEqual(['r', 'a', 'b']);
  });
});

describe('useOrgChart paging', () => {
  const many: Row[] = [{ id: 'r', parentId: null, name: 'R' }];
  for (let i = 0; i < 7; i++) many.push({ id: `c${i}`, parentId: 'r', name: `C${i}` });
  many.push({ id: 'c0a', parentId: 'c0', name: 'C0A' }, { id: 'c0b', parentId: 'c0', name: 'C0B' });

  it('shows pageSize children then a paging node laid out with pagingNodeSize', () => {
    const { result } = hook({
      data: many,
      paging: { pageSize: 2, step: 3 },
      compact: false,
      pagingNodeSize: { width: 120, height: 40 },
    });
    expect(ids(result)).toEqual(['r', 'c0', 'c1', 'r::more']);
    const more = result.current.nodes[3];
    expect(more.type).toBe('orgChartPaging');
    expect(more.data).toMatchObject({
      kind: 'paging',
      item: undefined,
      parentId: 'r',
      depth: 1,
      hasChildren: false,
      expanded: false,
      directReports: 0,
      totalReports: 0,
      hiddenCount: 5,
      nextPageCount: 3,
      width: 120,
      height: 40,
    });
    expect(more.width).toBe(120);
    const expected = layoutOrgChart(
      [...inputFor(many, ['r', 'c0', 'c1']), { id: 'r::more', parentId: 'r', width: 120, height: 40 }],
      { compact: false },
    );
    expect(result.current.nodes.map((n) => n.position)).toEqual(expected.nodes.map((n) => n.position));
    // No edge to the paging node (the layout still has one).
    expect(result.current.edges.map((e) => e.target)).toEqual(['c0', 'c1']);
    expect(result.current.layout!.edges.map((e) => e.target)).toContain('r::more');
  });

  it('paging node defaults to nodeSize (object), or to the size function applied to the first hidden child', () => {
    const a = hook({ data: many, paging: { pageSize: 2, step: 3 }, nodeSize: { width: 90, height: 30 } });
    expect(a.result.current.nodes[3].data).toMatchObject({ width: 90, height: 30 });
    const b = hook({
      data: many,
      paging: { pageSize: 2, step: 3 },
      nodeSize: (r) => (r.id === 'c2' ? { width: 95, height: 35 } : { width: 90, height: 30 }),
    });
    expect(b.result.current.nodes[3].data).toMatchObject({ width: 95, height: 35 });
  });

  it('showMore reveals step more children until none are hidden', () => {
    const { result } = hook({ data: many, paging: { pageSize: 2, step: 3 } });
    act(() => result.current.showMore('r'));
    expect(ids(result)).toEqual(['r', 'c0', 'c1', 'c2', 'c3', 'c4', 'r::more']);
    expect(result.current.nodes.at(-1)!.data).toMatchObject({ hiddenCount: 2, nextPageCount: 2 });
    expect(result.current.lastActionNodeId).toBe('r');
    act(() => result.current.showMore('r'));
    expect(ids(result)).toEqual(['r', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    const v = result.current.layoutVersion;
    act(() => result.current.showMore('r'));
    act(() => result.current.showMore('c1')); // no children
    act(() => result.current.showMore('ghost'));
    expect(result.current.layoutVersion).toBe(v);
  });

  it('pages nested parents independently', () => {
    const { result } = hook({ data: many, paging: { pageSize: 1, step: 1 }, initialExpandLevel: 2 });
    expect(ids(result)).toEqual(['r', 'c0', 'r::more', 'c0a', 'c0::more']);
    act(() => result.current.showMore('c0'));
    expect(ids(result)).toEqual(['r', 'c0', 'r::more', 'c0a', 'c0b']);
  });

  it('reveal/expand of a paged-out child raises the page limit by whole steps', () => {
    const { result } = hook({ data: many, paging: { pageSize: 2, step: 2 } });
    act(() => result.current.reveal('c3'));
    expect(ids(result)).toEqual(['r', 'c0', 'c1', 'c2', 'c3', 'r::more']);
    expect(result.current.nodes.at(-1)!.data.hiddenCount).toBe(3);
    act(() => result.current.expand('c6'));
    expect(ids(result)).toContain('c6');
    expect(ids(result)).not.toContain('r::more');
  });

  it('collapse + expand keeps the page limit; turning paging off shows every child', () => {
    const { result, rerender } = hook({ data: many, paging: { pageSize: 2, step: 3 } });
    act(() => result.current.showMore('r'));
    act(() => result.current.collapse('r'));
    act(() => result.current.expand('r'));
    expect(ids(result)).toHaveLength(7);
    rerender({ data: many, paging: false });
    expect(ids(result)).toEqual(['r', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });

  it('prunes page limits of removed parents', () => {
    const { result, rerender } = hook({ data: many, paging: { pageSize: 1, step: 5 } });
    act(() => result.current.showMore('r'));
    expect(ids(result)).toHaveLength(8);
    const noRoot2: Row[] = [{ id: 'r2', parentId: null, name: '' }, ...many.slice(1).map((r) => (r.parentId === 'r' ? { ...r, parentId: 'r2' } : r))];
    rerender({ data: noRoot2, paging: { pageSize: 1, step: 5 } });
    expect(ids(result)).toEqual(['r2', 'c0', 'r2::more']);
    rerender({ data: many, paging: { pageSize: 1, step: 5 } });
    expect(ids(result)).toEqual(['r', 'c0', 'r::more']);
  });
});
