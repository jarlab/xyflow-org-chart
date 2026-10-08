import { OrgChartDataError } from '../types';
import type { LayoutInputNode } from '../types';

/** Validated tree built from flat rows. */
export interface BuiltTree<T> {
  root: T;
  /** Breadth-first order, root first, children in input order. */
  bfs: T[];
}

/**
 * Validates flat rows and links them into a tree (children in input order).
 * `parentOf` returns null for a root. Throws OrgChartDataError with codes, checked in this order:
 * empty, duplicate-id, missing-parent, no-root, multiple-roots, cycle.
 * Iterative, so deep chains are fine.
 */
export function buildTree<R, T extends { children: T[] }>(
  rows: readonly R[],
  idOf: (row: R) => string,
  parentOf: (row: R) => string | null,
  make: (row: R, id: string, parentId: string | null) => T,
): BuiltTree<T> {
  if (rows.length === 0) throw new OrgChartDataError('The data is empty.', 'empty');
  const byId = new Map<string, T>();
  const parentIds: (string | null)[] = [];
  const made: T[] = [];
  for (const row of rows) {
    const id = idOf(row);
    if (byId.has(id)) throw new OrgChartDataError(`Duplicate node id "${id}".`, 'duplicate-id', id);
    const parentId = parentOf(row);
    const node = make(row, id, parentId);
    byId.set(id, node);
    made.push(node);
    parentIds.push(parentId);
  }
  let root: T | null = null;
  let rootId = '';
  for (let i = 0; i < made.length; i++) {
    const parentId = parentIds[i];
    const id = idOf(rows[i]);
    if (parentId === null) {
      if (root) {
        throw new OrgChartDataError(
          `Multiple roots: "${rootId}" and "${id}" both have no parent.`,
          'multiple-roots',
          id,
        );
      }
      root = made[i];
      rootId = id;
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      throw new OrgChartDataError(`Node "${id}" has unknown parent "${parentId}".`, 'missing-parent', id);
    }
    parent.children.push(made[i]);
  }
  if (!root) {
    // Every node has an existing parent, so following parents from any node must loop.
    throw new OrgChartDataError('No root: every node has a parent (the data contains a cycle).', 'no-root');
  }
  const bfs: T[] = [root];
  for (let i = 0; i < bfs.length; i++) for (const c of bfs[i].children) bfs.push(c);
  if (bfs.length !== made.length) {
    const reached = new Set(bfs);
    const start = made.findIndex((n) => !reached.has(n));
    const parentById = new Map<string, string | null>();
    rows.forEach((row, i) => parentById.set(idOf(row), parentIds[i]));
    const id = findCycleId(idOf(rows[start]), (x) => parentById.get(x) ?? null);
    throw new OrgChartDataError(`Cycle in parent links involving "${id}".`, 'cycle', id);
  }
  return { root, bfs };
}

/** Follows parent links from `start` (known to be unreachable from the root) to a node on the cycle. */
function findCycleId(start: string, parentOf: (id: string) => string | null): string {
  const seen = new Set<string>();
  let id = start;
  while (!seen.has(id)) {
    seen.add(id);
    id = parentOf(id) as string;
  }
  return id;
}

/** Root marker for layout input: null (undefined tolerated for untyped callers). */
export function inputParentId(n: LayoutInputNode): string | null {
  return n.parentId ?? null;
}
