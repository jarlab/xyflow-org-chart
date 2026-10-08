import type { Orientation, PagingOptions, Size } from 'xyflow-org-chart';

export type NodeStyle = 'default' | 'employee';

export interface DemoSettings {
  orientation: Orientation;
  compact: boolean;
  /** d3-org-chart's linkYOffset: 30 (its default) or 0 (bus centred in the gap). */
  linkYOffset: 30 | 0;
  nodeStyle: NodeStyle;
  /** Lay out with DOM-measured card sizes (EmployeeNode with bios, natural height). */
  measure: boolean;
  paging: boolean;
  animationDuration: number;
}

export const DEFAULT_SETTINGS: DemoSettings = {
  orientation: 'top',
  compact: true,
  linkYOffset: 30,
  nodeStyle: 'employee',
  measure: false,
  paging: false,
  animationDuration: 400,
};

/** Settings whose change moves cards around, so the view is re-fitted afterwards. */
export const LAYOUT_SETTINGS: ReadonlyArray<keyof DemoSettings> = ['orientation', 'compact', 'measure', 'paging'];

export const ANIMATION_DURATIONS: readonly number[] = [0, 200, 400, 800, 1500];

/** Card size shared by both panes (and the initial guess in measure mode). */
export const NODE_SIZE: Size = { width: 250, height: 118 };

export const PAGING: PagingOptions = { pageSize: 5, step: 5 };

/** Start fully expanded so both panes of the compare view show the whole org. */
export const INITIAL_EXPAND_LEVEL = 99;

/** Node types registered by App (see nodeTypes there). */
export function nodeTypeFor(settings: DemoSettings): string {
  if (settings.measure) return 'employeeMeasured';
  return settings.nodeStyle === 'employee' ? 'employee' : 'orgChart';
}
