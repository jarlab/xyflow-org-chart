/**
 * orgChartEdgePath vs the d attribute the REAL d3-org-chart 3.1.1 wrote to every tree link
 * (docs/d3-org-chart/lab/fixtures-links/<config>.json, recorded by gen-links.cjs).
 *
 * The anchors are recomputed here from the recorded node fields with the formulas of
 * layout-algorithm.md §7.1, independently of src/core, so this also cross-checks those formulas.
 */
import { describe, expect, it } from 'vitest';
import { orgChartEdgePath } from '../../src/paths';
import type { Orientation, Point } from '../../src/types';
import { diffPaths } from './tokens';

import bottomFalse from '../../../../docs/d3-org-chart/lab/fixtures-links/bottom-false.json';
import bottomTrue from '../../../../docs/d3-org-chart/lab/fixtures-links/bottom-true.json';
import interleaved from '../../../../docs/d3-org-chart/lab/fixtures-links/extra-top-true-interleaved.json';
import managerFirst from '../../../../docs/d3-org-chart/lab/fixtures-links/extra-top-true-managerfirst.json';
import leftFalse from '../../../../docs/d3-org-chart/lab/fixtures-links/left-false.json';
import leftTrue from '../../../../docs/d3-org-chart/lab/fixtures-links/left-true.json';
import rightFalse from '../../../../docs/d3-org-chart/lab/fixtures-links/right-false.json';
import rightTrue from '../../../../docs/d3-org-chart/lab/fixtures-links/right-true.json';
import topFalse from '../../../../docs/d3-org-chart/lab/fixtures-links/top-false.json';
import topTrue from '../../../../docs/d3-org-chart/lab/fixtures-links/top-true.json';

interface FxNode {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  compactEven: boolean | null;
  flexCompactDim: number[] | null;
  firstCompactNode: string | null;
}
interface FxLink {
  id: string;
  parentId: string;
  compactCell: boolean;
  d: string;
}
interface LinksFixture {
  meta: { config: string; layout: Orientation; compact: boolean; margins: { compactMarginPair: number }; linkYOffset: number };
  nodes: FxNode[];
  links: FxLink[];
}

const FIXTURES = [
  topTrue, topFalse, bottomTrue, bottomFalse, leftTrue, leftFalse, rightTrue, rightFalse, interleaved, managerFirst,
] as unknown as LinksFixture[];

/** layout-algorithm.md §7.1, row by row. */
const anchors: Record<
  Orientation,
  {
    child: (d: FxNode) => Point;
    parentJoin: (p: FxNode) => Point;
    stubStart: (d: FxNode) => Point;
    spineTop: (fch: FxNode, pair: number) => Point;
  }
> = {
  top: {
    child: (d) => ({ x: d.x, y: d.y }),
    parentJoin: (p) => ({ x: p.x, y: p.y + p.height }),
    stubStart: (d) => ({ x: d.x + (d.compactEven ? d.width / 2 : -d.width / 2), y: d.y + d.height / 2 }),
    spineTop: (f, pair) => ({ x: f.x + f.flexCompactDim![0] / 4 + pair / 4, y: f.y }),
  },
  bottom: {
    child: (d) => ({ x: d.x, y: d.y }),
    parentJoin: (p) => ({ x: p.x, y: p.y - p.height }),
    stubStart: (d) => ({ x: d.x + (d.compactEven ? d.width / 2 : -d.width / 2), y: d.y - d.height / 2 }),
    spineTop: (f, pair) => ({ x: f.x + f.flexCompactDim![0] / 4 + pair / 4, y: f.y }),
  },
  left: {
    child: (d) => ({ x: d.x, y: d.y }),
    parentJoin: (p) => ({ x: p.x + p.width, y: p.y }),
    stubStart: (d) => ({ x: d.x + d.width / 2, y: d.y + (d.compactEven ? d.height / 2 : -d.height / 2) }),
    spineTop: (f, pair) => ({ x: f.x, y: f.y + f.flexCompactDim![0] / 4 + pair / 4 }),
  },
  right: {
    child: (d) => ({ x: d.x, y: d.y }),
    parentJoin: (p) => ({ x: p.x - p.width, y: p.y }),
    stubStart: (d) => ({ x: d.x - d.width / 2, y: d.y + (d.compactEven ? d.height / 2 : -d.height / 2) }),
    spineTop: (f, pair) => ({ x: f.x, y: f.y + f.flexCompactDim![0] / 4 + pair / 4 }),
  },
};

describe.each(FIXTURES.map((fx) => [fx.meta.config, fx] as const))('%s', (_name, fx) => {
  const byId = new Map(fx.nodes.map((n) => [n.id, n]));
  const a = anchors[fx.meta.layout];

  it('has one recorded link per non-root node', () => {
    expect(fx.links).toHaveLength(fx.nodes.length - 1);
  });

  it.each(fx.links.map((l) => [l.id, l] as const))('link to %s matches the DOM d exactly', (_id, link) => {
    const d = byId.get(link.id)!;
    const parent = byId.get(d.parentId!)!;
    // d3-org-chart's test is `attrs.compact && d.flexCompactDim` (d3-org-chart.js:932).
    const compactCell = fx.meta.compact && d.flexCompactDim != null;
    expect(compactCell).toBe(link.compactCell);

    const source = a.parentJoin(parent);
    let target: Point;
    let spineFromTarget: { dx: number; dy: number } | null = null;
    if (compactCell) {
      target = a.stubStart(d);
      const spine = a.spineTop(byId.get(d.firstCompactNode!)!, fx.meta.margins.compactMarginPair);
      spineFromTarget = { dx: spine.x - target.x, dy: spine.y - target.y };
    } else {
      target = a.child(d);
    }

    const path = orgChartEdgePath({ orientation: fx.meta.layout, source, target, spineFromTarget, linkYOffset: fx.meta.linkYOffset });
    expect(diffPaths(path, link.d)).toBeNull();
  });
});

describe('orgChartEdgePath', () => {
  it('defaults linkYOffset to 30 for top/bottom and ignores it for left/right', () => {
    const base = { source: { x: 0, y: 100 }, target: { x: -220, y: 160 } };
    expect(orgChartEdgePath({ orientation: 'top', ...base })).toBe(orgChartEdgePath({ orientation: 'top', ...base, linkYOffset: 30 }));
    expect(orgChartEdgePath({ orientation: 'left', ...base, linkYOffset: 0 })).toBe(orgChartEdgePath({ orientation: 'left', ...base, linkYOffset: 99 }));
  });
});
