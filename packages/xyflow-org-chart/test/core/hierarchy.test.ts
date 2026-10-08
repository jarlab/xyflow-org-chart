import { describe, expect, it } from 'vitest';
import {
  allParentIds,
  ancestorIds,
  buildHierarchy,
  expandedIdsForLevel,
  getVisibleTree,
  pagingNodeId,
} from '../../src/core';
import { OrgChartDataError } from '../../src/types';

interface Row {
  id: string | number;
  parent?: string | number | null;
}

const ROWS: Row[] = [
  { id: 1, parent: null },
  { id: 2, parent: 1 },
  { id: 3, parent: 1 },
  { id: 4, parent: 2 },
  { id: 5, parent: 2 },
  { id: 6, parent: 4 },
  { id: 7, parent: '1' },
];
const build = (rows: Row[]) => buildHierarchy(rows, (r) => r.id, (r) => r.parent);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OrgChartDataError);
    return (e as OrgChartDataError).code;
  }
  return undefined;
}

describe('buildHierarchy', () => {
  it('coerces ids to strings and links children in input order', () => {
    const h = build(ROWS);
    expect(h.rootId).toBe('1');
    expect(h.nodes.get('1')).toMatchObject({ parentId: null, childIds: ['2', '3', '7'], depth: 0, descendantCount: 6 });
    expect(h.nodes.get('2')).toMatchObject({ parentId: '1', childIds: ['4', '5'], depth: 1, descendantCount: 3 });
    expect(h.nodes.get('6')).toMatchObject({ childIds: [], depth: 3, descendantCount: 0 });
    expect(h.nodes.get('7')!.item).toBe(ROWS[6]);
    expect(h.nodes.size).toBe(7);
  });

  it("treats null, undefined and '' parents as the root marker", () => {
    expect(build([{ id: 'a' }, { id: 'b', parent: 'a' }]).rootId).toBe('a');
    expect(build([{ id: 'a', parent: '' }, { id: 'b', parent: 'a' }]).rootId).toBe('a');
    expect(build([{ id: 'b', parent: 'a' }, { id: 'a', parent: null }]).nodes.get('a')!.childIds).toEqual(['b']);
  });

  it('accepts children listed before their parent', () => {
    const h = build([{ id: 'c', parent: 'b' }, { id: 'b', parent: 'a' }, { id: 'a' }]);
    expect(h.nodes.get('c')!.depth).toBe(2);
  });

  it('reports malformed data', () => {
    expect(codeOf(() => build([]))).toBe('empty');
    expect(codeOf(() => build([{ id: 1 }, { id: 2 }]))).toBe('multiple-roots');
    expect(codeOf(() => build([{ id: 1 }, { id: 2, parent: 9 }]))).toBe('missing-parent');
    expect(codeOf(() => build([{ id: 1 }, { id: '1', parent: 1 }]))).toBe('duplicate-id');
    expect(codeOf(() => build([{ id: 1, parent: 2 }, { id: 2, parent: 1 }]))).toBe('no-root');
    expect(codeOf(() => build([{ id: 0 }, { id: 1, parent: 2 }, { id: 2, parent: 1 }]))).toBe('cycle');
    expect(codeOf(() => build([{ id: 0 }, { id: 1, parent: 1 }]))).toBe('cycle');
  });

  it('names the offending id', () => {
    try {
      build([{ id: 0 }, { id: 5, parent: 0 }, { id: 1, parent: 2 }, { id: 2, parent: 1 }, { id: 3, parent: 2 }]);
    } catch (e) {
      expect(['1', '2']).toContain((e as OrgChartDataError).id);
    }
    try {
      build([{ id: 0 }, { id: 5, parent: 'x' }]);
    } catch (e) {
      expect((e as OrgChartDataError).id).toBe('5');
    }
  });

  it('handles a 20k-deep chain', () => {
    const rows: Row[] = [{ id: 0 }];
    for (let i = 1; i < 20_000; i++) rows.push({ id: i, parent: i - 1 });
    const h = build(rows);
    expect(h.nodes.get('0')!.descendantCount).toBe(19_999);
    expect(h.nodes.get('19999')!.depth).toBe(19_999);
    expect(ancestorIds(h, '19999')).toHaveLength(19_999);
  });
});

describe('levels and ancestors', () => {
  const h = build(ROWS);
  it('expandedIdsForLevel', () => {
    expect([...expandedIdsForLevel(h, 0)]).toEqual([]);
    expect([...expandedIdsForLevel(h, 1)]).toEqual(['1']);
    expect([...expandedIdsForLevel(h, 2)].sort()).toEqual(['1', '2']);
    expect([...expandedIdsForLevel(h, 99)].sort()).toEqual(['1', '2', '4']);
  });
  it('allParentIds', () => {
    expect([...allParentIds(h)].sort()).toEqual(['1', '2', '4']);
  });
  it('ancestorIds (root first, excluding the node)', () => {
    expect(ancestorIds(h, '6')).toEqual(['1', '2', '4']);
    expect(ancestorIds(h, '1')).toEqual([]);
    expect(ancestorIds(h, 'nope')).toEqual([]);
  });
  it('a level makes exactly the nodes at depth <= level visible', () => {
    for (let level = 0; level <= 4; level++) {
      const vis = getVisibleTree(h, { expandedIds: expandedIdsForLevel(h, level) });
      const expected = [...h.nodes.values()].filter((n) => n.depth <= level).map((n) => n.id);
      expect(vis.map((v) => v.id).sort()).toEqual(expected.sort());
    }
  });
});

describe('getVisibleTree', () => {
  const h = build(ROWS);

  it('shows only the root when nothing is expanded', () => {
    expect(getVisibleTree(h, { expandedIds: new Set() })).toEqual([{ id: '1', parentId: null, kind: 'node' }]);
  });

  it('shows children of expanded, visible nodes only', () => {
    const vis = getVisibleTree(h, { expandedIds: new Set(['1', '4']) });
    // 4 is expanded but hidden (2 is collapsed), so 6 stays hidden.
    expect(vis.map((v) => v.id)).toEqual(['1', '2', '3', '7']);
    const all = getVisibleTree(h, { expandedIds: allParentIds(h) });
    expect(all.map((v) => v.id)).toEqual(['1', '2', '3', '7', '4', '5', '6']);
    expect(all.every((v) => v.kind === 'node')).toBe(true);
  });

  it('lists parents before children and keeps input order among siblings', () => {
    const all = getVisibleTree(h, { expandedIds: allParentIds(h) });
    const pos = new Map(all.map((v, i) => [v.id, i]));
    for (const v of all) if (v.parentId) expect(pos.get(v.parentId)!).toBeLessThan(pos.get(v.id)!);
  });

  describe('paging', () => {
    const rows: Row[] = [{ id: 'p' }];
    for (let i = 0; i < 12; i++) rows.push({ id: `c${i}`, parent: 'p' });
    rows.push({ id: 'g', parent: 'c0' });
    const ph = build(rows);
    const expandedIds = allParentIds(ph);

    it('shows the first pageSize children then a paging entry', () => {
      const vis = getVisibleTree(ph, { expandedIds, paging: { pageSize: 5, step: 5 } });
      expect(vis.map((v) => v.id)).toEqual(['p', 'c0', 'c1', 'c2', 'c3', 'c4', pagingNodeId('p'), 'g']);
      expect(vis[6]).toEqual({ id: 'p::more', parentId: 'p', kind: 'paging', hiddenCount: 7 });
    });

    it('pageLimits override pageSize and the entry disappears when nothing is hidden', () => {
      const ten = getVisibleTree(ph, { expandedIds, paging: { pageSize: 5, step: 5 }, pageLimits: new Map([['p', 10]]) });
      expect(ten.find((v) => v.kind === 'paging')!.hiddenCount).toBe(2);
      const all = getVisibleTree(ph, { expandedIds, paging: { pageSize: 5, step: 5 }, pageLimits: new Map([['p', 12]]) });
      expect(all.some((v) => v.kind === 'paging')).toBe(false);
      expect(all).toHaveLength(14);
    });

    it('a zero limit shows only the paging entry; paging off shows everything', () => {
      const none = getVisibleTree(ph, { expandedIds, paging: { pageSize: 0, step: 5 } });
      expect(none.map((v) => v.id)).toEqual(['p', 'p::more']);
      expect(none[1].hiddenCount).toBe(12);
      expect(getVisibleTree(ph, { expandedIds, paging: false })).toHaveLength(14);
      expect(getVisibleTree(ph, { expandedIds, pageLimits: new Map([['p', 1]]) })).toHaveLength(14);
    });

    it('collapsed parents get no paging entry', () => {
      const vis = getVisibleTree(ph, { expandedIds: new Set(), paging: { pageSize: 1, step: 1 } });
      expect(vis.map((v) => v.id)).toEqual(['p']);
    });
  });
});
