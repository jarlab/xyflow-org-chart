/** Splits an SVG path into command letters and numeric tokens (whitespace-insensitive). */
export function pathTokens(d: string): Array<string | number> {
  return d
    .trim()
    .split(/\s+/)
    .map((tok) => (/^[A-Za-z]$/.test(tok) ? tok : Number(tok)));
}

/**
 * Token-wise comparison: identical command letters, and every number identical by Object.is
 * (so NaN matches NaN). Returns null when equal, else a description of the first difference.
 */
export function diffPaths(actual: string, expected: string): string | null {
  const a = pathTokens(actual);
  const e = pathTokens(expected);
  if (a.length !== e.length) return `token count ${a.length} != ${e.length}\n  actual:   ${actual}\n  expected: ${expected}`;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], e[i])) return `token ${i}: ${String(a[i])} != ${String(e[i])}\n  actual:   ${actual}\n  expected: ${expected}`;
  }
  return null;
}
