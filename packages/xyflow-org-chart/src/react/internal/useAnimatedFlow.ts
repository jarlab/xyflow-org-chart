import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Orientation } from '../../types';
import type { OrgChartFlowEdge, OrgChartFlowNode } from '../types';
import type { FlowElements } from './flowElements';
import { isUnrevealed } from './flowElements';
import { easeCubicInOut } from './geometry';
import { canAnimate, useIsomorphicLayoutEffect } from './hooks';
import {
  applyFrame,
  finishTransition,
  instantNodes,
  mergeContent,
  planTransition,
  sameGeometry,
  sameNodeList,
} from './transition';

const NO_EDGES: OrgChartFlowEdge[] = [];

export interface AnimatedFlow<T> {
  nodes: OrgChartFlowNode<T>[];
  edges: OrgChartFlowEdge[];
  onNodesChange: (changes: NodeChange<OrgChartFlowNode<T>>[]) => void;
  isAnimating: boolean;
}

/** A counter that changes only when the target geometry changes (render-phase cache). */
function useGeometryVersion<T>(nodes: readonly OrgChartFlowNode<T>[]): number {
  const ref = useRef({ nodes, version: 0 });
  if (ref.current.nodes !== nodes) {
    ref.current = {
      nodes,
      version: sameGeometry(ref.current.nodes, nodes) ? ref.current.version : ref.current.version + 1,
    };
  }
  return ref.current.version;
}

/**
 * Controlled React Flow node state for a sequence of target layouts. Changes from React Flow are
 * applied with applyNodeChanges, and every layout or animation frame is merged into the previous
 * node objects, so `measured` and handle bounds are never dropped (layout-algorithm.md §10.6).
 * A new transition starts only when the geometry changes; data-only updates (e.g. re-created
 * rows) are overlaid on the displayed nodes without disturbing a running animation.
 *
 * @param duration transition length in ms; 0 jumps to the target.
 * @param onChanges called with the node changes React Flow reported, after they were applied.
 */
export function useAnimatedFlow<T>(
  target: FlowElements<T>,
  orientation: Orientation,
  duration: number,
  onChanges: (changes: readonly NodeChange<OrgChartFlowNode<T>>[]) => void,
): AnimatedFlow<T> {
  const [nodes, setNodes] = useState<OrgChartFlowNode<T>[]>(() => target.nodes);
  const displayRef = useRef<OrgChartFlowNode<T>[]>(nodes);
  const [exitingEdges, setExitingEdgesState] = useState<OrgChartFlowEdge[]>(NO_EDGES);
  const exitingEdgesRef = useRef<OrgChartFlowEdge[]>(NO_EDGES);
  const prevTargetEdgesRef = useRef<OrgChartFlowEdge[]>(target.edges);
  const [isAnimating, setIsAnimating] = useState(false);
  const targetRef = useRef(target);
  const onChangesRef = useRef(onChanges);
  useIsomorphicLayoutEffect(() => {
    onChangesRef.current = onChanges;
    targetRef.current = target;
  });
  const geometryVersion = useGeometryVersion(target.nodes);

  const commit = useCallback((next: OrgChartFlowNode<T>[]) => {
    if (sameNodeList(next, displayRef.current)) return;
    displayRef.current = next;
    setNodes(next);
  }, []);

  const setExitingEdges = useCallback((edges: OrgChartFlowEdge[]) => {
    exitingEdgesRef.current = edges;
    setExitingEdgesState(edges);
  }, []);

  // New geometry → new transition (interrupting any running one from the displayed positions).
  useIsomorphicLayoutEffect(() => {
    const goal = targetRef.current;
    const prev = displayRef.current;
    const prevEdges = [...prevTargetEdgesRef.current, ...exitingEdgesRef.current];
    prevTargetEdgesRef.current = goal.edges;
    if (duration <= 0 || !canAnimate() || !prev.some((n) => !isUnrevealed(n))) {
      commit(instantNodes(prev, goal.nodes));
      setExitingEdges(NO_EDGES);
      setIsAnimating(false);
      return;
    }

    const plan = planTransition(prev, goal.nodes, orientation);
    commit(plan.start);
    // Incoming edges of exiting nodes stay until the exit animation ends.
    const present = new Set(plan.start.map((n) => n.id));
    const exitEdges = prevEdges.filter((e) => plan.exiting.has(e.target) && present.has(e.source));
    setExitingEdges(exitEdges.length > 0 ? exitEdges : NO_EDGES);
    if (plan.tweens.size === 0) {
      setIsAnimating(false);
      return;
    }

    setIsAnimating(true);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / duration));
      if (t < 1) {
        commit(applyFrame(displayRef.current, plan, easeCubicInOut(t)));
        raf = requestAnimationFrame(step);
        return;
      }
      commit(finishTransition(displayRef.current, plan));
      setExitingEdges(NO_EDGES);
      setIsAnimating(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [geometryVersion, orientation, duration, commit, setExitingEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<OrgChartFlowNode<T>>[]) => {
      // Nodes are derived from the data: ignore remove/add/replace (e.g. the Delete key).
      const relevant = changes.filter((c) => c.type === 'dimensions' || c.type === 'position' || c.type === 'select');
      if (relevant.length === 0) return;
      commit(applyNodeChanges(relevant, displayRef.current));
      onChangesRef.current(relevant);
    },
    [commit],
  );

  // Until the transition effect runs, exitingEdges may still hold edges the new target re-adds
  // (re-expanding mid-exit): the target's copy wins, so edge ids stay unique.
  const edges = useMemo(() => {
    if (exitingEdges.length === 0) return target.edges;
    const ids = new Set(target.edges.map((e) => e.id));
    const extra = exitingEdges.filter((e) => !ids.has(e.id));
    return extra.length > 0 ? [...target.edges, ...extra] : target.edges;
  }, [target.edges, exitingEdges]);

  // Content (data, node type) of a data-only change is folded into the displayed state, so later
  // node changes keep the identity of every node they do not touch. mergeContent returns the same
  // array when nothing differs, so this cannot loop. It runs after the transition effect, which
  // already merges the content of a geometry change.
  useIsomorphicLayoutEffect(() => {
    commit(mergeContent(displayRef.current, target.nodes));
  }, [target.nodes, commit]);

  // The render before that effect overlays the content too, so new data is never shown late.
  const shown = useMemo(() => mergeContent(nodes, target.nodes), [nodes, target.nodes]);

  return { nodes: shown, edges, onNodesChange, isAnimating };
}
