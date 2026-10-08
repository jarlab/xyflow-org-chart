import { flextree as realFlextree } from 'd3-flextree';
import { describe, expect, it } from 'vitest';
import { flextree } from '../../src/core/flextree';
import { rng } from './helpers';

interface D {
  id: number;
  parentId: number;
  depth: number;
  size: [number, number];
  children?: D[];
}

type Spacing = (a: D, b: D) => number;

function randomTree(seed: number) {
  const r = rng(seed);
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const n = seed % 50 === 0 ? int(500, 3000) : int(1, 120);
  const sizeMode = int(0, 3);
  const size = (): [number, number] => {
    switch (sizeMode) {
      case 0: // integers
        return [int(1, 400), int(1, 300)];
      case 1: // arbitrary doubles
        return [r() * 400, r() * 300];
      case 2: // doubles with zero sizes mixed in (compact placeholders are [0, 0])
        return r() < 0.3 ? [0, 0] : [r() < 0.15 ? 0 : r() * 300, r() < 0.15 ? 0 : r() * 200];
      default: // mostly uniform
        return r() < 0.8 ? [270, 210] : [int(50, 500), int(50, 400)];
    }
  };
  const nodes: D[] = [{ id: 0, parentId: -1, depth: 0, size: size() }];
  const shape = int(0, 2);
  for (let i = 1; i < n; i++) {
    const p =
      shape === 0 ? int(0, i - 1)
      : shape === 1 ? Math.max(0, i - 1 - int(0, 4)) // deep and bushy
      : r() < 0.7 ? int(0, Math.min(i - 1, 5)) : int(0, i - 1); // wide fan-outs
    const parent = nodes[p];
    const d: D = { id: i, parentId: p, depth: parent.depth + 1, size: size() };
    (parent.children ??= []).push(d);
    nodes.push(d);
  }
  const s1 = r() * 50;
  const s2 = r() * 150;
  const spacingMode = int(0, 4);
  const spacing: Spacing | number =
    spacingMode === 0 ? 0
    : spacingMode === 1 ? s2
    : spacingMode === 2 ? (a, b) => (a.parentId === b.parentId ? 0 : 80) // d3-org-chart's rule
    : spacingMode === 3 ? (a, b) => (a.parentId === b.parentId ? s1 : s2) // sibling / cousin
    : (a, b) => (a.depth + b.depth) * 3.7 - (a.id % 3 === 0 ? 5 : 0); // depth-dependent, may be negative
  return { root: nodes[0], nodes, spacing };
}

describe('flextree vs d3-flextree 2.1.2 (bit-identical)', () => {
  it('matches on 2400 seeded random trees', () => {
    let trees = 0;
    let compared = 0;
    for (let seed = 1; seed <= 2400; seed++) {
      const { root, nodes, spacing } = randomTree(seed);
      const real = realFlextree<D>({
        nodeSize: (n) => n.data.size,
        spacing: typeof spacing === 'number' ? spacing : (a, b) => spacing(a.data, b.data),
      });
      const tree = real.hierarchy(root);
      real(tree);
      const ours = flextree<D>(root, { children: (d) => d.children, nodeSize: (d) => d.size, spacing });
      expect(ours.size).toBe(nodes.length);
      for (const h of tree.descendants()) {
        const p = ours.get(h.data)!;
        if (!Object.is(p.x, h.x) || !Object.is(p.y, h.y)) {
          expect({ seed, id: h.data.id, x: p.x, y: p.y }).toEqual({ seed, id: h.data.id, x: h.x, y: h.y });
        }
        compared++;
      }
      trees++;
    }
    expect(trees).toBe(2400);
    expect(compared).toBeGreaterThan(100_000);
  });

  it('calls nodeSize once per node and returns breadth-first order', () => {
    const { root, nodes } = randomTree(7);
    const calls = new Map<D, number>();
    const out = flextree<D>(root, {
      children: (d) => d.children,
      nodeSize: (d) => {
        calls.set(d, (calls.get(d) ?? 0) + 1);
        return d.size;
      },
    });
    expect([...calls.values()].every((c) => c === 1)).toBe(true);
    expect(calls.size).toBe(nodes.length);
    const depths = [...out.keys()].map((d) => d.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it('reproduces the README example (§3.5)', () => {
    type N = { name: string; size: [number, number]; children?: N[] };
    const C: N = { name: 'C', size: [4, 1] };
    const A: N = { name: 'A', size: [2, 4] };
    const B: N = { name: 'B', size: [3, 1], children: [C] };
    const R: N = { name: 'R', size: [1, 1], children: [A, B] };
    const out = flextree<N>(R, { children: (n) => n.children, nodeSize: (n) => n.size });
    expect(out.get(R)).toEqual({ x: 0, y: 0 });
    expect(out.get(A)).toEqual({ x: -1.75, y: 1 });
    expect(out.get(B)).toEqual({ x: 1.25, y: 1 });
    expect(out.get(C)).toEqual({ x: 1.25, y: 2 });
  });

  it('handles a 20k-deep chain without recursion limits', () => {
    type N = { children?: N[] };
    const root: N = {};
    let cur = root;
    for (let i = 0; i < 20_000; i++) {
      const next: N = {};
      cur.children = [next, {}];
      cur = next;
    }
    const out = flextree<N>(root, { children: (n) => n.children, nodeSize: () => [10, 10], spacing: 1 });
    expect(out.size).toBe(40_001);
    expect(out.get(cur)!.y).toBe(200_000);
  });
});
