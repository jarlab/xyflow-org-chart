// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { OrgChart } from '../../src/react/OrgChart';
import { useOrgChart } from '../../src/react/useOrgChart';
import type { UseOrgChartOptions } from '../../src/react/types';

interface Row {
  id: string;
  parentId: string | null;
  name: string;
  title?: string;
  meta?: { n: number };
}

const rows: Row[] = [
  { id: 'r', parentId: null, name: 'Root', title: 'CEO' },
  { id: 'a', parentId: 'r', name: 'Alice' },
  { id: 'b', parentId: 'r', name: 'Bob' },
  { id: 'a1', parentId: 'a', name: 'A1' },
];

beforeAll(() => {
  // Minimal browser APIs React Flow needs under jsdom (as in React Flow's testing guide).
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
  class DOMMatrixReadOnlyStub {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? +scale : 1;
    }
  }
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub;
});

function Chart(props: Partial<UseOrgChartOptions<Row>>) {
  const chart = useOrgChart<Row>({ data: rows, animationDuration: 0, compact: false, ...props });
  return (
    <div style={{ width: 800, height: 600 }}>
      <OrgChart chart={chart} />
    </div>
  );
}

describe('<OrgChart>', () => {
  it('renders the default cards, 8 zero-size handles each, and expand buttons (StrictMode)', () => {
    const { container } = render(
      <StrictMode>
        <Chart />
      </StrictMode>,
    );
    expect(screen.getByText('Root')).toBeTruthy();
    expect(screen.getByText('CEO')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('A1')).toBeNull();

    const cards = container.querySelectorAll('.xoc-node');
    expect(cards).toHaveLength(3);
    const handles = cards[0].querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(8);
    const ids = [...handles].map((h) => h.getAttribute('data-handleid')).sort();
    expect(ids).toEqual(['s-bottom', 's-left', 's-right', 's-top', 't-bottom', 't-left', 't-right', 't-top']);
    const style = (handles[0] as HTMLElement).style;
    expect(style.width).toBe('0px');
    expect(style.minHeight).toBe('0px');
    expect(style.transform).toBe('none');

    const rootButton = screen.getByRole('button', { name: 'Collapse 2 direct reports' });
    expect(rootButton.getAttribute('aria-expanded')).toBe('true');
    expect(rootButton.className).toContain('nodrag');
    // Bob has no children → no button.
    expect(screen.getAllByRole('button', { name: /direct report/ })).toHaveLength(2);
  });

  it('toggles a node from its expand button', () => {
    render(<Chart />);
    const button = screen.getByRole('button', { name: 'Expand 1 direct report' });
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.getByText('A1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse 1 direct report' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('does not loop on rows re-created every render with nested objects', () => {
    function Inline() {
      const chart = useOrgChart<Row>({
        data: rows.map((r) => ({ ...r, meta: { n: 1 } })),
        animationDuration: 400,
      });
      return <OrgChart chart={chart} />;
    }
    render(<Inline />);
    expect(screen.getByText('Root')).toBeTruthy();
  });

  it('renders paging nodes with a "Show N more" button', () => {
    const many: Row[] = [{ id: 'r', parentId: null, name: 'R' }];
    for (let i = 0; i < 6; i++) many.push({ id: `c${i}`, parentId: 'r', name: `C${i}` });
    render(<Chart data={many} paging={{ pageSize: 2, step: 3 }} />);
    const more = screen.getByRole('button', { name: 'Show 3 more' });
    act(() => {
      fireEvent.click(more);
    });
    expect(screen.getByText('C4')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show 1 more' })).toBeTruthy();
  });
});
