import { OrgChart as D3OrgChart, type D3OrgChartRowFlags } from 'd3-org-chart';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OrgChartLayout, Size } from 'xyflow-org-chart';
import { d3NodeSize, mirrorLayout, toD3Rows } from './d3Mirror';
import { computeReportCounts, DEPARTMENT_COLORS, initialsOf, type Person, type ReportCounts } from './data';
import { useFitOnRequest, type FitRequest } from './fit';
import { PAGING, type DemoSettings } from './settings';

type Row = Person & D3OrgChartRowFlags;

export interface CompareViewProps {
  people: readonly Person[];
  /** Our current target layout: the d3 pane mirrors its visible set, page limits, sizes and margins. */
  layout: OrgChartLayout | null;
  layoutVersion: number;
  settings: DemoSettings;
  /** Transition length actually used by our pane (chart.animationDuration: 0 under reduced motion). */
  duration: number;
  /** Fallback card size (d3-org-chart's "show more" node when our layout has no paging node). */
  nodeSize: Size;
  fitRequest: FitRequest | null;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onShowMore(parentId: string): void;
  /** Our <OrgChart>, rendered in the right pane. */
  children: ReactNode;
}

/**
 * Side-by-side comparison: the real d3-org-chart 3.1.1 (left) and xyflow-org-chart (right), fed the
 * same rows, sizes, margins, orientation, compact flag, linkYOffset, paging step and duration.
 */
export function CompareView({ layout, children, ...d3Props }: CompareViewProps) {
  const [d3Count, setD3Count] = useState<number | null>(null);
  return (
    <div className="compare">
      <section className="compare__pane" aria-label="d3-org-chart">
        <header className="pane-label">
          <span className="pane-label__dot pane-label__dot--d3" />
          d3-org-chart 3.1.1 <span className="pane-label__muted">original · SVG</span>
          {d3Count !== null && <span className="pane-label__count">{d3Count} cards</span>}
        </header>
        <D3OrgChartPane layout={layout} onRendered={setD3Count} {...d3Props} />
      </section>
      <section className="compare__pane" aria-label="xyflow-org-chart">
        <header className="pane-label">
          <span className="pane-label__dot pane-label__dot--ours" />
          xyflow-org-chart <span className="pane-label__muted">React Flow</span>
          {layout && <span className="pane-label__count">{layout.nodes.length} cards</span>}
        </header>
        <div className="compare__flow">{children}</div>
      </section>
    </div>
  );
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** The same card as EmployeeNode, as an HTML string for d3-org-chart's foreignObject. */
function cardHtml(p: Person, counts: ReportCounts | undefined, showBio: boolean): string {
  const direct = counts?.direct ?? 0;
  const reports =
    direct > 0
      ? `<span class="employee__reports" title="${counts?.total ?? 0} in total">${direct} ${direct === 1 ? 'report' : 'reports'}</span>`
      : '';
  const bio = showBio && p.bio ? `<p class="employee__bio">${escapeHtml(p.bio)}</p>` : '';
  return `<div class="employee employee--d3" style="--dept:${DEPARTMENT_COLORS[p.department]};width:100%;height:100%">
  <div class="employee__head">
    <div class="employee__avatar">${escapeHtml(initialsOf(p))}</div>
    <div class="employee__text">
      <div class="employee__name">${escapeHtml(p.name)}</div>
      <div class="employee__title">${escapeHtml(p.title)}</div>
    </div>
  </div>
  ${bio}
  <div class="employee__meta"><span class="employee__dept">${escapeHtml(p.department)}</span>${reports}</div>
</div>`;
}

interface D3OrgChartPaneProps extends Omit<CompareViewProps, 'children'> {
  onRendered(cardCount: number): void;
}

function D3OrgChartPane({
  people,
  layout,
  layoutVersion,
  settings,
  duration,
  nodeSize,
  fitRequest,
  onSelect,
  onToggle,
  onShowMore,
  onRendered,
}: D3OrgChartPaneProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<D3OrgChart<Row> | null>(null);
  const didInitialFit = useRef(false);
  const callbacks = useRef({ onSelect, onToggle, onShowMore, onRendered });
  useEffect(() => {
    callbacks.current = { onSelect, onToggle, onShowMore, onRendered };
  });

  const peopleIds = useMemo(() => new Set(people.map((p) => p.id)), [people]);
  const counts = useMemo(() => computeReportCounts(people), [people]);

  // One d3-org-chart instance per mount. Its expand and "show more" buttons are rerouted to OUR
  // actions; the pane then re-renders from our state, so both panes stay in lockstep.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const chart = new D3OrgChart<Row>();
    chart.onButtonClick = (event, node) => {
      event.stopPropagation();
      callbacks.current.onToggle(node.data.id);
    };
    chart.loadPagingNodes = (node) => {
      if (node.data.parentId !== null) callbacks.current.onShowMore(node.data.parentId);
    };
    chart
      .container(el)
      .setActiveNodeCentered(false)
      .onNodeClick((node) => callbacks.current.onSelect(node.data.id))
      .linkUpdate(function () {
        this.style.stroke = 'var(--edge-color)';
        this.style.strokeWidth = '1';
      })
      .pagingButton((node, _index, _nodes, state) => {
        const parent = node.parent;
        const hidden = parent ? (parent.data._directSubordinatesPaging ?? 0) - (parent.data._pagingStep ?? 0) : 0;
        const next = parent ? Math.min(hidden, state.pagingStep(parent)) : 0;
        return `<div class="d3-paging"><strong>Show ${next} more</strong><span>${hidden} hidden</span></div>`;
      });
    chartRef.current = chart;
    didInitialFit.current = false;
    return () => {
      chart.clear();
      el.replaceChildren();
      chartRef.current = null;
    };
  }, []);

  // d3-org-chart only reads the container size on render(); keep it current for fit().
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.svgWidth(el.clientWidth).svgHeight(el.clientHeight);
      const svg = el.querySelector('svg.svg-chart-container');
      svg?.setAttribute('width', String(el.clientWidth));
      svg?.setAttribute('height', String(el.clientHeight));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { linkYOffset, measure } = settings;
  useEffect(() => {
    const el = canvasRef.current;
    const chart = chartRef.current;
    if (!el || !chart || !layout) return;

    const mirror = mirrorLayout(layout, (id) => peopleIds.has(id));
    const o = layout.options;

    chart
      .svgWidth(el.clientWidth)
      .svgHeight(el.clientHeight)
      .data(toD3Rows(people, mirror))
      .layout(o.orientation)
      .compact(o.compact)
      .siblingsMargin(() => o.siblingsMargin)
      .childrenMargin(() => o.childrenMargin)
      .neighbourMargin(() => o.neighbourMargin)
      .compactMarginPair(() => o.compactMarginPair)
      .compactMarginBetween(() => o.compactMarginBetween)
      .nodeWidth((node) => d3NodeSize(layout, node, nodeSize).width)
      .nodeHeight((node) => d3NodeSize(layout, node, nodeSize).height)
      .linkYOffset(linkYOffset)
      .duration(duration)
      // Our "show more" reveals PAGING.step; d3-org-chart's own default (5) must not be relied on.
      .pagingStep(() => PAGING.step)
      // 1 = "root's children visible" without flagging anything; 0 (sticky) collapses the root.
      .initialExpandLevel(mirror.rootExpanded ? 1 : 0)
      .nodeContent((node) => cardHtml(node.data, counts.get(node.data.id), measure))
      .render();

    if (!didInitialFit.current) {
      didInitialFit.current = true;
      chart.fit({ animate: false });
    }
    callbacks.current.onRendered(chart.getChartState().allNodes.length);
  }, [layout, layoutVersion, people, peopleIds, counts, nodeSize, linkYOffset, duration, measure]);

  useFitOnRequest(fitRequest, layoutVersion, () => chartRef.current?.fit());

  return (
    <div className="d3-pane">
      <div ref={canvasRef} className="d3-pane__canvas" />
      {!layout && <div className="d3-pane__waiting">Waiting for the first layout…</div>}
    </div>
  );
}
