import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { OrgChartLayout, Orientation } from '../types';
import type { OrgChartActions, UseOrgChartResult } from './types';

export interface OrgChartContextValue extends OrgChartActions {
  orientation: Orientation;
  layout: OrgChartLayout | null;
  layoutVersion: number;
  lastActionNodeId: string | null;
}

const OrgChartContext = /* @__PURE__ */ createContext<OrgChartContextValue | null>(null);
/** Actions only: stable across layouts, so node components do not re-render on every relayout. */
const OrgChartActionsContext = /* @__PURE__ */ createContext<OrgChartActions | null>(null);

/**
 * Makes the chart's actions (toggle, showMore, …) and layout available to node components and
 * viewport helpers. <OrgChart> renders it for you.
 */
export function OrgChartProvider<T>(props: { chart: UseOrgChartResult<T>; children?: ReactNode }): ReactNode {
  const { chart, children } = props;
  const { toggle, expand, collapse, expandAll, collapseAll, collapseToLevel, reveal, showMore } = chart;
  const actions = useMemo<OrgChartActions>(
    () => ({ toggle, expand, collapse, expandAll, collapseAll, collapseToLevel, reveal, showMore }),
    [toggle, expand, collapse, expandAll, collapseAll, collapseToLevel, reveal, showMore],
  );
  const { orientation, layout, layoutVersion, lastActionNodeId } = chart;
  const value = useMemo<OrgChartContextValue>(
    () => ({ ...actions, orientation, layout, layoutVersion, lastActionNodeId }),
    [actions, orientation, layout, layoutVersion, lastActionNodeId],
  );
  return (
    <OrgChartActionsContext.Provider value={actions}>
      <OrgChartContext.Provider value={value}>{children}</OrgChartContext.Provider>
    </OrgChartActionsContext.Provider>
  );
}

/** Actions + layout of the surrounding OrgChartProvider. Throws outside of one. */
export function useOrgChartContext(): OrgChartContextValue {
  const value = useContext(OrgChartContext);
  if (!value) throw new Error('useOrgChartContext must be used inside <OrgChartProvider> (or <OrgChart>).');
  return value;
}

/** The provider's actions (referentially stable). Throws outside of an OrgChartProvider. */
export function useOrgChartActions(): OrgChartActions {
  const value = useContext(OrgChartActionsContext);
  if (!value) throw new Error('useOrgChartActions must be used inside <OrgChartProvider> (or <OrgChart>).');
  return value;
}
