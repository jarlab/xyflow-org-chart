import { useRef } from 'react';
import { layoutOrgChart } from '../../core/layout';
import type { OrgHierarchy, VisibleEntry } from '../../core/hierarchy';
import { DEFAULT_LAYOUT_OPTIONS, OrgChartDataError } from '../../types';
import type { LayoutInputNode, OrgChartLayout, OrgChartLayoutOptions, Size } from '../../types';

export const DEFAULT_NODE_SIZE: Readonly<Size> = Object.freeze({ width: 250, height: 150 });

/** Tolerance below which a measured size change does not trigger a relayout. */
export const MEASURE_TOLERANCE = 0.5;

export function sizeDiffers(a: Size, b: Size): boolean {
  return Math.abs(a.width - b.width) > MEASURE_TOLERANCE || Math.abs(a.height - b.height) > MEASURE_TOLERANCE;
}

export interface SizeConfig<T> {
  nodeSize: Size | ((item: T) => Size) | undefined;
  pagingNodeSize: Size | undefined;
  measure: boolean;
  measured: ReadonlyMap<string, Size>;
}

export interface LayoutInput {
  nodes: LayoutInputNode[];
  /** Ids laid out with their measured size (measure mode). */
  measuredIds: Set<string>;
}

/**
 * Default size of a paging entry. d3-org-chart turns `children[P]`, the first hidden child, into the
 * "show more" node, so it keeps that child's card size (layout-algorithm.md §8.3).
 */
function pagingEntrySize<T>(entry: VisibleEntry, hierarchy: OrgHierarchy<T>, nodeSize: SizeConfig<T>['nodeSize']): Size {
  if (typeof nodeSize !== 'function') return nodeSize ?? DEFAULT_NODE_SIZE;
  const childIds = entry.parentId === null ? undefined : hierarchy.nodes.get(entry.parentId)?.childIds;
  const firstHidden = childIds?.[childIds.length - (entry.hiddenCount ?? 0)];
  const item = firstHidden === undefined ? undefined : hierarchy.nodes.get(firstHidden);
  return item ? nodeSize(item.item) : DEFAULT_NODE_SIZE;
}

/** The layout input for the visible tree: fixed sizes, or measured sizes with nodeSize as the guess. */
export function resolveLayoutInput<T>(
  visible: readonly VisibleEntry[],
  hierarchy: OrgHierarchy<T>,
  config: SizeConfig<T>,
): LayoutInput {
  const { nodeSize, pagingNodeSize, measure, measured } = config;
  const measuredIds = new Set<string>();
  const nodes = visible.map((entry): LayoutInputNode => {
    let size: Size;
    const m = measure ? measured.get(entry.id) : undefined;
    if (m) {
      size = m;
      measuredIds.add(entry.id);
    } else if (entry.kind === 'paging') {
      size = pagingNodeSize ?? pagingEntrySize(entry, hierarchy, nodeSize);
    } else if (typeof nodeSize === 'function') {
      size = nodeSize(hierarchy.nodes.get(entry.id)!.item);
    } else {
      size = nodeSize ?? DEFAULT_NODE_SIZE;
    }
    return { id: entry.id, parentId: entry.parentId, width: size.width, height: size.height };
  });
  return { nodes, measuredIds };
}

export interface LayoutBundle {
  layout: OrgChartLayout;
  input: LayoutInput;
  options: OrgChartLayoutOptions;
}

export type LayoutBundleResult = { bundle: LayoutBundle; error: null } | { bundle: null; error: OrgChartDataError | null };

function sameStructure(a: readonly LayoutInputNode[], b: readonly LayoutInputNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].parentId !== b[i].parentId) return false;
  return true;
}

function sameSizes(a: readonly LayoutInputNode[], b: readonly LayoutInputNode[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i].width !== b[i].width || a[i].height !== b[i].height) return false;
  return true;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function sameOptions(a: OrgChartLayoutOptions, b: OrgChartLayoutOptions): boolean {
  return (Object.keys(DEFAULT_LAYOUT_OPTIONS) as (keyof OrgChartLayoutOptions)[]).every((k) => a[k] === b[k]);
}

/** True when two bundles differ only by node sizes (a measurement relayout). */
export function onlySizesDiffer(a: LayoutBundle, b: LayoutBundle): boolean {
  return sameStructure(a.input.nodes, b.input.nodes) && sameOptions(a.options, b.options);
}

/**
 * Runs layoutOrgChart, returning the previous bundle (same object) when the input is structurally
 * unchanged, so inline `nodeSize`/accessor functions or re-created arrays never cause a new layout.
 */
export function useLayoutBundle(
  input: LayoutInput | null,
  options: Partial<OrgChartLayoutOptions>,
): LayoutBundleResult {
  const cache = useRef<{ input: LayoutInput | null; options: Partial<OrgChartLayoutOptions>; result: LayoutBundleResult } | null>(null);
  const prev = cache.current;
  if (prev && prev.input === input && prev.options === options) return prev.result;

  let result: LayoutBundleResult;
  if (!input) {
    result = { bundle: null, error: null };
  } else {
    const defined = Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined),
    ) as Partial<OrgChartLayoutOptions>;
    const resolved: OrgChartLayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...defined };
    const last = prev?.result.bundle;
    const sameLayout =
      last &&
      sameOptions(last.options, resolved) &&
      sameStructure(last.input.nodes, input.nodes) &&
      sameSizes(last.input.nodes, input.nodes);
    if (last && sameLayout) {
      // Same geometry: keep the layout object (no new layoutVersion). Only the set of measured
      // ids may have changed (a first measurement equal to the guess), which reveals nodes.
      result = sameIds(last.input.measuredIds, input.measuredIds)
        ? prev.result
        : { bundle: { layout: last.layout, input, options: last.options }, error: null };
    } else {
      try {
        result = { bundle: { layout: layoutOrgChart(input.nodes, resolved), input, options: resolved }, error: null };
      } catch (e) {
        if (!(e instanceof OrgChartDataError)) throw e;
        result = { bundle: null, error: e };
      }
    }
  }
  cache.current = { input, options, result };
  return result;
}
