import type { NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allParentIds,
  buildHierarchy,
  expandedIdsForLevel,
  getVisibleTree,
  pagingNodeId,
  type OrgHierarchy,
  type PagingOptions,
} from '../core/hierarchy';
import { OrgChartDataError } from '../types';
import type { OrgChartLayout, OrgChartLayoutOptions, Size } from '../types';
import { sameNumberMap, sameSet } from './internal/equality';
import { revealInPlace, pruneIds, pruneLimits } from './internal/expansion';
import { buildFlowElements, sameElements, type FlowElements } from './internal/flowElements';
import { useIsomorphicLayoutEffect, usePrefersReducedMotion } from './internal/hooks';
import {
  onlySizesDiffer,
  resolveLayoutInput,
  sizeDiffers,
  useLayoutBundle,
  type LayoutBundle,
} from './internal/layoutBundle';
import { useAnimatedFlow } from './internal/useAnimatedFlow';
import type {
  OrgChartActions,
  OrgChartFlowEdge,
  OrgChartFlowNode,
  UseOrgChartOptions,
  UseOrgChartResult,
} from './types';

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_LIMITS: ReadonlyMap<string, number> = new Map();
const NO_NODES: never[] = [];
const NO_EDGES: OrgChartFlowEdge[] = [];
const EMPTY_ELEMENTS: FlowElements<never> = { nodes: [], edges: [] };

function field(item: unknown, key: string): unknown {
  return item !== null && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined;
}

function defaultGetId(item: unknown): string | number {
  const v = field(item, 'id');
  if (v === undefined || v === null) {
    throw new OrgChartDataError('A row has no "id" field. Pass getId if your rows keep their id elsewhere.', 'missing-id');
  }
  return typeof v === 'number' ? v : String(v);
}

function defaultGetParentId(item: unknown): string | number | null | undefined {
  const v = field(item, 'parentId');
  if (typeof v === 'string' || typeof v === 'number') return v;
  return v === null ? null : undefined;
}

type Built<T> = { hierarchy: OrgHierarchy<T>; error: null } | { hierarchy: null; error: OrgChartDataError };

/** An action waiting for the layout it produces (see lastActionNodeId). */
interface PendingAction {
  id: string | null;
  /** Expansion state when the action ran: once it changes, the action has been applied. */
  expanded: ReadonlySet<string>;
  limits: ReadonlyMap<string, number>;
}

interface LayoutTrack {
  bundle: LayoutBundle | null;
  layout: OrgChartLayout | null;
  version: number;
  actionNodeId: string | null;
}

/** State the stable action callbacks read. Actions update it eagerly so chained calls compose. */
interface ActionState<T> {
  hierarchy: OrgHierarchy<T> | null;
  expandedIds: ReadonlySet<string>;
  /** expandedIds as last rendered (actions may have moved expandedIds ahead of it). */
  renderedExpandedIds: ReadonlySet<string>;
  pageLimits: ReadonlyMap<string, number>;
  paging: PagingOptions | false;
  controlled: boolean;
  onExpandedIdsChange: ((ids: string[]) => void) | undefined;
}

const PAGING_SUFFIX = /* @__PURE__ */ pagingNodeId('');

/** Some laid-out node still uses the guessed size (measure mode, before its first measurement). */
function hasUnmeasured(bundle: LayoutBundle): boolean {
  return bundle.input.measuredIds.size < bundle.input.nodes.length;
}

/** Drops measured sizes of rows that no longer exist (paging nodes of existing parents are kept). */
function pruneMeasured<T>(measured: Map<string, Size>, hierarchy: OrgHierarchy<T>): void {
  for (const id of measured.keys()) {
    const pagingParent = id.endsWith(PAGING_SUFFIX) ? id.slice(0, -PAGING_SUFFIX.length) : null;
    if (!hierarchy.nodes.has(id) && !(pagingParent !== null && hierarchy.nodes.has(pagingParent))) {
      measured.delete(id);
    }
  }
}

/**
 * Derives React Flow nodes/edges laid out exactly like d3-org-chart, and owns expand/collapse,
 * paging, measured sizes and position animation. Use with <OrgChart chart={…}/>, or pass
 * nodes/edges/onNodesChange to your own <ReactFlow> inside <OrgChartProvider chart={…}>.
 *
 * Inline `data`, accessors and `nodeSize` are fine: layouts are cached structurally, and a new
 * transition starts only when the geometry changes. Ids of removed rows are pruned from the
 * expansion state. React Flow 'remove' changes are ignored (nodes are derived from `data`).
 */
export function useOrgChart<T>(options: UseOrgChartOptions<T>): UseOrgChartResult<T> {
  const {
    data,
    getId = defaultGetId as (item: T) => string | number,
    getParentId = defaultGetParentId as (item: T) => string | number | null | undefined,
    nodeSize,
    pagingNodeSize,
    measure = false,
    nodeType = 'orgChart',
    pagingNodeType = 'orgChartPaging',
    edgeType = 'orgChart',
    initialExpandLevel = 1,
    expandedIds: controlledIds,
    onExpandedIdsChange,
    paging,
    linkYOffset = 30,
    animationDuration = 400,
  } = options;

  const { orientation, compact, siblingsMargin, childrenMargin, neighbourMargin, compactMarginPair, compactMarginBetween } =
    options;
  const layoutOptions = useMemo<Partial<OrgChartLayoutOptions>>(
    () => ({ orientation, compact, siblingsMargin, childrenMargin, neighbourMargin, compactMarginPair, compactMarginBetween }),
    [orientation, compact, siblingsMargin, childrenMargin, neighbourMargin, compactMarginPair, compactMarginBetween],
  );

  // Hierarchy -------------------------------------------------------------------------------
  const built = useMemo((): Built<T> => {
    try {
      return { hierarchy: buildHierarchy(data, getId, getParentId), error: null };
    } catch (e) {
      if (e instanceof OrgChartDataError) return { hierarchy: null, error: e };
      throw e;
    }
  }, [data, getId, getParentId]);
  const hierarchy = built.hierarchy;

  const pageSize = paging ? paging.pageSize : undefined;
  const pageStep = paging ? paging.step : undefined;
  const pagingOptions = useMemo<PagingOptions | false>(
    () => (pageSize === undefined || pageStep === undefined ? false : { pageSize, step: pageStep }),
    [pageSize, pageStep],
  );

  // Expansion + paging state ------------------------------------------------------------------
  const [internalIds, setInternalIds] = useState<ReadonlySet<string> | null>(null);
  const [rawPageLimits, setPageLimits] = useState<ReadonlyMap<string, number>>(EMPTY_LIMITS);
  const controlled = controlledIds !== undefined;
  const expandedIds = useMemo((): ReadonlySet<string> => {
    if (!hierarchy) return EMPTY_IDS;
    if (controlledIds !== undefined) return new Set(controlledIds);
    // Until the first action, the expansion follows initialExpandLevel on the current data.
    return internalIds ? pruneIds(internalIds, hierarchy) : expandedIdsForLevel(hierarchy, initialExpandLevel);
  }, [hierarchy, controlledIds, internalIds, initialExpandLevel]);
  const pageLimits = useMemo(
    () => (hierarchy ? pruneLimits(rawPageLimits, hierarchy) : rawPageLimits),
    [hierarchy, rawPageLimits],
  );

  const measuredRef = useRef(new Map<string, Size>());
  useEffect(() => {
    if (!hierarchy) return;
    setInternalIds((ids) => (ids ? pruneIds(ids, hierarchy) : ids));
    setPageLimits((limits) => pruneLimits(limits, hierarchy));
    pruneMeasured(measuredRef.current, hierarchy);
  }, [hierarchy]);

  // Visible tree → sizes → layout ------------------------------------------------------------
  const visible = useMemo(
    () => (hierarchy ? getVisibleTree(hierarchy, { expandedIds, paging: pagingOptions, pageLimits }) : null),
    [hierarchy, expandedIds, pagingOptions, pageLimits],
  );

  const [sizeVersion, setSizeVersion] = useState(0);
  const sizeFn = typeof nodeSize === 'function' ? nodeSize : null;
  const sizeW = typeof nodeSize === 'object' ? nodeSize.width : undefined;
  const sizeH = typeof nodeSize === 'object' ? nodeSize.height : undefined;
  const pagingW = pagingNodeSize?.width;
  const pagingH = pagingNodeSize?.height;
  const layoutInput = useMemo(() => {
    if (!hierarchy || !visible) return null;
    void sizeVersion; // measuredRef changed
    return resolveLayoutInput(visible, hierarchy, {
      nodeSize: sizeFn ?? (sizeW !== undefined && sizeH !== undefined ? { width: sizeW, height: sizeH } : undefined),
      pagingNodeSize: pagingW !== undefined && pagingH !== undefined ? { width: pagingW, height: pagingH } : undefined,
      measure,
      measured: measuredRef.current,
    });
  }, [hierarchy, visible, sizeFn, sizeW, sizeH, pagingW, pagingH, measure, sizeVersion]);

  const { bundle, error: layoutError } = useLayoutBundle(layoutInput, layoutOptions);
  const error = built.error ?? layoutError;

  // layoutVersion / lastActionNodeId (render-phase tracking, idempotent) -----------------------
  const pendingRef = useRef<PendingAction | null>(null);
  const trackRef = useRef<LayoutTrack>({ bundle: null, layout: null, version: 0, actionNodeId: null });
  // Compared by content: a data change re-creates the sets without applying a pending action (and a
  // controlled parent may ignore the action altogether), which must not hand its id to the layout.
  const pendingBefore = pendingRef.current;
  const pendingApplied =
    pendingBefore !== null &&
    (!sameSet(pendingBefore.expanded, expandedIds) || !sameNumberMap(pendingBefore.limits, pageLimits));
  if (trackRef.current.bundle !== bundle) {
    const prev = trackRef.current;
    const layout = bundle?.layout ?? null;
    let { version, actionNodeId } = prev;
    if (layout !== prev.layout) {
      if (layout) version += 1;
      if (pendingApplied) {
        actionNodeId = pendingBefore.id;
      } else if (!(measure && bundle && prev.bundle && onlySizesDiffer(prev.bundle, bundle) && hasUnmeasured(prev.bundle))) {
        // Data, option or programmatic changes clear the action. A measurement relayout keeps it
        // only while it is still measuring the nodes the action revealed: a later resize of an
        // already measured card is not part of the action (<OrgChart> would re-centre on it).
        actionNodeId = null;
      }
    }
    trackRef.current = { bundle, layout, version, actionNodeId };
  }
  // Once applied (with or without a new layout), the action is done.
  if (pendingApplied) pendingRef.current = null;
  const track = trackRef.current;

  // Flow elements (structurally cached so re-created rows do not churn React Flow) ------------
  const elementsRef = useRef<FlowElements<T>>(EMPTY_ELEMENTS);
  const nextElements = useMemo(
    (): FlowElements<T> =>
      bundle && hierarchy && visible && !error
        ? buildFlowElements(bundle, hierarchy, visible, expandedIds, {
            nodeType,
            pagingNodeType,
            edgeType,
            linkYOffset,
            fixedSize: !measure,
            measure,
            pagingStep: pageStep ?? null,
          })
        : EMPTY_ELEMENTS,
    [bundle, hierarchy, visible, expandedIds, nodeType, pagingNodeType, edgeType, linkYOffset, measure, pageStep, error],
  );
  if (!sameElements(elementsRef.current, nextElements)) elementsRef.current = nextElements;
  const elements = elementsRef.current;

  // Measured sizes ------------------------------------------------------------------------------
  const measureStateRef = useRef({ measure, bundle });
  useIsomorphicLayoutEffect(() => {
    measureStateRef.current = { measure, bundle };
  });
  const handleNodeChanges = useCallback((changes: readonly NodeChange<OrgChartFlowNode<T>>[]) => {
    const { measure: measuring, bundle: current } = measureStateRef.current;
    if (!measuring) return;
    let relayout = false;
    for (const c of changes) {
      if (c.type !== 'dimensions' || !c.dimensions) continue;
      const size = { width: c.dimensions.width, height: c.dimensions.height };
      const known = measuredRef.current.get(c.id);
      if (!known || sizeDiffers(known, size)) measuredRef.current.set(c.id, size);
      const laidOut = current?.layout.nodeById.get(c.id);
      if (laidOut && (!current!.input.measuredIds.has(c.id) || sizeDiffers(laidOut, size))) relayout = true;
    }
    if (relayout) setSizeVersion((v) => v + 1);
  }, []);

  // Displayed nodes / animation ------------------------------------------------------------------
  const reducedMotion = usePrefersReducedMotion();
  const effectiveDuration = reducedMotion ? 0 : Math.max(0, animationDuration);
  const currentOrientation = bundle?.layout.options.orientation ?? orientation ?? 'top';
  const flow = useAnimatedFlow(elements, currentOrientation, error ? 0 : effectiveDuration, handleNodeChanges);

  // Actions ---------------------------------------------------------------------------------------
  const stateRef = useRef<ActionState<T>>({
    hierarchy,
    expandedIds,
    renderedExpandedIds: expandedIds,
    pageLimits,
    paging: pagingOptions,
    controlled,
    onExpandedIdsChange,
  });
  useIsomorphicLayoutEffect(() => {
    stateRef.current = {
      hierarchy,
      expandedIds,
      renderedExpandedIds: expandedIds,
      pageLimits,
      paging: pagingOptions,
      controlled,
      onExpandedIdsChange,
    };
  });

  const actions = useMemo((): OrgChartActions => {
    const apply = (next: ReadonlySet<string>, actionNodeId: string | null, limits?: ReadonlyMap<string, number>) => {
      const s = stateRef.current;
      const expandedChanged = !sameSet(next, s.expandedIds);
      if (!expandedChanged && !limits) return;
      pendingRef.current = { id: actionNodeId, expanded: s.expandedIds, limits: s.pageLimits };
      if (limits) {
        s.pageLimits = limits;
        setPageLimits(limits);
      }
      if (expandedChanged) {
        // Eager in controlled mode too, so chained calls in one handler build on each other. The
        // next render resets it to the expandedIds prop; a parent that ignores the change may not
        // re-render, so the end of the current task resets it as well.
        s.expandedIds = next;
        if (s.controlled) {
          queueMicrotask(() => {
            if (stateRef.current === s) s.expandedIds = s.renderedExpandedIds;
          });
        } else {
          setInternalIds(next);
        }
        s.onExpandedIdsChange?.([...next]);
      }
    };
    const revealing = (id: string, actionNodeId: string | null, expandSelf: boolean) => {
      const { hierarchy: h, expandedIds: current, pageLimits: limits, paging: p } = stateRef.current;
      const node = h?.nodes.get(id);
      if (!h || !node) return;
      const next = new Set(current);
      const nextLimits = new Map(limits);
      const limitsChanged = revealInPlace(h, id, next, nextLimits, p);
      if (expandSelf && node.childIds.length > 0) next.add(id);
      apply(next, actionNodeId, limitsChanged ? nextLimits : undefined);
    };
    const expand = (id: string) => revealing(id, id, true);
    const collapse = (id: string) => {
      const { expandedIds: current } = stateRef.current;
      if (!current.has(id)) return;
      const next = new Set(current);
      next.delete(id);
      apply(next, id);
    };
    const resetToLevel = (level: number) => {
      const h = stateRef.current.hierarchy;
      if (h) apply(expandedIdsForLevel(h, level), null);
    };
    return {
      toggle(id) {
        const { hierarchy: h, expandedIds: current } = stateRef.current;
        const node = h?.nodes.get(id);
        if (!node || node.childIds.length === 0) return;
        if (current.has(id)) collapse(id);
        else expand(id);
      },
      expand,
      collapse,
      expandAll() {
        const h = stateRef.current.hierarchy;
        if (h) apply(allParentIds(h), null);
      },
      collapseAll() {
        resetToLevel(0);
      },
      collapseToLevel: resetToLevel,
      reveal(id) {
        revealing(id, null, false);
      },
      showMore(parentId) {
        const { hierarchy: h, paging: p, pageLimits: limits, expandedIds: current } = stateRef.current;
        const node = h?.nodes.get(parentId);
        if (!p || !node) return;
        const limit = limits.get(parentId) ?? p.pageSize;
        if (limit >= node.childIds.length) return;
        apply(current, parentId, new Map(limits).set(parentId, limit + p.step));
      },
    };
  }, []);

  return {
    nodes: error ? NO_NODES : flow.nodes,
    edges: error ? NO_EDGES : flow.edges,
    onNodesChange: flow.onNodesChange,
    layout: error ? null : track.layout,
    layoutVersion: track.version,
    hierarchy,
    error,
    expandedIds,
    orientation: currentOrientation,
    lastActionNodeId: track.actionNodeId,
    isAnimating: flow.isAnimating,
    animationDuration: effectiveDuration,
    ...actions,
  };
}
