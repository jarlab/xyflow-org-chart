import type { NodeProps } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { OrgChartExpandButton, OrgChartHandles, type OrgChartFlowNode } from 'xyflow-org-chart';
import { DEPARTMENT_COLORS, initialsOf, type Person } from './data';
import { NODE_SIZE } from './settings';

type EmployeeNodeProps = NodeProps<OrgChartFlowNode<Person>>;

function EmployeeCard({ id, data, selected, measured }: EmployeeNodeProps & { measured: boolean }) {
  const person = data.item;
  if (!person) return null;

  // The handles and the expand button live in a borderless frame, not in the bordered card:
  // absolute offsets start at the padding box, so a card border would pull every edge endpoint
  // 1px inside the card. Fixed mode fills the box React Flow sizes from the layout; measure mode
  // has a fixed width and a natural height that React Flow measures and feeds back into the layout.
  const frame: CSSProperties = measured
    ? { position: 'relative', width: NODE_SIZE.width }
    : { position: 'relative', width: '100%', height: '100%' };
  const card: CSSProperties & { '--dept': string } = {
    '--dept': DEPARTMENT_COLORS[person.department],
    boxSizing: 'border-box',
    width: '100%',
    ...(measured ? {} : { height: '100%' }),
  };

  return (
    <div className="employee-node" style={frame}>
      <div
        className={`employee${measured ? ' employee--measured' : ''}${selected ? ' is-selected' : ''}`}
        style={card}
      >
        <div className="employee__head">
          <div className="employee__avatar" aria-hidden="true">
            {initialsOf(person)}
          </div>
          <div className="employee__text">
            <div className="employee__name" title={person.name}>
              {person.name}
            </div>
            <div className="employee__title" title={person.title}>
              {person.title}
            </div>
          </div>
        </div>
        {measured && person.bio && <p className="employee__bio">{person.bio}</p>}
        <div className="employee__meta">
          <span className="employee__dept">{person.department}</span>
          {data.directReports > 0 && (
            <span className="employee__reports" title={`${data.totalReports} in total`}>
              {data.directReports} {data.directReports === 1 ? 'report' : 'reports'}
            </span>
          )}
        </div>
      </div>
      <OrgChartHandles />
      <OrgChartExpandButton id={id} data={data} />
    </div>
  );
}

/** Fixed-size employee card: fills the node box laid out from NODE_SIZE. */
export const EmployeeNode = memo(function EmployeeNode(props: EmployeeNodeProps) {
  return <EmployeeCard {...props} measured={false} />;
});

/** Measure-mode employee card: fixed width, natural height (bios make heights vary). */
export const EmployeeMeasuredNode = memo(function EmployeeMeasuredNode(props: EmployeeNodeProps) {
  return <EmployeeCard {...props} measured />;
});
