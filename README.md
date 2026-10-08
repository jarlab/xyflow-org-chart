# xyflow-org-chart

The layout algorithm of [d3-org-chart](https://github.com/bumbeishvili/org-chart) 3.1.1, rebuilt as a [React Flow](https://reactflow.dev) (xyflow) plugin. It covers the variable-size tidy tree, compact grids, the four orientations and the elbow links. Node positions and link paths match the original library exactly.

| Path | What it is |
|---|---|
| [`packages/xyflow-org-chart`](packages/xyflow-org-chart) | The library, published as `xyflow-org-chart`. It has a framework-free layout core and a React Flow layer: `useOrgChart`, `<OrgChart>`, a custom edge, handles, default nodes and viewport helpers. See its [README](packages/xyflow-org-chart/README.md). |
| [`examples/demo`](examples/demo) | A Vite demo app with a 99-person company. Its controls cover orientation, compact mode, link offset, node style, measure mode, paging, animation and expand/collapse/fit. It also has a side-by-side comparison with the real d3-org-chart. |
| [`docs/d3-org-chart/layout-algorithm.md`](docs/d3-org-chart/layout-algorithm.md) | A study of how d3-org-chart lays out a chart: flextree, compact mode, orientations, links and state. §10 is the React Flow porting guide. |
| [`docs/d3-org-chart/lab`](docs/d3-org-chart/lab) | A Node lab that runs the real d3-org-chart under jsdom and records the golden fixtures the tests compare against. It is a separate npm project; see its [README](docs/d3-org-chart/lab/README.md). |

## Development

Requires Node `^20.19 || ^22.13 || >=24`.

```sh
npm install          # installs the workspace (library + demo)
npm run dev          # demo at http://localhost:5173 (uses the library's source directly)
npm test             # library tests (vitest)
npm run typecheck    # library + demo
npm run build        # library (tsup → packages/xyflow-org-chart/dist) + demo (vite → examples/demo/dist)
```

To regenerate or check the ground truth from the real library:

```sh
cd docs/d3-org-chart/lab
npm ci
npm run check          # golden fixtures/ are reproduced byte for byte
npm run check-links    # fixtures-links/ (link paths and generator samples)
npm run check-random   # fixtures-random/ (60 random trees, about 70 s)
```
