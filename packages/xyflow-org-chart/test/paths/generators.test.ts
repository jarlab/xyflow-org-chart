/**
 * diagonal / hdiagonal vs the REAL d3-org-chart 3.1.1 generators, on the seeded random inputs and
 * edge cases recorded by docs/d3-org-chart/lab/gen-links.cjs (fixtures-links/generators.json).
 * Every command letter and every number must be identical (Object.is).
 */
import { describe, expect, it } from 'vitest';
import { diagonal, hdiagonal } from '../../src/paths';
import type { Point } from '../../src/types';
import fixture from '../../../../docs/d3-org-chart/lab/fixtures-links/generators.json';
import { diffPaths, pathTokens } from './tokens';

/** As recorded: an absent `m` / `offsets` key means the argument was `undefined`. */
interface Sample {
  s: Point;
  t: Point;
  m?: { x?: number | null; y?: number | null } | null;
  offsets?: { sy?: number };
  d: string;
}
interface GeneratorsFixture {
  meta: { counts: { diagonal: number; hdiagonal: number } };
  diagonal: Sample[];
  hdiagonal: Sample[];
}

const fx = fixture as unknown as GeneratorsFixture;

/** The library tolerates null coordinates in `m`; the typed API does not advertise them. */
const asPoint = (m: Sample['m']): Point | null | undefined => m as Point | null | undefined;

function mismatches(samples: Sample[], run: (s: Sample) => string): string[] {
  const out: string[] = [];
  samples.forEach((sample, i) => {
    const diff = diffPaths(run(sample), sample.d);
    if (diff) out.push(`#${i} ${JSON.stringify({ s: sample.s, t: sample.t, m: sample.m, offsets: sample.offsets })}: ${diff}`);
  });
  return out;
}

describe('diagonal (vertical, d3-org-chart.js:225-262)', () => {
  it('has ~3000 recorded samples', () => {
    expect(fx.diagonal.length).toBe(fx.meta.counts.diagonal);
    expect(fx.diagonal.length).toBeGreaterThanOrEqual(3000);
  });

  it('matches the real library token for token on every sample', () => {
    const bad = mismatches(fx.diagonal, (x) =>
      'offsets' in x ? diagonal(x.s, x.t, asPoint(x.m), x.offsets) : diagonal(x.s, x.t, asPoint(x.m)),
    );
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('always emits M L L L C L C L with 24 numbers', () => {
    const d = diagonal({ x: -220, y: 160 }, { x: 0, y: 100 }, undefined, { sy: 30 });
    const toks = pathTokens(d);
    expect(toks.filter((t) => typeof t === 'string').join('')).toBe('MLLLCLCL');
    expect(toks.filter((t) => typeof t === 'number')).toHaveLength(24);
  });

  it('reproduces the §7.2 worked example', () => {
    expect(diagonal({ x: -220, y: 160 }, { x: 0, y: 100 }, { x: -220, y: 160 }, { sy: 30 })).toBe(
      'M -220 160 L -220 160 L -220 190 L -220 180 C -220 145 -220 145 -185 145 L -35 145 C 0 145 0 145 0 110 L 0 100',
    );
  });

  it('defaults offsets to {sy: 0} only when omitted (an empty object yields NaN, like the library)', () => {
    expect(diagonal({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe(diagonal({ x: 0, y: 0 }, { x: 10, y: 10 }, null, { sy: 0 }));
    expect(diagonal({ x: 0, y: 0 }, { x: 10, y: 10 }, null, {})).toContain('NaN');
  });
});

describe('hdiagonal (horizontal, d3-org-chart.js:181-223)', () => {
  it('has ~3000 recorded samples', () => {
    expect(fx.hdiagonal.length).toBe(fx.meta.counts.hdiagonal);
    expect(fx.hdiagonal.length).toBeGreaterThanOrEqual(3000);
  });

  it('matches the real library token for token on every sample (offsets are ignored)', () => {
    const bad = mismatches(fx.hdiagonal, (x) => hdiagonal(x.s, x.t, asPoint(x.m)));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('reproduces the §7.3 worked example', () => {
    expect(hdiagonal({ x: 310, y: 0 }, { x: 250, y: 20 })).toBe(
      'M 310 0 L 310 0 L 310 0 L 290 0 C 280 0 280 0 280 10 L 280 10 C 280 20 280 20 270 20 L 250 20',
    );
  });
});
