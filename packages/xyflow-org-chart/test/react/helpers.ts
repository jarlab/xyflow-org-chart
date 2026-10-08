import { act } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type { LayoutInputNode, OrgChartLayoutOptions, Orientation } from '../../src/types';

// Not `new URL(…, import.meta.url)` like test/core/helpers.ts: jsdom replaces the global URL.
const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '..', '../../../../docs/d3-org-chart/lab/fixtures');

export interface GoldenFixture {
  name: string;
  meta: { layout: Orientation; compact: boolean; margins: Omit<OrgChartLayoutOptions, 'orientation' | 'compact'> };
  nodes: {
    id: string;
    parentId: string | null;
    width: number;
    height: number;
    box: { left: number; top: number; right: number; bottom: number };
  }[];
}

/** The real d3-org-chart golden fixtures (docs/d3-org-chart/lab/fixtures). */
export function loadGoldenFixtures(): GoldenFixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) }) as GoldenFixture);
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random tree as layout input: each node attached to a random earlier node, random sizes. */
export function randomInput(n: number, seed: number): LayoutInputNode[] {
  const r = rng(seed);
  const out: LayoutInputNode[] = [{ id: 'n0', parentId: null, width: 250, height: 150 }];
  for (let i = 1; i < n; i++) {
    const p = r() < 0.5 ? Math.floor(r() * i) : Math.max(0, i - 1 - Math.floor(r() * 10));
    out.push({ id: `n${i}`, parentId: `n${p}`, width: 80 + Math.floor(r() * 320), height: 50 + Math.floor(r() * 250) });
  }
  return out;
}

/** Rows used by the hook tests: `w`/`h` feed a nodeSize function when a test wants variable sizes. */
export interface Row {
  id: string;
  parentId: string | null;
  name: string;
  w?: number;
  h?: number;
}

/**
 * r ─ a ─ a1 ─ a1x
 *   │   └ a2
 *   └ b ─ b1
 */
export const ROWS: Row[] = [
  { id: 'r', parentId: null, name: 'Root' },
  { id: 'a', parentId: 'r', name: 'A' },
  { id: 'b', parentId: 'r', name: 'B' },
  { id: 'a1', parentId: 'a', name: 'A1' },
  { id: 'a2', parentId: 'a', name: 'A2' },
  { id: 'b1', parentId: 'b', name: 'B1' },
  { id: 'a1x', parentId: 'a1', name: 'A1X' },
];

/** Rows restricted to `ids`, as fixed-size layout input in row order (sibling order preserved). */
export function inputFor(rows: readonly Row[], ids: Iterable<string>, size = { width: 250, height: 150 }): LayoutInputNode[] {
  const keep = new Set(ids);
  return rows
    .filter((r) => keep.has(r.id))
    .map((r) => ({ id: r.id, parentId: r.parentId, width: r.w ?? size.width, height: r.h ?? size.height }));
}

/** Browser APIs React Flow needs under jsdom (React Flow's testing guide). */
export function stubBrowserApis(): void {
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
}

/**
 * Manual requestAnimationFrame + performance.now. Call install() in beforeEach and
 * vi.unstubAllGlobals()/vi.restoreAllMocks() in afterEach.
 */
export function createFrameClock() {
  const clock = {
    now: 0,
    queue: [] as FrameRequestCallback[],
    cancelled: 0,
    install() {
      clock.now = 0;
      clock.queue = [];
      clock.cancelled = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => clock.queue.push(cb));
      vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
        clock.cancelled++;
        // Handles are 1-based queue lengths at request time; the hook only ever has one pending.
        if (handle > 0) clock.queue = [];
      });
    },
    /** Advances the clock by dt ms and runs the frames queued so far. */
    frame(dt: number) {
      clock.now += dt;
      const q = clock.queue;
      clock.queue = [];
      act(() => q.forEach((cb) => cb(clock.now)));
    },
  };
  return clock;
}
