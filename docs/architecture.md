# Architecture

How the repository and the `xyflow-org-chart` package are put together. For *what* the layout
algorithm does and why, see [d3-org-chart/layout-algorithm.md](d3-org-chart/layout-algorithm.md);
for usage, see [the package README](../packages/xyflow-org-chart/README.md).

## Repository layout

```
packages/xyflow-org-chart/   the library (TypeScript, tsup, vitest)
examples/demo/               Vite demo, incl. a side-by-side view with the real d3-org-chart
docs/d3-org-chart/           study of d3-org-chart 3.1.1 + a lab that runs the real library
```

npm workspaces tie them together (`npm install`, `npm run dev | test | build | typecheck` at the root).
The demo consumes the library from source through a Vite alias / tsconfig path, so no build step is
needed during development.

## Package structure

The package has two layers with a hard boundary between them:

```
src/
├── types.ts            shared, framework-free types (Orientation, LayoutNode, LayoutEdge, …)
├── core/               layout engine           ┐
│   ├── tree.ts         validate rows → tree     │
│   ├── flextree.ts     van der Ploeg tidy tree  │  framework-free
│   ├── compact.ts      compact-grid passes      │  published alone as `xyflow-org-chart/core`
│   ├── layout.ts       layoutOrgChart()         │  (src/core-entry.ts)
│   └── hierarchy.ts    full data + visibility   │
├── paths/              diagonal / hdiagonal     ┘
└── react/              React Flow plugin
    ├── useOrgChart.ts, OrgChart.tsx, OrgChartEdge.tsx, OrgChartHandles.tsx,
    │   OrgChartNode.tsx, context.tsx, viewport.ts, nodeTypes.ts, types.ts
    └── internal/       layoutBundle, flowElements, useAnimatedFlow, transition,
                        expansion, geometry, equality, hooks
```

`src/index.ts` re-exports `src/core-entry.ts` and `src/react`. tsup builds two entries (`index`,
`core`) with code splitting, so the core is shared — `OrgChartDataError` is one class whichever
entry it comes from — and `xyflow-org-chart/core` loads without React or `@xyflow/react` installed.
`test/core/entry.test.ts` guards that the core entry never reaches a React import.

## The core: data → positions

```
rows ──buildHierarchy──▶ OrgHierarchy ──getVisibleTree(expandedIds, paging)──▶ visible entries
                                                                                    │ + sizes
                                                                                    ▼
                         OrgChartLayout ◀──────────────── layoutOrgChart(LayoutInputNode[], options)
                   {nodes, nodeById, edges, bounds}
```

- **`hierarchy.ts`** builds the full tree once per data change (string ids, depth, descendant
  counts) and derives the *visible* tree: a node's children are shown iff its id is in
  `expandedIds` and it is itself visible. With paging, a parent shows its first `limit` children and
  then one synthetic "show more" entry (`<parentId>::more`).
- **`layoutOrgChart`** (`layout.ts`) is pure and stateless. It mirrors d3-org-chart's `update()`:
  1. `tree.ts` validates and links the rows (iterative; error codes `empty`, `duplicate-id`, `missing-parent`, `no-root`, `multiple-roots`, `cycle`; `useOrgChart` adds `missing-id`);
  2. sizes are mapped to the canonical frame (breadth, depth) for the orientation;
  3. `compactPrePass` gives a grid's first leaf the whole grid's size and the others `[0, 0]`;
  4. `flextree` places every flex box (`[breadth + siblingsMargin, depth + childrenMargin]`,
     spacing `0` for siblings, `neighbourMargin` otherwise);
  5. `compactPostPass` moves grid leaves into their two columns;
  6. the orientation swap, then per node the top-left `position`, `childIds` and compact info,
     and per edge the handles and anchor points (parent join, child anchor or compact stub start,
     spine top).
- **`flextree.ts`** is a port of d3-flextree 2.1.2 that keeps the library's operand order (results
  are bit-identical), reads each size once, and uses explicit stacks so deep chains can't overflow.
- **`paths/`** ports d3-org-chart's `diagonal` (top/bottom) and `hdiagonal` (left/right) link
  generators number-for-number; `orgChartEdgePath` assembles one tree link from a source point,
  a target point and an optional spine offset.

## The React layer: layout → React Flow

```
useOrgChart(options)
  ├─ buildHierarchy (memo on data/accessors)            → error state instead of throwing
  ├─ expansion state  (uncontrolled set, or controlled expandedIds + onExpandedIdsChange)
  ├─ page limits      (grown by showMore / reveal)
  ├─ getVisibleTree
  ├─ layoutBundle     sizes (fixed nodeSize, or measured sizes in measure mode) → cached layout
  ├─ flowElements     layout → target React Flow nodes + edges
  └─ useAnimatedFlow  displayed nodes: tweens between targets, keeps React Flow's internals
        ▼
  { nodes, edges, onNodesChange, actions, layout, layoutVersion, … }
        ▼
<OrgChart chart>  =  <ReactFlow> + OrgChartProvider + default node/edge types
                     + a controller child (fit on init, centre after an action)
```

- **`internal/layoutBundle.ts`** resolves each visible entry's size: fixed `nodeSize`, the measured
  size in measure mode (changes under 0.5 px are ignored), and for "show more" nodes the size of
  the first hidden child, like d3-org-chart. Layouts are cached structurally, so re-created inline
  props do not relayout and `layoutVersion` only moves when the geometry changes.
- **`internal/flowElements.ts`** turns a layout into React Flow nodes (`position` = top-left,
  `data: OrgChartNodeData`, `width/height` in fixed mode, hidden until measured in measure mode)
  and edges (handle ids from the layout, `data.spineFromTarget` for compact cells; no edge into a
  "show more" node).
- **`internal/useAnimatedFlow.ts`** owns the node state React Flow sees. It applies React Flow's
  `dimensions`/`position`/`select` changes with `applyNodeChanges` and merges every new target or
  animation frame *into the previous node objects*, so `measured` and handle bounds are never lost
  (losing them makes edges vanish). On a geometry change it plans a transition
  (`internal/transition.ts`): existing nodes tween from where they are displayed, entering nodes
  start at d3-org-chart's join point of their nearest previously visible ancestor, and exiting
  nodes (with their incoming edges) tween to their surviving ancestor and are removed at the end.
  Cubic in-out easing on `requestAnimationFrame`; interruptible; respects `prefers-reduced-motion`.
- **Edges and handles.** `OrgChartHandles` renders eight zero-size handles (`s-*`, `t-*`) at the
  card's border midpoints, with inline styles so they don't depend on React Flow's CSS. Zero size
  makes React Flow's `sourceX/Y`/`targetX/Y` equal d3-org-chart's anchor points exactly, so
  `OrgChartEdge` can compute its path from live handle positions and `edge.data` alone, and stays
  correct on every animation frame. The element holding the handles must have no border, or every
  endpoint moves inward by the border width (the default node uses a borderless frame around a
  bordered card for this reason).
- **Context.** `OrgChartProvider` exposes two contexts: the full value (`useOrgChartContext`:
  actions, orientation, layout, layoutVersion) and actions only (`useOrgChartActions`), which stay
  stable across layouts, so node components don't re-render on every relayout.
- **Viewport.** `useOrgChartViewport` reproduces d3-org-chart's `fit()` (card bbox + 50 flow units,
  `fitBounds` with padding 1/9 ≈ 0.9 of the pane, zoom ≤ 8) and its keep-the-zoom centring, using
  target layout positions rather than mid-animation ones.

## How correctness is checked

The reference is the real d3-org-chart, run under jsdom in `docs/d3-org-chart/lab`:

| lab output | what it records | checked by |
|---|---|---|
| `fixtures/` | 10 hand-built configs (4 orientations × compact on/off + 2 child orders) | `test/core/fixtures.test.ts` |
| `fixtures-random/` | 60 random trees × 4 orientations × compact on/off | `test/core/random.test.ts` |
| `fixtures-links/` | the DOM `d` of every link, and 6,000 calls to `diagonal`/`hdiagonal` | `test/paths/*`, `test/e2e.links.test.ts` |

`test/core/flextree.diff.test.ts` compares the flextree port with the d3-flextree package on
2,400 random trees. `test/react/*` cover the hook (layout, expansion, paging, measure mode,
animation) and the components under jsdom. The demo's compare view is the visual check in a real
browser. `npm run check` (and `check-links`, `check-random`) in the lab regenerate the golden files
and fail if the library's output ever drifts.
