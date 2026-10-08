// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Position, ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type EdgeProps, type NodeProps } from '@xyflow/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { orgChartEdgePath } from '../../src/paths';
import { OrgChartProvider, useOrgChartActions, useOrgChartContext } from '../../src/react/context';
import { OrgChart } from '../../src/react/OrgChart';
import { OrgChartEdge } from '../../src/react/OrgChartEdge';
import { OrgChartHandles } from '../../src/react/OrgChartHandles';
import { OrgChartExpandButton, OrgChartPagingNode } from '../../src/react/OrgChartNode';
import { orgChartEdgeTypes, orgChartNodeTypes } from '../../src/react/nodeTypes';
import type {
  OrgChartActions,
  OrgChartFlowEdge,
  OrgChartFlowNode,
  OrgChartNodeData,
  UseOrgChartOptions,
  UseOrgChartResult,
} from '../../src/react/types';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { Orientation } from '../../src/types';
import { ROWS, stubBrowserApis, type Row } from './helpers';

beforeAll(stubBrowserApis);

function fakeChart(actions: Partial<OrgChartActions> = {}): UseOrgChartResult<Row> {
  const noop = () => {};
  return {
    nodes: [],
    edges: [],
    onNodesChange: noop,
    layout: null,
    layoutVersion: 0,
    hierarchy: null,
    error: null,
    expandedIds: new Set(),
    orientation: 'top',
    lastActionNodeId: null,
    isAnimating: false,
    animationDuration: 0,
    toggle: noop,
    expand: noop,
    collapse: noop,
    expandAll: noop,
    collapseAll: noop,
    collapseToLevel: noop,
    reveal: noop,
    showMore: noop,
    ...actions,
  };
}

function nodeData(patch: Partial<OrgChartNodeData<Row>> = {}): OrgChartNodeData<Row> {
  return {
    kind: 'node',
    item: undefined,
    orientation: 'top',
    depth: 0,
    parentId: null,
    width: 250,
    height: 150,
    hasChildren: true,
    expanded: false,
    directReports: 3,
    totalReports: 5,
    hiddenCount: 0,
    compact: null,
    ...patch,
  };
}

describe('OrgChartEdge', () => {
  const base = {
    id: 'r->a',
    source: 'r',
    target: 'a',
    sourceX: 10,
    sourceY: 150,
    targetX: -200,
    targetY: 210,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  };
  const renderEdge = (props: Partial<EdgeProps<OrgChartFlowEdge>>) =>
    render(
      <svg>
        <OrgChartEdge {...(base as EdgeProps<OrgChartFlowEdge>)} {...props} />
      </svg>,
    );

  it.each<[Orientation, number, { dx: number; dy: number } | null]>([
    ['top', 30, null],
    ['top', 0, { dx: 0, dy: -40 }],
    ['bottom', 30, null],
    ['left', 30, null],
    ['right', 30, { dx: -15, dy: 0 }],
  ])('%s (linkYOffset %i, spine %j): <path d> = orgChartEdgePath', (orientation, linkYOffset, spineFromTarget) => {
    const { container } = renderEdge({ data: { orientation, linkYOffset, spineFromTarget } });
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('d')).toBe(
      orgChartEdgePath({
        orientation,
        source: { x: base.sourceX, y: base.sourceY },
        target: { x: base.targetX, y: base.targetY },
        spineFromTarget,
        linkYOffset,
      }),
    );
    expect(paths[0].getAttribute('class')).toContain('react-flow__edge-path');
  });

  it('defaults to top orientation, linkYOffset 30 without data; passes markers and style', () => {
    const { container } = renderEdge({ markerEnd: 'url(#m)', style: { stroke: 'red' } });
    const path = container.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(
      orgChartEdgePath({ orientation: 'top', source: { x: 10, y: 150 }, target: { x: -200, y: 210 }, linkYOffset: 30 }),
    );
    expect(path.getAttribute('marker-end')).toBe('url(#m)');
    expect(path.style.stroke).toBe('red');
  });
});

describe('OrgChartHandles', () => {
  function HandlesNode(): ReactNode {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <OrgChartHandles />
      </div>
    );
  }
  const nodeTypes = { h: HandlesNode };

  it('renders the 8 zero-size, non-connectable handles on the card border', () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodeTypes={nodeTypes} nodes={[{ id: 'n', type: 'h', position: { x: 0, y: 0 }, data: {}, width: 200, height: 100 }]} edges={[]} />
      </div>,
    );
    const handles = [...container.querySelectorAll<HTMLElement>('.react-flow__handle')];
    expect(handles).toHaveLength(8);
    const byId = Object.fromEntries(handles.map((h) => [h.getAttribute('data-handleid'), h]));
    const expected: [string, 'source' | 'target', string, string, string][] = [
      ['t-top', 'target', 'top', '50%', '0px'],
      ['t-right', 'target', 'right', '100%', '50%'],
      ['t-bottom', 'target', 'bottom', '50%', '100%'],
      ['t-left', 'target', 'left', '0px', '50%'],
      ['s-top', 'source', 'top', '50%', '0px'],
      ['s-right', 'source', 'right', '100%', '50%'],
      ['s-bottom', 'source', 'bottom', '50%', '100%'],
      ['s-left', 'source', 'left', '0px', '50%'],
    ];
    for (const [id, type, pos, left, top] of expected) {
      const h = byId[id];
      expect(h, id).toBeDefined();
      expect(h.classList.contains(type)).toBe(true);
      expect(h.getAttribute('data-handlepos')).toBe(pos);
      expect(h.classList.contains('connectable')).toBe(false);
      expect([id, h.style.left, h.style.top]).toEqual([id, left, top]);
      expect(h.style.width).toBe('0px');
      expect(h.style.height).toBe('0px');
      expect(h.style.minWidth).toBe('0px');
      expect(h.style.minHeight).toBe('0px');
      expect(h.style.transform).toBe('none');
      expect(h.style.position).toBe('absolute');
      expect(h.style.pointerEvents).toBe('none');
      expect(h.style.right).toBe('auto');
      expect(h.style.bottom).toBe('auto');
      expect(h.style.display).not.toBe('none');
    }
  });
});

describe('OrgChartExpandButton / OrgChartPagingNode', () => {
  it('calls toggle(id) on click without propagating', () => {
    const toggle = vi.fn();
    const outer = vi.fn();
    render(
      <OrgChartProvider chart={fakeChart({ toggle })}>
        <div onClick={outer}>
          <OrgChartExpandButton id="a" data={nodeData()} />
        </div>
      </OrgChartProvider>,
    );
    const button = screen.getByRole('button', { name: 'Expand 3 direct reports' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('3');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledWith('a');
    expect(outer).not.toHaveBeenCalled();
  });

  it.each<[Orientation, string, string]>([
    ['top', '50%', '100%'],
    ['bottom', '50%', '0px'],
    ['left', '100%', '50%'],
    ['right', '0px', '50%'],
  ])('%s: sits on the outgoing join point', (orientation, left, top) => {
    render(
      <OrgChartProvider chart={fakeChart()}>
        <OrgChartExpandButton id="a" data={nodeData({ orientation, expanded: true, directReports: 1 })} />
      </OrgChartProvider>,
    );
    const button = screen.getByRole('button', { name: 'Collapse 1 direct report' });
    expect([button.style.left, button.style.top]).toEqual([left, top]);
  });

  it('renders nothing for nodes without children', () => {
    const { container } = render(
      <OrgChartProvider chart={fakeChart()}>
        <OrgChartExpandButton id="a" data={nodeData({ hasChildren: false, directReports: 0 })} />
      </OrgChartProvider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('paging node calls showMore(parentId) with N = nextPageCount', () => {
    const showMore = vi.fn();
    const nodeTypes = { orgChartPaging: OrgChartPagingNode };
    const pagingNode: OrgChartFlowNode<Row> = {
      id: 'r::more',
      type: 'orgChartPaging',
      position: { x: 0, y: 0 },
      width: 200,
      height: 60,
      data: nodeData({ kind: 'paging', parentId: 'r', hasChildren: false, hiddenCount: 7, nextPageCount: 3 }),
    };
    render(
      <OrgChartProvider chart={fakeChart({ showMore })}>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodeTypes={nodeTypes} nodes={[pagingNode]} edges={[]} />
        </div>
      </OrgChartProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }));
    expect(showMore).toHaveBeenCalledWith('r');
  });

  it.each([
    ['OrgChartNode', 'orgChart', nodeData({ item: { id: 'a', parentId: null, name: 'Ada' } })],
    ['OrgChartPagingNode', 'orgChartPaging', nodeData({ kind: 'paging', parentId: 'r', hasChildren: false, hiddenCount: 2 })],
  ] as const)('%s: handles and button sit in a borderless, positioned frame filling the node', (_name, type, data) => {
    // A bordered containing block would put every handle (and edge endpoint) 1px inside the card:
    // found in a real browser, where absolute offsets start at the padding box.
    const node: OrgChartFlowNode<Row> = { id: 'a', type, position: { x: 0, y: 0 }, width: 200, height: 100, data };
    const { container } = render(
      <OrgChartProvider chart={fakeChart()}>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodeTypes={orgChartNodeTypes} nodes={[node]} edges={[]} />
        </div>
      </OrgChartProvider>,
    );
    const handles = [...container.querySelectorAll<HTMLElement>('.react-flow__handle')];
    expect(handles).toHaveLength(8);
    const frames = new Set(handles.map((h) => h.parentElement!));
    expect(frames.size).toBe(1);
    const frame = [...frames][0];
    expect(frame.parentElement!.classList.contains('react-flow__node')).toBe(true);
    expect(frame.style.position).toBe('relative');
    expect([frame.style.width, frame.style.height]).toEqual(['100%', '100%']);
    expect(frame.style.border).toBe('');
    expect(frame.style.padding).toBe('');
    const button = container.querySelector('.xoc-expand-button');
    if (button) expect(button.parentElement).toBe(frame);
  });

  it('the context hooks throw outside of a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrgChartActions())).toThrow(/OrgChartProvider/);
    expect(() => renderHook(() => useOrgChartContext())).toThrow(/OrgChartProvider/);
    vi.restoreAllMocks();
  });

  it('actions context value is stable across chart updates', () => {
    const seen: OrgChartActions[] = [];
    function Spy() {
      seen.push(useOrgChartActions());
      return null;
    }
    function Host({ data }: { data: Row[] }) {
      const chart = useOrgChart<Row>({ data, animationDuration: 0 });
      return (
        <OrgChartProvider chart={chart}>
          <Spy />
        </OrgChartProvider>
      );
    }
    const { rerender } = render(<Host data={ROWS} />);
    rerender(<Host data={ROWS.slice(0, 4)} />);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((a) => a === seen[0])).toBe(true);
  });

  it('default node/edge type maps', () => {
    expect(Object.keys(orgChartNodeTypes).sort()).toEqual(['orgChart', 'orgChartPaging']);
    expect(Object.keys(orgChartEdgeTypes)).toEqual(['orgChart']);
  });
});

describe('<OrgChart> smoke', () => {
  function Chart(props: Partial<UseOrgChartOptions<Row>> & { children?: ReactNode }) {
    const { children, ...options } = props;
    const chart = useOrgChart<Row>({ data: ROWS, ...options });
    return (
      <div style={{ width: 800, height: 600 }}>
        <OrgChart chart={chart}>{children}</OrgChart>
      </div>
    );
  }

  it.each<[string, Partial<UseOrgChartOptions<Row>>]>([
    ['top', {}],
    ['left compact off', { orientation: 'left', compact: false }],
    ['bottom expanded', { orientation: 'bottom', initialExpandLevel: 5 }],
    ['right paging', { orientation: 'right', paging: { pageSize: 1, step: 1 } }],
    ['measure', { measure: true }],
    ['bad data', { data: [{ id: 'x', parentId: 'y', name: '' }] }],
  ])('renders without crashing: %s', (_, options) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = render(
      <StrictMode>
        <Chart {...options} />
      </StrictMode>,
    );
    expect(container.querySelector('.react-flow')).not.toBeNull();
    unmount();
    expect(errors).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('measure mode keeps cards hidden until measured', () => {
    const { container } = render(<Chart measure />);
    const nodes = [...container.querySelectorAll<HTMLElement>('.react-flow__node')];
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => n.style.visibility === 'hidden')).toBe(true);
  });

  it('centres on the toggled node and its children, keeping the zoom', async () => {
    let rf: ReturnType<typeof useReactFlow> | null = null;
    let chartRef: UseOrgChartResult<Row> | null = null;
    function Probe() {
      rf = useReactFlow();
      const store = useStoreApi();
      store.setState({ width: 1200, height: 800 });
      return null;
    }
    function Host() {
      const chart = useOrgChart<Row>({ data: ROWS, animationDuration: 0, compact: false });
      chartRef = chart;
      return (
        <div style={{ width: 1200, height: 800 }}>
          <OrgChart chart={chart} fitOnInit={false}>
            <Probe />
          </OrgChart>
        </div>
      );
    }
    render(<Host />);
    await act(async () => {
      await rf!.setViewport({ x: 0, y: 0, zoom: 0.5 });
    });
    await act(async () => {
      chartRef!.toggle('a');
    });
    const layout = chartRef!.layout!;
    const boxes = ['a', 'a1', 'a2'].map((id) => layout.nodeById.get(id)!);
    const x0 = Math.min(...boxes.map((b) => b.position.x));
    const x1 = Math.max(...boxes.map((b) => b.position.x + b.width));
    const y0 = Math.min(...boxes.map((b) => b.position.y));
    const y1 = Math.max(...boxes.map((b) => b.position.y + b.height));
    const v = rf!.getViewport();
    expect(v.zoom).toBe(0.5);
    expect(v.x).toBeCloseTo(600 - ((x0 + x1) / 2) * 0.5, 6);
    expect(v.y).toBeCloseTo(400 - ((y0 + y1) / 2) * 0.5, 6);
  });

  it('centerOnAction={false} leaves the viewport alone', async () => {
    let rf: ReturnType<typeof useReactFlow> | null = null;
    let chartRef: UseOrgChartResult<Row> | null = null;
    function Probe() {
      rf = useReactFlow();
      useStoreApi().setState({ width: 1200, height: 800 });
      return null;
    }
    function Host() {
      const chart = useOrgChart<Row>({ data: ROWS, animationDuration: 0 });
      chartRef = chart;
      return (
        <OrgChart chart={chart} fitOnInit={false} centerOnAction={false}>
          <Probe />
        </OrgChart>
      );
    }
    render(
      <ReactFlowProvider>
        <Host />
      </ReactFlowProvider>,
    );
    const before = rf!.getViewport();
    await act(async () => {
      chartRef!.toggle('a');
    });
    expect(rf!.getViewport()).toEqual(before);
  });
});

// Type-level checks (run by `npm run typecheck`, which includes the tests).
export function typeChecks(chart: UseOrgChartResult<Row>): ReactNode[] {
  const duration: number = chart.animationDuration;
  void duration;
  return [
    // @ts-expect-error nodeOrigin is fixed to [0, 0] by <OrgChart>
    <OrgChart chart={chart} nodeOrigin={[0.5, 0.5]} />,
    // @ts-expect-error nodes come from `chart`
    <OrgChart chart={chart} defaultNodes={[]} />,
    // @ts-expect-error edges come from `chart`
    <OrgChart chart={chart} defaultEdges={[]} />,
    <OrgChart chart={chart} minZoom={0.1} onNodeClick={() => {}} />,
  ];
}
