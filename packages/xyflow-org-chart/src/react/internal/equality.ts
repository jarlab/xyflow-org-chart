import type { CSSProperties } from 'react';
import type { CompactCellInfo, Point } from '../../types';
import type { OrgChartNodeData } from '../types';

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function sameNumberMap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export function sameStyle(a: CSSProperties | undefined, b: CSSProperties | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof CSSProperties)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}

function sameCompact(a: CompactCellInfo | null, b: CompactCellInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.index === b.index &&
    a.even === b.even &&
    a.row === b.row &&
    a.firstCellId === b.firstCellId &&
    a.flexCompactDim[0] === b.flexCompactDim[0] &&
    a.flexCompactDim[1] === b.flexCompactDim[1] &&
    a.columnSize === b.columnSize &&
    a.rowOffset === b.rowOffset
  );
}

/**
 * Rows compared shallowly, so data re-created on every render (`rows.map(r => ({ ...r }))`) does
 * not produce new node data (which would re-render the host on every render). Rows whose nested
 * objects are re-created still count as changed: memoize `data` in that case.
 */
function sameItem(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Shallow equality of node data, comparing the nested compact info by value and rows shallowly. */
export function sameNodeData<T>(a: OrgChartNodeData<T>, b: OrgChartNodeData<T>): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) {
    if (k === 'compact') {
      if (!sameCompact(a.compact, b.compact)) return false;
    } else if (k === 'item') {
      if (!sameItem(a.item, b.item)) return false;
    } else if (!Object.is(a[k], b[k])) {
      return false;
    }
  }
  return true;
}
