import { Background, BackgroundVariant, Controls, MiniMap, Panel } from '@xyflow/react';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  OrgChart,
  useOrgChart,
  useOrgChartContext,
  useOrgChartViewport,
  type OrgChartFlowNode,
} from 'xyflow-org-chart';
import { ControlPanel } from './ControlPanel';
import { computeReportCounts, DEPARTMENT_COLORS, PEOPLE, PEOPLE_BY_ID, type Person } from './data';
import { DetailsPanel } from './DetailsPanel';
import { EmployeeMeasuredNode, EmployeeNode } from './EmployeeNode';
import { useFitOnRequest, type FitRequest } from './fit';
import {
  DEFAULT_SETTINGS,
  INITIAL_EXPAND_LEVEL,
  LAYOUT_SETTINGS,
  NODE_SIZE,
  nodeTypeFor,
  PAGING,
  type DemoSettings,
} from './settings';

// d3-org-chart (and its d3 dependencies) only load once compare mode is switched on.
const CompareView = lazy(() => import('./CompareView').then((m) => ({ default: m.CompareView })));

// Defined outside the component so React Flow sees a stable object. <OrgChart> merges in its own
// orgChart / orgChartPaging types.
const nodeTypes = { employee: EmployeeNode, employeeMeasured: EmployeeMeasuredNode };

const REPORT_COUNTS = computeReportCounts(PEOPLE);

function minimapColor(node: OrgChartFlowNode<Person>): string {
  const item = node.data.item;
  return item ? DEPARTMENT_COLORS[item.department] : '#94a3b8';
}

/**
 * Fits our pane when a FitRequest comes due, animated like d3-org-chart's fit() (its `duration`).
 * Renders inside <OrgChart>.
 */
function AutoFit({ request, duration }: { request: FitRequest | null; duration: number }) {
  const { layoutVersion } = useOrgChartContext();
  const viewport = useOrgChartViewport();
  useFitOnRequest(request, layoutVersion, () => void viewport.fit({ duration }));
  return null;
}

export function App() {
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS);
  const [compare, setCompare] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState<FitRequest | null>(null);

  const chart = useOrgChart<Person>({
    data: PEOPLE,
    orientation: settings.orientation,
    compact: settings.compact,
    linkYOffset: settings.linkYOffset,
    nodeSize: NODE_SIZE,
    measure: settings.measure,
    nodeType: nodeTypeFor(settings),
    paging: settings.paging ? PAGING : false,
    animationDuration: settings.animationDuration,
    initialExpandLevel: INITIAL_EXPAND_LEVEL,
  });

  const { layoutVersion } = chart;
  /** waitForLayout: fit the layout the current change is about to produce, not the current one. */
  const requestFit = useCallback(
    (waitForLayout: boolean) =>
      setFitRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, afterVersion: waitForLayout ? layoutVersion : -1 })),
    [layoutVersion],
  );

  const changeSettings = (patch: Partial<DemoSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (LAYOUT_SETTINGS.some((key) => key in patch && patch[key] !== settings[key])) requestFit(true);
  };

  const expandAll = () => {
    chart.expandAll();
    requestFit(true);
  };
  const collapseAll = () => {
    // chart.collapseAll() would leave only the CEO; keep the execs visible too.
    chart.collapseToLevel(1);
    requestFit(true);
  };

  const selected = selectedId !== null ? PEOPLE_BY_ID.get(selectedId) : undefined;
  const stats = useMemo(
    () => ({
      people: PEOPLE.length,
      cards: chart.layout ? chart.layout.nodes.filter((n) => PEOPLE_BY_ID.has(n.id)).length : 0,
      layoutVersion,
    }),
    [chart.layout, layoutVersion],
  );

  const flow = (
    <OrgChart
      chart={chart}
      nodeTypes={nodeTypes}
      colorMode="system"
      onNodeClick={(_event, node) => {
        if (node.data.kind === 'node') setSelectedId(node.id);
      }}
      onPaneClick={() => setSelectedId(null)}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap<OrgChartFlowNode<Person>>
        pannable
        zoomable
        position="bottom-right"
        nodeColor={minimapColor}
        nodeBorderRadius={8}
        ariaLabel="Org chart overview"
      />
      <Panel position="top-left">
        <ControlPanel
            settings={settings}
          onChange={changeSettings}
          compare={compare}
          onCompareChange={setCompare}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onFit={() => requestFit(false)}
          stats={stats}
          error={chart.error?.message ?? null}
        />
      </Panel>
      {selected && (
        <Panel position="top-right">
          <DetailsPanel
            person={selected}
            counts={REPORT_COUNTS.get(selected.id)}
            expanded={chart.expandedIds.has(selected.id)}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        </Panel>
      )}
      <AutoFit request={fitRequest} duration={chart.animationDuration} />
    </OrgChart>
  );

  return (
    <div className="app">
      {compare ? (
        <Suspense fallback={<div className="app__loading">Loading d3-org-chart…</div>}>
          <CompareView
            people={PEOPLE}
            layout={chart.layout}
            layoutVersion={layoutVersion}
            settings={settings}
            duration={chart.animationDuration}
            nodeSize={NODE_SIZE}
            fitRequest={fitRequest}
            onSelect={setSelectedId}
            onToggle={(id) => chart.toggle(id)}
            onShowMore={(parentId) => chart.showMore(parentId)}
          >
            {flow}
          </CompareView>
        </Suspense>
      ) : (
        flow
      )}
    </div>
  );
}
