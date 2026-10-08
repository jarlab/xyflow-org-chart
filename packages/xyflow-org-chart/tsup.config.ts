import { defineConfig } from 'tsup';

export default defineConfig({
  // `core` is the React-free subpath; splitting shares its code (and OrgChartDataError's class
  // identity) with the root entry in both formats.
  entry: { index: 'src/index.ts', core: 'src/core-entry.ts' },
  splitting: true,
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@xyflow/react'],
});
