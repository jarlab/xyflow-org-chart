import { useEffect, useState, type CSSProperties } from 'react';
import { useOrgChartContext, useOrgChartViewport } from 'xyflow-org-chart';
import { DEPARTMENT_COLORS, initialsOf, PEOPLE_BY_ID, type Person, type ReportCounts } from './data';

export interface DetailsPanelProps {
  person: Person;
  counts: ReportCounts | undefined;
  /** The person's children are currently shown. */
  expanded: boolean;
  onSelect(id: string): void;
  onClose(): void;
}

/** Details of the clicked card. Must render inside <OrgChart> (uses its context and viewport). */
export function DetailsPanel({ person, counts, expanded, onSelect, onClose }: DetailsPanelProps) {
  const { layout, toggle, reveal } = useOrgChartContext();
  const viewport = useOrgChartViewport();
  const [pendingCenter, setPendingCenter] = useState<string | null>(null);

  const visible = layout?.nodeById.has(person.id) ?? false;
  const manager = person.parentId !== null ? PEOPLE_BY_ID.get(person.parentId) : undefined;
  const direct = counts?.direct ?? 0;

  // reveal() expands ancestors; centre once the new layout contains the card.
  useEffect(() => {
    if (pendingCenter && layout?.nodeById.has(pendingCenter)) {
      setPendingCenter(null);
      void viewport.centerOn(pendingCenter, { withChildren: false });
    }
  }, [pendingCenter, layout, viewport]);

  const showInChart = () => {
    if (visible) {
      void viewport.centerOn(person.id, { withChildren: false });
    } else {
      reveal(person.id);
      setPendingCenter(person.id);
    }
  };

  return (
    <div className="panel details" style={{ '--dept': DEPARTMENT_COLORS[person.department] } as CSSProperties & { '--dept': string }}>
      <div className="details__head">
        <div className="employee__avatar details__avatar" aria-hidden="true">
          {initialsOf(person)}
        </div>
        <div className="details__text">
          <div className="details__name">{person.name}</div>
          <div className="details__title">{person.title}</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </div>

      <dl className="details__facts">
        <dt>Department</dt>
        <dd>
          <span className="employee__dept">{person.department}</span>
        </dd>
        <dt>Location</dt>
        <dd>{person.location}</dd>
        <dt>Manager</dt>
        <dd>
          {manager ? (
            <button type="button" className="link-button" onClick={() => onSelect(manager.id)}>
              {manager.name}
            </button>
          ) : (
            '—'
          )}
        </dd>
        <dt>Reports</dt>
        <dd>{direct > 0 ? `${direct} direct · ${counts?.total ?? 0} total` : 'None'}</dd>
      </dl>

      {person.bio && <p className="details__bio">{person.bio}</p>}

      <div className="button-row">
        <button type="button" className="button" onClick={showInChart}>
          {visible ? 'Center' : 'Reveal'}
        </button>
        {direct > 0 && visible && (
          <button type="button" className="button" onClick={() => toggle(person.id)}>
            {expanded ? 'Collapse team' : 'Expand team'}
          </button>
        )}
      </div>
    </div>
  );
}
