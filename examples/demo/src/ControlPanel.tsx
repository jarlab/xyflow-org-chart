import { useState, type ReactNode } from 'react';
import type { Orientation } from 'xyflow-org-chart';
import { ANIMATION_DURATIONS, PAGING, type DemoSettings, type NodeStyle } from './settings';

export interface ControlPanelProps {
  settings: DemoSettings;
  onChange(patch: Partial<DemoSettings>): void;
  compare: boolean;
  onCompareChange(compare: boolean): void;
  onExpandAll(): void;
  onCollapseAll(): void;
  onFit(): void;
  stats: { people: number; cards: number; layoutVersion: number };
  error: string | null;
}

const ORIENTATIONS: ReadonlyArray<{ value: Orientation; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const LINK_OFFSETS: ReadonlyArray<{ value: DemoSettings['linkYOffset']; label: string }> = [
  { value: 30, label: '30' },
  { value: 0, label: '0' },
];

const NODE_STYLES: ReadonlyArray<{ value: NodeStyle; label: string }> = [
  { value: 'default', label: 'OrgChartNode' },
  { value: 'employee', label: 'EmployeeNode' },
];

export function ControlPanel({
  settings,
  onChange,
  compare,
  onCompareChange,
  onExpandAll,
  onCollapseAll,
  onFit,
  stats,
  error,
}: ControlPanelProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`panel controls${open ? '' : ' controls--closed'}`}>
      <div className="panel__header">
        <div>
          <div className="panel__title">xyflow-org-chart</div>
          <div className="panel__subtitle">d3-org-chart's layout on React Flow</div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-expanded={open}
          aria-label={open ? 'Hide controls' : 'Show controls'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '–' : '+'}
        </button>
      </div>

      {open && (
        <>
          <Field label="Orientation">
            <Segmented
              label="Orientation"
              value={settings.orientation}
              options={ORIENTATIONS}
              onChange={(orientation) => onChange({ orientation })}
            />
          </Field>
          <Field label="Link offset" hint="linkYOffset (top/bottom)">
            <Segmented
              label="Link offset"
              value={settings.linkYOffset}
              options={LINK_OFFSETS}
              onChange={(linkYOffset) => onChange({ linkYOffset })}
            />
          </Field>
          <Field label="Node" hint={settings.measure ? 'Measure mode uses EmployeeNode' : undefined}>
            <Segmented
              label="Node style"
              value={settings.measure ? 'employee' : settings.nodeStyle}
              options={NODE_STYLES}
              disabled={settings.measure}
              onChange={(nodeStyle) => onChange({ nodeStyle })}
            />
          </Field>

          <div className="switches">
            <Switch checked={settings.compact} onChange={(compact) => onChange({ compact })}>
              Compact grids
            </Switch>
            <Switch checked={settings.measure} onChange={(measure) => onChange({ measure })}>
              Measure DOM sizes <span className="muted">(bios vary card height)</span>
            </Switch>
            <Switch checked={settings.paging} onChange={(paging) => onChange({ paging })}>
              Paging <span className="muted">({PAGING.pageSize} shown, +{PAGING.step} per click)</span>
            </Switch>
          </div>

          <Field label="Animation">
            <select
              className="select"
              aria-label="Animation duration"
              value={settings.animationDuration}
              onChange={(e) => onChange({ animationDuration: Number(e.target.value) })}
            >
              {ANIMATION_DURATIONS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'Off' : `${ms} ms`}
                </option>
              ))}
            </select>
          </Field>

          <div className="button-row">
            <button type="button" className="button" onClick={onExpandAll}>
              Expand all
            </button>
            <button type="button" className="button" onClick={onCollapseAll}>
              Collapse all
            </button>
            <button type="button" className="button" onClick={onFit}>
              Fit
            </button>
          </div>

          <div className="compare-toggle">
            <Switch checked={compare} onChange={onCompareChange}>
              Compare with d3-org-chart
            </Switch>
          </div>

          {error ? (
            <div className="panel__error" role="alert">
              {error}
            </div>
          ) : (
            <div className="panel__stats">
              {stats.cards} of {stats.people} people shown · layout #{stats.layoutVersion}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">
        {label}
        {hint && <span className="field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<V extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange(value: V): void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  children: ReactNode;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      <span className="switch__label">{children}</span>
    </label>
  );
}
