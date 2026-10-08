/**
 * Full-data hierarchy and visible-tree derivation (expand/collapse + paging).
 *
 * Expansion model (deliberately simpler than d3-org-chart's flags, see layout-algorithm.md §10.1):
 * a node's children are shown iff the node's id is in `expandedIds` AND the node itself is visible.
 * The root is always visible.
 */
import { buildTree } from './tree';

export interface OrgHierarchyNode<T> {
  id: string;
  parentId: string | null;
  item: T;
  /** Child ids in input order. */
  childIds: string[];
  depth: number;
  /** Number of descendants in the full data (excluding the node itself). */
  descendantCount: number;
}

export interface OrgHierarchy<T> {
  rootId: string;
  nodes: Map<string, OrgHierarchyNode<T>>;
}

interface Built<T> extends OrgHierarchyNode<T> {
  children: Built<T>[];
}

/**
 * Builds the full hierarchy from flat rows. Ids are coerced to strings; a parent id of
 * null/undefined/'' marks the root. Throws OrgChartDataError on: empty data, no root, multiple
 * roots, missing parent, duplicate id, cycle.
 */
export function buildHierarchy<T>(
  items: readonly T[],
  getId: (item: T) => string | number,
  getParentId: (item: T) => string | number | null | undefined,
): OrgHierarchy<T> {
  const { root, bfs } = buildTree<T, Built<T>>(
    items,
    (item) => String(getId(item)),
    (item) => {
      const p = getParentId(item);
      return p === null || p === undefined || p === '' ? null : String(p);
    },
    (item, id, parentId) => ({ id, parentId, item, childIds: [], depth: 0, descendantCount: 0, children: [] }),
  );
  for (const n of bfs) {
    for (const c of n.children) {
      c.depth = n.depth + 1;
      n.childIds.push(c.id);
    }
  }
  for (let i = bfs.length - 1; i >= 0; i--) {
    const n = bfs[i];
    for (const c of n.children) n.descendantCount += c.descendantCount + 1;
  }
  // Map order = breadth-first; the public objects do not carry the internal `children` links.
  const nodes = new Map<string, OrgHierarchyNode<T>>();
  for (const n of bfs) {
    const { id, parentId, item, childIds, depth, descendantCount } = n;
    nodes.set(id, { id, parentId, item, childIds, depth, descendantCount });
  }
  return { rootId: root.id, nodes };
}

/**
 * d3-org-chart's initialExpandLevel: nodes at depth <= level are visible.
 * Returns the ids of every node with depth < level that has children
 * (level 0 → empty set: only the root is visible; level 1 → {root}).
 */
export function expandedIdsForLevel<T>(hierarchy: OrgHierarchy<T>, level: number): Set<string> {
  const ids = new Set<string>();
  for (const n of hierarchy.nodes.values()) {
    if (n.depth < level && n.childIds.length > 0) ids.add(n.id);
  }
  return ids;
}

/** Ids of every node that has children (expand all). */
export function allParentIds<T>(hierarchy: OrgHierarchy<T>): Set<string> {
  const ids = new Set<string>();
  for (const n of hierarchy.nodes.values()) if (n.childIds.length > 0) ids.add(n.id);
  return ids;
}

/** Ids of every ancestor of `id` (root first), excluding `id`. Empty for the root or an unknown id. */
export function ancestorIds<T>(hierarchy: OrgHierarchy<T>, id: string): string[] {
  const out: string[] = [];
  let parentId = hierarchy.nodes.get(id)?.parentId ?? null;
  while (parentId !== null) {
    out.push(parentId);
    parentId = hierarchy.nodes.get(parentId)?.parentId ?? null;
  }
  return out.reverse();
}

export interface PagingOptions {
  /** Number of children shown under each parent before a "show more" node. */
  pageSize: number;
  /** How many more children each "show more" click reveals. */
  step: number;
}

export interface VisibleTreeOptions {
  expandedIds: ReadonlySet<string>;
  /** Off by default (d3-org-chart's default minPagingVisibleNodes = 2000 makes paging effectively off). */
  paging?: PagingOptions | false;
  /** Per-parent number of visible children, overriding paging.pageSize (grown by "show more"). */
  pageLimits?: ReadonlyMap<string, number>;
}

export interface VisibleEntry {
  id: string;
  parentId: string | null;
  kind: 'node' | 'paging';
  /** For kind 'paging': the number of children still hidden behind the "show more" node. */
  hiddenCount?: number;
}

/** The id used for a parent's synthetic "show more" node. */
export function pagingNodeId(parentId: string): string {
  return `${parentId}::more`;
}

/**
 * The visible tree as an ordered list, children in input order, parents before their children.
 * With paging, a parent with more than `limit` children shows the first `limit` children followed
 * by one synthetic paging entry (id = pagingNodeId(parentId)) when at least one child is hidden.
 *
 * The list is in breadth-first order (the order of OrgChartLayout.nodes). `pageLimits` only applies
 * when `paging` is on; limits are floored and clamped at 0.
 */
export function getVisibleTree<T>(hierarchy: OrgHierarchy<T>, options: VisibleTreeOptions): VisibleEntry[] {
  const { expandedIds, paging, pageLimits } = options;
  const out: VisibleEntry[] = [{ id: hierarchy.rootId, parentId: null, kind: 'node' }];
  for (let i = 0; i < out.length; i++) {
    const entry = out[i];
    if (entry.kind !== 'node' || !expandedIds.has(entry.id)) continue;
    const node = hierarchy.nodes.get(entry.id);
    if (!node || node.childIds.length === 0) continue;
    const kids = node.childIds;
    let limit = kids.length;
    if (paging) {
      const raw = pageLimits?.get(node.id) ?? paging.pageSize;
      limit = Math.min(kids.length, Math.max(0, Math.floor(raw)));
    }
    for (let k = 0; k < limit; k++) out.push({ id: kids[k], parentId: node.id, kind: 'node' });
    if (limit < kids.length) {
      out.push({ id: pagingNodeId(node.id), parentId: node.id, kind: 'paging', hiddenCount: kids.length - limit });
    }
  }
  return out;
}
