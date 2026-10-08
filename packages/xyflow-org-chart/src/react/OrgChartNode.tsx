import type { NodeProps } from '@xyflow/react';
import { type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { Orientation } from '../types';
import { useOrgChartActions } from './context';
import { OrgChartHandles } from './OrgChartHandles';
import type { OrgChartFlowNode } from './types';

const BORDER = 'var(--xoc-node-border, var(--xy-node-border, var(--xy-node-border-default, 1px solid #e4e2e9)))';
const BACKGROUND =
  'var(--xoc-node-background, var(--xy-node-background-color, var(--xy-node-background-color-default, #fff)))';
const COLOR = 'var(--xoc-node-color, var(--xy-node-color, var(--xy-node-color-default, inherit)))';

/**
 * Positioned, borderless box filling the node: the containing block of the handles and the expand
 * button. A positioned ancestor with a border would shift every handle inward by the border width
 * (absolute offsets are measured from the padding box), and the edges with them.
 */
const frameStyle: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
};

const cardStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '12px 16px',
  border: BORDER,
  borderRadius: 'var(--xoc-node-radius, 8px)',
  background: BACKGROUND,
  color: COLOR,
  fontFamily: 'inherit',
  textAlign: 'center',
};

const textStyle: CSSProperties = {
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const nameStyle: CSSProperties = { ...textStyle, fontSize: 15, fontWeight: 600 };
const titleStyle: CSSProperties = { ...textStyle, fontSize: 12, opacity: 0.7 };

/** Button centre on the node's outgoing join point, per orientation (layout-algorithm.md §6, §7.7). */
const BUTTON_ANCHOR: Record<Orientation, CSSProperties> = {
  top: { left: '50%', top: '100%' },
  bottom: { left: '50%', top: 0 },
  left: { left: '100%', top: '50%' },
  right: { left: 0, top: '50%' },
};

/** Rotation of a down-pointing chevron so it points toward the children. */
const TOWARD_CHILDREN: Record<Orientation, number> = { top: 0, bottom: 180, left: -90, right: 90 };

const buttonStyle: CSSProperties = {
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
  zIndex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  boxSizing: 'border-box',
  minWidth: 40,
  height: 22,
  padding: '0 6px',
  margin: 0,
  border: BORDER,
  borderRadius: 11,
  background: BACKGROUND,
  color: COLOR,
  font: 'inherit',
  fontSize: 11,
  lineHeight: 1,
  cursor: 'pointer',
  justifyContent: 'center',
};

function readText(item: unknown, ...keys: string[]): string | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  for (const k of keys) {
    const v = (item as Record<string, unknown>)[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return undefined;
}

function Chevron({ rotation }: { rotation: number }): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Expand/collapse pill centred on the node's outgoing join point (d3-org-chart's button position,
 * §7.7), showing the direct-report count. Hidden for nodes without children. Uses the context's
 * toggle(); carries the `nodrag nopan` classes.
 */
export function OrgChartExpandButton(props: { id: string; data: OrgChartFlowNode['data'] }): ReactNode {
  const { id, data } = props;
  const { toggle } = useOrgChartActions();
  if (!data.hasChildren) return null;
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggle(id);
  };
  const n = data.directReports;
  const label = `${data.expanded ? 'Collapse' : 'Expand'} ${n} direct report${n === 1 ? '' : 's'}`;
  const rotation = TOWARD_CHILDREN[data.orientation] + (data.expanded ? 180 : 0);
  return (
    <button
      type="button"
      className="xoc-expand-button nodrag nopan"
      aria-expanded={data.expanded}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ ...buttonStyle, ...BUTTON_ANCHOR[data.orientation] }}
    >
      <span className="xoc-expand-button__count">{n}</span>
      <Chevron rotation={rotation} />
    </button>
  );
}

/**
 * Default card: name/title from item.name|label and item.title|position (fallback: id),
 * OrgChartHandles, and an OrgChartExpandButton. Fills the node box (node.width/height).
 * Structure: `.xoc-node` (borderless frame holding the handles and button) > `.xoc-node__card`.
 */
export function OrgChartNode(props: NodeProps<OrgChartFlowNode>): ReactNode {
  const { id, data } = props;
  const name = readText(data.item, 'name', 'label') ?? id;
  const title = readText(data.item, 'title', 'position');
  return (
    <div className="xoc-node" style={frameStyle}>
      <div className="xoc-node__card" style={cardStyle}>
        <div className="xoc-node__name" style={nameStyle}>
          {name}
        </div>
        {title !== undefined && (
          <div className="xoc-node__title" style={titleStyle}>
            {title}
          </div>
        )}
      </div>
      <OrgChartHandles />
      <OrgChartExpandButton id={id} data={data} />
    </div>
  );
}

const pagingWrapperStyle: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const pagingButtonStyle: CSSProperties = {
  ...buttonStyle,
  position: 'static',
  transform: 'none',
  height: 32,
  borderRadius: 16,
  padding: '0 16px',
  fontSize: 13,
};

/** Default "show N more" node for paging: N = min(hiddenCount, paging.step). */
export function OrgChartPagingNode(props: NodeProps<OrgChartFlowNode>): ReactNode {
  const { data } = props;
  const { showMore } = useOrgChartActions();
  const count = data.nextPageCount ?? data.hiddenCount;
  const parentId = data.parentId;
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (parentId !== null) showMore(parentId);
  };
  return (
    <div className="xoc-paging-node" style={pagingWrapperStyle}>
      <button type="button" className="xoc-paging-button nodrag nopan" onClick={onClick} style={pagingButtonStyle}>
        Show {count} more
      </button>
      <OrgChartHandles />
    </div>
  );
}
