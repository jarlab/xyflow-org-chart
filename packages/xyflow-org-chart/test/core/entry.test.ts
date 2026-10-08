import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../../src/core-entry';
import * as root from '../../src/index';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;

function resolveSource(from: string, spec: string): string {
  const base = join(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

/** Bare (package) specifiers reachable through the relative imports of `entry`. */
function packageImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      if (m[1].startsWith('.')) queue.push(resolveSource(file, m[1]));
      else packages.add(m[1]);
    }
  }
  return packages;
}

describe('xyflow-org-chart/core entry', () => {
  it('reaches no package at all (no React, no @xyflow/react)', () => {
    expect([...packageImports(join(SRC, 'core-entry.ts'))]).toEqual([]);
  });

  it('the walker does see the React layer from the root entry', () => {
    expect(packageImports(join(SRC, 'index.ts'))).toEqual(new Set(['react', '@xyflow/react']));
  });

  it('exports the same core values as the root entry', () => {
    for (const [name, value] of Object.entries(core)) expect([name, (root as Record<string, unknown>)[name]]).toEqual([name, value]);
    expect(Object.keys(core).sort()).toEqual(
      expect.arrayContaining(['layoutOrgChart', 'buildHierarchy', 'getVisibleTree', 'orgChartEdgePath', 'OrgChartDataError']),
    );
  });
});
