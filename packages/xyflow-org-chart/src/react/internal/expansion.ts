import { ancestorIds, type OrgHierarchy, type PagingOptions } from '../../core/hierarchy';

/** The page limit that makes child index `index` visible, growing pageSize by whole steps. */
function limitShowing(index: number, paging: PagingOptions): number {
  const needed = index + 1;
  if (needed <= paging.pageSize) return paging.pageSize;
  if (paging.step <= 0) return needed;
  return paging.pageSize + Math.ceil((needed - paging.pageSize) / paging.step) * paging.step;
}

/**
 * Makes `id` visible: expands every ancestor and, with paging, raises the ancestors' page limits
 * so the path is not paged out (layout-algorithm.md §10.6: "bumping pagingStep is cleaner").
 * Mutates `expanded` and `pageLimits`; returns whether pageLimits changed.
 */
export function revealInPlace<T>(
  hierarchy: OrgHierarchy<T>,
  id: string,
  expanded: Set<string>,
  pageLimits: Map<string, number>,
  paging: PagingOptions | false,
): boolean {
  let limitsChanged = false;
  const path = [...ancestorIds(hierarchy, id), id];
  for (let i = 0; i < path.length - 1; i++) {
    const parent = path[i];
    expanded.add(parent);
    if (!paging) continue;
    const index = hierarchy.nodes.get(parent)!.childIds.indexOf(path[i + 1]);
    const limit = pageLimits.get(parent) ?? paging.pageSize;
    if (index >= limit) {
      pageLimits.set(parent, limitShowing(index, paging));
      limitsChanged = true;
    }
  }
  return limitsChanged;
}

/** `ids` without the ids missing from the hierarchy (same object when nothing is pruned). */
export function pruneIds<T>(ids: ReadonlySet<string>, hierarchy: OrgHierarchy<T>): ReadonlySet<string> {
  for (const id of ids) {
    if (!hierarchy.nodes.has(id)) return new Set([...ids].filter((x) => hierarchy.nodes.has(x)));
  }
  return ids;
}

export function pruneLimits<T>(
  limits: ReadonlyMap<string, number>,
  hierarchy: OrgHierarchy<T>,
): ReadonlyMap<string, number> {
  for (const id of limits.keys()) {
    if (!hierarchy.nodes.has(id)) return new Map([...limits].filter(([x]) => hierarchy.nodes.has(x)));
  }
  return limits;
}
