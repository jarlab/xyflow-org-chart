// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { OrgChart } from '../../src/react/OrgChart';
import { useOrgChart } from '../../src/react/useOrgChart';
import { useOrgChartViewport, type OrgChartViewport } from '../../src/react/viewport';

interface Row {
  id: string;
  parentId: string | null;
}

const rows: Row[] = [
  { id: 'r', parentId: null },
  { id: 'a', parentId: 'r' },
  { id: 'b', parentId: 'r' },
];

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
  class DOMMatrixReadOnlyStub {
    m22 = 1;
  }
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub;
});

interface Handles {
  viewport: OrgChartViewport;
  getViewport: () => { x: number; y: number; zoom: number };
  setZoom: (zoom: number) => Promise<boolean>;
}

function Probe({ onReady }: { onReady: (h: Handles) => void }) {
  const viewport = useOrgChartViewport();
  const rf = useReactFlow();
  const store = useStoreApi();
  store.setState({ width: 1200, height: 800 });
  onReady({ viewport, getViewport: rf.getViewport, setZoom: (zoom) => rf.setViewport({ x: 0, y: 0, zoom }) });
  return null;
}

function setup() {
  let handles: Handles | null = null;
  function Chart() {
    const chart = useOrgChart<Row>({ data: rows, animationDuration: 0, compact: false });
    return (
      <OrgChart chart={chart} fitOnInit={false}>
        <Probe onReady={(h) => (handles = h)} />
      </OrgChart>
    );
  }
  render(<Chart />);
  return () => handles!;
}

describe('useOrgChartViewport', () => {
  it("fit reproduces d3-org-chart's k = 0.9 / max(bw/W, bh/H) on the bbox padded by 50", async () => {
    const get = setup();
    await act(async () => {
      await get().viewport.fit({ duration: 0, nodeIds: ['r'] });
    });
    // root card: (-125, 0, 250, 150) padded by 50 → 350 × 250 → k = 0.9 / max(350/1200, 250/800) = 2.88
    const v = get().getViewport();
    expect(v.zoom).toBeCloseTo(2.88, 6);
    expect(v.x).toBeCloseTo(600 - 0 * 2.88, 6);
    expect(v.y).toBeCloseTo(400 - 75 * 2.88, 6);
  });

  it('caps the fit zoom at maxZoom and centres on a node with its children keeping the zoom', async () => {
    const get = setup();
    await act(async () => {
      await get().viewport.fit({ duration: 0, nodeIds: ['r'], maxZoom: 2 });
    });
    expect(get().getViewport().zoom).toBe(2);
    await act(async () => {
      await get().setZoom(0.5);
      await get().viewport.centerOn('r', { duration: 0 });
    });
    const v = get().getViewport();
    expect(v.zoom).toBe(0.5);
    // r + a + b: cards span y 0..360 (150 + 60 + 150); x symmetric around 0.
    expect(v.x).toBeCloseTo(600, 6);
    expect(v.y).toBeCloseTo(400 - 180 * 0.5, 6);
  });
});

describe('<OrgChart fitOnInit>', () => {
  type Api = ReturnType<typeof useStoreApi>;
  function setupFit(initial: { width: number; height: number }) {
    let api: Api | null = null;
    let rf: ReturnType<typeof useReactFlow> | null = null;
    let measure: () => void = () => {};
    function Grab() {
      api = useStoreApi();
      rf = useReactFlow();
      return null;
    }
    function Chart() {
      const chart = useOrgChart<Row>({ data: rows, animationDuration: 0, compact: false });
      // jsdom does not measure: report the card sizes the way React Flow would.
      measure = () =>
        chart.onNodesChange(chart.nodes.map((n) => ({ type: 'dimensions', id: n.id, dimensions: { width: 250, height: 150 } })));
      return (
        <OrgChart chart={chart}>
          <Grab />
        </OrgChart>
      );
    }
    render(<Chart />);
    const setPane = async (size: { width: number; height: number }) => {
      await act(async () => {
        api!.setState(size);
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    const init = async () => {
      await setPane(initial);
      await act(async () => measure());
    };
    return { setPane, init, viewport: () => rf!.getViewport(), rf: () => rf! };
  }
  // r + a + b with compact off: cards span x -260..260, y 0..360 → padded 620 × 460.
  const fitZoom = (w: number, h: number) => 0.9 / Math.max(620 / w, 460 / h);

  it('fits once the pane gets a size when it had none, and refits once when the fallback size changes', async () => {
    const t = setupFit({ width: 0, height: 0 }); // hidden pane: React Flow keeps width/height 0
    await t.init();
    expect(t.viewport()).toEqual({ x: 0, y: 0, zoom: 1 });
    await t.setPane({ width: 500, height: 500 }); // React Flow's fallback for a visible 0×0 pane
    expect(t.viewport().zoom).toBeCloseTo(fitZoom(500, 500), 9);
    await t.setPane({ width: 1200, height: 800 });
    expect(t.viewport().zoom).toBeCloseTo(fitZoom(1200, 800), 9);
    await t.setPane({ width: 1000, height: 700 }); // only once
    expect(t.viewport().zoom).toBeCloseTo(fitZoom(1200, 800), 9);
  });

  it('does not refit after the user moved the viewport', async () => {
    const t = setupFit({ width: 500, height: 500 });
    await t.init();
    expect(t.viewport().zoom).toBeCloseTo(fitZoom(500, 500), 9);
    await act(async () => {
      await t.rf().setViewport({ x: 10, y: 20, zoom: 0.3 });
    });
    await t.setPane({ width: 1200, height: 800 });
    expect(t.viewport()).toEqual({ x: 10, y: 20, zoom: 0.3 });
  });
});
