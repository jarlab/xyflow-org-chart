import {
  ReactFlow,
  useNodesInitialized,
  useStore,
  useStoreApi,
  type NodeOrigin,
  type ReactFlowProps,
  type ReactFlowState,
  type Transform,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { OrgChartProvider, useOrgChartContext } from './context';
import { isUnrevealed } from './internal/flowElements';
import { orgChartEdgeTypes, orgChartNodeTypes } from './nodeTypes';
import type { OrgChartFlowEdge, OrgChartFlowNode, UseOrgChartResult } from './types';
import { useOrgChartViewport } from './viewport';

export interface OrgChartProps<T>
  extends Omit<
    ReactFlowProps<OrgChartFlowNode<T>, OrgChartFlowEdge>,
    // Owned by the chart: nodes/edges come from `chart`, and layout positions are top-left corners.
    'nodes' | 'edges' | 'onNodesChange' | 'defaultNodes' | 'defaultEdges' | 'nodeOrigin'
  > {
  chart: UseOrgChartResult<T>;
  /**
   * Fit the whole chart once the first layout is ready (default true). A pane without a size yet
   * (hidden) is fitted once it gets one; a pane whose size changes after that first fit (e.g. it
   * was 0×0 at load) is refitted once, unless the viewport was moved in between.
   */
  fitOnInit?: boolean;
  /** After toggle/expand/collapse/showMore, centre on that node and its children keeping the zoom (d3-org-chart setActiveNodeCentered, default true). */
  centerOnAction?: boolean;
}

/** Layout positions are top-left corners (layout-algorithm.md §10.3). */
const NODE_ORIGIN: NodeOrigin = [0, 0];

interface ControllerProps {
  fitOnInit: boolean;
  centerOnAction: boolean;
  /** First layout applied and, in measure mode, every card revealed. */
  ready: boolean;
  duration: number;
}

type FitState =
  | { phase: 'idle' | 'busy' | 'done' }
  | { phase: 'fitted'; width: number; height: number; transform: Transform };

const selectPaneWidth = (s: ReactFlowState) => s.width;
const selectPaneHeight = (s: ReactFlowState) => s.height;
const sameTransform = (a: Transform, b: Transform) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Child of <ReactFlow>: fit on init and centre after actions. */
function OrgChartController({ fitOnInit, centerOnAction, ready, duration }: ControllerProps): null {
  const initialized = useNodesInitialized();
  const { layout, layoutVersion, lastActionNodeId } = useOrgChartContext();
  const { fit, centerOn } = useOrgChartViewport();

  const store = useStoreApi<OrgChartFlowNode, OrgChartFlowEdge>();
  const paneWidth = useStore(selectPaneWidth);
  const paneHeight = useStore(selectPaneHeight);
  const fitState = useRef<FitState>({ phase: 'idle' });
  useEffect(() => {
    const state = fitState.current;
    if (!fitOnInit || !initialized || !ready || !layout || !paneWidth || !paneHeight) return;
    if (state.phase === 'busy' || state.phase === 'done') return;
    if (state.phase === 'fitted') {
      // The pane may have had no real size at the first fit (0×0 or hidden: React Flow then
      // assumes 500×500). Refit once when its size changes, unless the user moved the viewport.
      if (state.width === paneWidth && state.height === paneHeight) return;
      if (!sameTransform(store.getState().transform, state.transform)) {
        fitState.current = { phase: 'done' };
        return;
      }
    }
    const refit = state.phase === 'fitted';
    fitState.current = { phase: 'busy' };
    void fit({ duration: 0 }).then((ok) => {
      if (!ok) fitState.current = { phase: 'idle' };
      else if (refit) fitState.current = { phase: 'done' };
      else fitState.current = { phase: 'fitted', width: paneWidth, height: paneHeight, transform: [...store.getState().transform] };
    });
  }, [fitOnInit, initialized, ready, layout, fit, paneWidth, paneHeight, store]);

  const handledVersion = useRef(layoutVersion);
  useEffect(() => {
    if (handledVersion.current === layoutVersion) return;
    handledVersion.current = layoutVersion;
    if (centerOnAction && lastActionNodeId !== null) {
      void centerOn(lastActionNodeId, { withChildren: true, duration });
    }
  }, [layoutVersion, lastActionNodeId, centerOnAction, duration, centerOn]);

  return null;
}

/**
 * <ReactFlow> preconfigured for an org chart: orgChart node/edge types merged with yours,
 * OrgChartProvider, non-draggable/non-connectable nodes, a zoom range wide enough to fit large
 * charts (min 0.05, max 8), fit on init and centring after actions. `children` render inside
 * <ReactFlow> (Background, Controls, Panel, …). `nodeOrigin` is always [0, 0].
 */
export function OrgChart<T>(props: OrgChartProps<T>): ReactNode {
  const {
    chart,
    fitOnInit = true,
    centerOnAction = true,
    nodeTypes,
    edgeTypes,
    children,
    nodesDraggable = false,
    nodesConnectable = false,
    edgesFocusable = false,
    edgesReconnectable = false,
    minZoom = 0.05,
    maxZoom = 8,
    deleteKeyCode = null,
    ...rest
  } = props;

  const mergedNodeTypes = useMemo(() => ({ ...orgChartNodeTypes, ...nodeTypes }), [nodeTypes]);
  const mergedEdgeTypes = useMemo(() => ({ ...orgChartEdgeTypes, ...edgeTypes }), [edgeTypes]);
  const ready = chart.layout !== null && !chart.nodes.some(isUnrevealed);

  return (
    <OrgChartProvider chart={chart}>
      <ReactFlow<OrgChartFlowNode<T>, OrgChartFlowEdge>
        {...rest}
        nodes={chart.nodes}
        edges={chart.edges}
        onNodesChange={chart.onNodesChange}
        nodeTypes={mergedNodeTypes}
        edgeTypes={mergedEdgeTypes}
        nodeOrigin={NODE_ORIGIN}
        nodesDraggable={nodesDraggable}
        nodesConnectable={nodesConnectable}
        edgesFocusable={edgesFocusable}
        edgesReconnectable={edgesReconnectable}
        minZoom={minZoom}
        maxZoom={maxZoom}
        deleteKeyCode={deleteKeyCode}
      >
        <OrgChartController
          fitOnInit={fitOnInit}
          centerOnAction={centerOnAction}
          ready={ready}
          duration={chart.animationDuration}
        />
        {children}
      </ReactFlow>
    </OrgChartProvider>
  );
}
