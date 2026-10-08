import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Run the demo on the library's source (no build step), like the tsconfig "paths" mapping.
const librarySource = fileURLToPath(new URL('../../packages/xyflow-org-chart/src/index.ts', import.meta.url));
const libraryCoreSource = fileURLToPath(new URL('../../packages/xyflow-org-chart/src/core-entry.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^xyflow-org-chart$/, replacement: librarySource },
      { find: /^xyflow-org-chart\/core$/, replacement: libraryCoreSource },
    ],
    // The library source and the demo must share one React and one React Flow store context.
    dedupe: ['react', 'react-dom', '@xyflow/react'],
  },
  server: { port: 5173 },
  preview: { port: 5173 },
});
