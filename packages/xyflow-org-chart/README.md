# xyflow-org-chart

[d3-org-chart](https://github.com/bumbeishvili/org-chart)'s layout, as a [React Flow](https://reactflow.dev) (xyflow) plugin.

This package reimplements the d3-org-chart 3.1.1 layout pipeline for React Flow. That pipeline is a variable-size tidy tree (d3-flextree), compact two-column grids for leaf siblings, the four orientations, and rounded elbow links with compact "spines". The package outputs plain React Flow nodes and edges. Node positions and link paths match what the real library draws, number for number (see [How fidelity is verified](#how-fidelity-is-verified)).

The package has two layers:

- **React Flow layer**: the `useOrgChart` hook, the `<OrgChart>` component, a custom edge, zero-size handles, default node components and viewport helpers.
- **Framework-free core** (`xyflow-org-chart/core`): `layoutOrgChart`, the hierarchy and visibility helpers, and the SVG path generators. It has no dependencies and works anywhere, without React.

## Install

```sh
npm install xyflow-org-chart @xyflow/react react react-dom
```

Peer dependencies: `@xyflow/react` `>=12.3 <13`, `react` `>=18`, `react-dom` `>=18`. The package has no runtime dependencies of its own. It ships ESM and CJS builds with type declarations. The `xyflow-org-chart/core` entry needs none of the peers (your package manager may still warn about them).

## Quick start

```tsx
import '@xyflow/react/dist/style.css'; // React Flow's stylesheet is required
import { OrgChart, useOrgChart } from 'xyflow-org-chart';

const people = [
  { id: 'ceo', parentId: null, name: 'Ada', title: 'CEO' },
  { id: 'cto', parentId: 'ceo', name: 'Grace', title: 'CTO' },
  { id: 'cfo', parentId: 'ceo', name: 'Alan', title: 'CFO' },
  { id: 'dev1', parentId: 'cto', name: 'Linus', title: 'Engineer' },
  { id: 'dev2', parentId: 'cto', name: 'Ken', title: 'Engineer' },
];

export function App() {
  const chart = useOrgChart({ data: people, initialExpandLevel: 99 });
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <OrgChart chart={chart} />
    </div>
  );
}
```

`useOrgChart` runs the layout and keeps track of which nodes are expanded and which pages are shown. `<OrgChart>` is a `<ReactFlow>` set up for org charts:

- it registers the default node and edge types;
- it turns off dragging, connecting and deleting;
- its zoom range is 0.05 to 8;
- it fits the chart once the first layout is ready;
- after an expand, collapse or "show more", it re-centres on that node.

Any other `ReactFlow` prop passes through, and `children` render inside `<ReactFlow>` (`Background`, `Controls`, `MiniMap`, `Panel`, …).

Rows are flat. By default the id is read from `item.id` and the parent id from `item.parentId`. A parent id of `null`, `undefined` or `''` marks the root. Children are ordered by the order of the rows.

## Using your own `<ReactFlow>`

To keep full control, pass the hook's output to your own `<ReactFlow>`. Wrap it in `OrgChartProvider`: the default nodes and the viewport helpers read the chart's actions from it. You must also set `nodeOrigin={[0, 0]}`, because layout positions are the top-left corners of the cards.

```tsx
import { ReactFlow } from '@xyflow/react';
import { OrgChartProvider, orgChartEdgeTypes, orgChartNodeTypes, useOrgChart } from 'xyflow-org-chart';

const nodeTypes = { ...orgChartNodeTypes, person: PersonNode }; // define outside components
const edgeTypes = orgChartEdgeTypes;

function Chart({ data }) {
  const chart = useOrgChart({ data, nodeType: 'person' });
  return (
    <OrgChartProvider chart={chart}>
      <ReactFlow
        nodes={chart.nodes}
        edges={chart.edges}
        onNodesChange={chart.onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={[0, 0]}
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.05}
        maxZoom={8}
      />
    </OrgChartProvider>
  );
}
```

`orgChartNodeTypes` is `{ orgChart: OrgChartNode, orgChartPaging: OrgChartPagingNode }` and `orgChartEdgeTypes` is `{ orgChart: OrgChartEdge }`. `onNodesChange` is required in measure mode and harmless otherwise. It ignores remove, add and replace changes, because nodes are derived from `data`.

## Custom nodes

A custom node gets `NodeProps<OrgChartFlowNode<T>>`, and `data` is an `OrgChartNodeData<T>`:

| field | meaning |
|---|---|
| `kind` | `'node'`, or `'paging'` for the synthetic "show more" node |
| `item` | your row (`undefined` for paging nodes) |
| `orientation`, `depth`, `parentId` | |
| `width`, `height` | the size the layout used |
| `hasChildren`, `expanded` | the node has children in the full data / they are shown |
| `directReports`, `totalReports` | child count / descendant count in the full data |
| `hiddenCount`, `nextPageCount` | paging nodes: children still hidden / how many the next click reveals |
| `compact` | `CompactCellInfo` when the node sits in a compact grid, else `null` |

Every custom node must render `<OrgChartHandles />`. It renders the 8 zero-size handles the edges attach to, which puts each edge endpoint exactly on the card border at d3-org-chart's anchor. Two rules keep the endpoints exact:

1. **Fixed-size mode** (the default): the node must fill its box, which React Flow sizes to the layout's `width` × `height`. Use `width: 100%; height: 100%` with `box-sizing: border-box`.
2. **The element that contains the handles must have no border.** CSS measures absolute offsets from the padding box, so a 1px border moves every endpoint 1px into the card. Use a borderless `position: relative` frame for the handles and the button, and put the border on an inner card:

```tsx
import type { NodeProps } from '@xyflow/react';
import { OrgChartExpandButton, OrgChartHandles, type OrgChartFlowNode } from 'xyflow-org-chart';

function PersonNode({ id, data }: NodeProps<OrgChartFlowNode<Person>>) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="card" style={{ boxSizing: 'border-box', width: '100%', height: '100%', border: '1px solid #ccc' }}>
        {data.item?.name}
      </div>
      <OrgChartHandles />
      <OrgChartExpandButton id={id} data={data} />
    </div>
  );
}
```

`<OrgChartExpandButton>` is d3-org-chart's expand/collapse pill. It is centred on the node's outgoing join point and shows the number of direct reports. It renders nothing for leaves and calls `toggle(id)`. It carries the `nodrag nopan` classes and stops click propagation. You can also call the actions yourself: `useOrgChartActions()` returns them and stays stable across layouts. `useOrgChartContext()` returns the actions plus `orientation`, `layout`, `layoutVersion` and `lastActionNodeId`.

The default `OrgChartNode` shows `item.name` (or `item.label`, falling back to the id) and `item.title` (or `item.position`). You can style it with the CSS variables `--xoc-node-border`, `--xoc-node-background`, `--xoc-node-color` and `--xoc-node-radius`, which fall back to React Flow's node variables. Its classes are `.xoc-node` (the frame), `.xoc-node__card`, `.xoc-node__name`, `.xoc-node__title` and `.xoc-expand-button`. `OrgChartPagingNode` renders a "Show N more" button (`.xoc-paging-node`, `.xoc-paging-button`).

## `useOrgChart(options)`

### Data and rendering

| option | default | |
|---|---|---|
| `data` | (required) | Flat rows with exactly one root. Child order is row order. |
| `getId` | `item.id` | `(item) => string \| number`. Coerced to a string. |
| `getParentId` | `item.parentId` | `(item) => string \| number \| null \| undefined`. `null`/`undefined`/`''` marks the root. |
| `nodeSize` | `{ width: 250, height: 150 }` | A `Size`, or `(item) => Size` per row. Ignored for nodes that have been measured in measure mode. |
| `pagingNodeSize` | the size `nodeSize` gives the first hidden child (as in d3-org-chart, where that child becomes the button), else 250×150 | Size of the "show more" nodes. |
| `measure` | `false` | Lay out with the sizes React Flow measures from the DOM. See [Measure mode](#measure-mode). |
| `nodeType` | `'orgChart'` | React Flow type of regular nodes. |
| `pagingNodeType` | `'orgChartPaging'` | React Flow type of "show more" nodes. |
| `edgeType` | `'orgChart'` | React Flow type of the edges. |
| `linkYOffset` | `30` | d3-org-chart's `linkYOffset` (top/bottom only). `0` centres the bus in the gap. |
| `animationDuration` | `400` | Position transition in ms. `0` disables it. It is also 0 when the user prefers reduced motion. |

### Expansion and paging

| option | default | |
|---|---|---|
| `initialExpandLevel` | `1` | Nodes at depth ≤ this start visible (`0` = only the root). Uncontrolled mode only. |
| `expandedIds` | (none) | Controlled expansion: the ids whose children are shown. |
| `onExpandedIdsChange` | (none) | Called with the new ids whenever an action changes them. |
| `paging` | `false` | `{ pageSize, step }`: show at most `pageSize` children per parent, then a "show more" node that reveals `step` more per click. |

### Layout (d3-org-chart's defaults; `DEFAULT_LAYOUT_OPTIONS`)

| option | default | |
|---|---|---|
| `orientation` | `'top'` | `'top' \| 'bottom' \| 'left' \| 'right'`: where the root sits. |
| `compact` | `true` | Fold sibling leaves (2 or more) into a two-column grid hanging off a spine. |
| `siblingsMargin` | `20` | Gap between siblings. |
| `childrenMargin` | `60` | Gap between a parent and its children. |
| `neighbourMargin` | `80` | Extra gap between adjacent nodes that are not siblings. |
| `compactMarginPair` | `100` | Gap between the two columns of a compact grid. |
| `compactMarginBetween` | `20` | Gap between the rows of a compact grid. |

You can pass inline `data`, accessors and `nodeSize` safely. The hook compares layout inputs by value, so it lays out again only when the geometry really changes, and it starts a new transition only when positions or sizes change.

### Result

| field | |
|---|---|
| `nodes`, `edges`, `onNodesChange` | Pass to `<ReactFlow>`. Positions animate between layouts. |
| `layout` | The latest target `OrgChartLayout`. `null` before the first layout or when the data has an error. |
| `layoutVersion` | Goes up by one with every new target layout. |
| `hierarchy` | The full-data `OrgHierarchy` (`rootId`, `nodes: Map`). `null` when the data has an error. |
| `error` | An `OrgChartDataError` when `data` is malformed (`nodes` and `edges` are then empty). Codes: `empty`, `duplicate-id`, `missing-parent`, `no-root`, `multiple-roots`, `cycle`, and `missing-id` (a row has no `id` and you passed no `getId`). |
| `expandedIds` | The current expansion, as a `ReadonlySet<string>`. |
| `orientation` | The orientation of the current layout. |
| `lastActionNodeId` | The node whose toggle/expand/collapse/showMore produced the current layout, else `null`. |
| `isAnimating` | A position transition is running. |
| `animationDuration` | The duration actually used (0 when disabled or when the user prefers reduced motion). |
| actions | See below. |

### Actions

These are on the result, in `useOrgChartActions()` and in `useOrgChartContext()`. They keep the same identity across renders.

| action | |
|---|---|
| `toggle(id)` | Expand if collapsed, collapse if expanded. |
| `expand(id)` | Show `id`'s children. It also expands `id`'s ancestors so `id` is visible. |
| `collapse(id)` | Hide `id`'s children. Descendants stay expanded, so expanding again brings the grandchildren back. |
| `expandAll()` | Expand every node that has children. |
| `collapseAll()` | Collapse everything, so only the root is visible (like d3-org-chart's `collapseAll()`). `collapseToLevel(initialExpandLevel)` returns to the initial expansion. |
| `collapseToLevel(level)` | Reset so that nodes at depth ≤ `level` are visible (`0` = only the root). |
| `reveal(id)` | Expand every ancestor of `id`. With paging, it also raises page limits so `id` is shown. |
| `showMore(parentId)` | Paging: show `paging.step` more children of `parentId`. |

### Controlled expansion

Pass `expandedIds` and update it from `onExpandedIdsChange`. Actions only report the new set; the chart changes when you pass it back. Actions called together in one handler compose (`expand('a'); expand('b')` reports `[…, 'a']` and then `[…, 'a', 'b']`); a change you do not pass back is forgotten by the next event. The ids are the parents whose children are shown. A node is visible when its parent is visible and expanded, and the root is always visible.

```tsx
const [expanded, setExpanded] = useState<string[]>(['ceo']);
const chart = useOrgChart({ data, expandedIds: expanded, onExpandedIdsChange: setExpanded });
```

Ids that no longer exist in `data` are ignored. Page limits stay internal state, even in controlled mode.

### Paging

```tsx
useOrgChart({ data, paging: { pageSize: 5, step: 5 } });
```

A parent whose children don't all fit shows its first `pageSize` children (or more after "show more" clicks), then one synthetic paging node. The paging node's id is `pagingNodeId(parentId)` (`` `${parentId}::more` ``), its `data.kind` is `'paging'`, and its incoming link is hidden, as in d3-org-chart. Each click calls `showMore(parentId)`. Paging is off by default; d3-org-chart's default is also effectively off.

### Measure mode

```tsx
useOrgChart({ data, measure: true, nodeSize: { width: 250, height: 120 } });
```

The hook renders cards with `nodeSize` as a first guess. React Flow measures them, and the hook lays out again with the measured sizes. Cards stay `visibility: hidden` until a layout has used their measured size, and so do their edges. `<OrgChart>` fits only after every card is visible.

In measure mode, a custom node must size itself to its content, for example with a fixed width and a natural height, instead of filling a box. Pass `onNodesChange` to `<ReactFlow>` (`<OrgChart>` does this for you). Size changes smaller than 0.5px after the first measurement do not cause a relayout. React Flow measures with `offsetWidth`/`offsetHeight`, which are whole pixels, so a card whose CSS height is fractional can sit up to 0.5px away from its edges.

## Viewport helpers

`useOrgChartViewport()` must be called inside `<ReactFlow>` (or a `ReactFlowProvider`) and inside an `OrgChartProvider`. With `<OrgChart>`, call it from one of its children. The helpers frame the target layout, so calling them during a transition frames where the cards will end up.

| | |
|---|---|
| `fit(options?)` | d3-org-chart's `fit()`: the bounding box of the cards plus 50 flow units of padding, at 90% of the pane. Options: `nodeIds` (default: every laid-out node), `padding` (50), `duration` (400 ms), `scale` (true; `false` only pans, keeping the zoom), `maxZoom` (8; React Flow's own `maxZoom` also applies). Returns a `Promise<boolean>`. |
| `centerOn(id, options?)` | Centres on the node and, by default, its visible children, keeping the zoom. Options: `withChildren` (true), `duration` (400 ms). |

```tsx
function FitButton() {
  const { fit } = useOrgChartViewport();
  return <Panel position="top-right"><button onClick={() => fit()}>Fit</button></Panel>;
}
<OrgChart chart={chart}><FitButton /></OrgChart>;
```

### `<OrgChart>` props

It takes every `ReactFlowProps` except `nodes`, `edges` and `onNodesChange`, plus:

| prop | default | |
|---|---|---|
| `chart` | (required) | The `useOrgChart` result. |
| `fitOnInit` | `true` | Fit the whole chart (instantly) once the first layout is ready and visible. A hidden pane is fitted when it gets a size. If the pane size changes after that first fit (for example a container that was 0×0 at load), it refits once, unless the viewport was moved in between. |
| `centerOnAction` | `true` | After toggle/expand/collapse/showMore, centre on that node and its children, keeping the zoom. The pan uses `chart.animationDuration`. |

Changed defaults: `nodesDraggable=false`, `nodesConnectable=false`, `edgesFocusable=false`, `edgesReconnectable=false`, `minZoom=0.05`, `maxZoom=8`, `deleteKeyCode=null`. `nodeOrigin` is always `[0, 0]`. Your `nodeTypes`/`edgeTypes` are merged over the defaults.

## Framework-free core

Import the core from `xyflow-org-chart/core`. That entry has no React and no dependencies, so it loads in Node, workers or any framework without the peers installed, and a bundle of it contains only the core. The root entry `xyflow-org-chart` exports the same functions too, but it also loads React and React Flow.

```ts
import { layoutOrgChart, orgChartEdgePath } from 'xyflow-org-chart/core';

const layout = layoutOrgChart(
  [
    { id: 'ceo', parentId: null, width: 250, height: 150 },
    { id: 'a', parentId: 'ceo', width: 250, height: 150 },
    { id: 'b', parentId: 'ceo', width: 250, height: 150 },
  ],
  { orientation: 'left', compact: false },
);

for (const n of layout.nodes) draw(n.position.x, n.position.y, n.width, n.height); // top-left corners
for (const e of layout.edges) {
  const d = orgChartEdgePath({
    orientation: layout.options.orientation,
    source: e.sourcePoint,
    target: e.targetPoint,
    spineFromTarget: e.spineTop && { dx: e.spineTop.x - e.targetPoint.x, dy: e.spineTop.y - e.targetPoint.y },
  });
  drawPath(d); // the exact SVG path d3-org-chart draws
}
```

- **`layoutOrgChart(nodes, options?)`** lays out the visible tree. Each input is `LayoutInputNode` `{ id, parentId, width, height }`; exactly one node has `parentId: null`, and child order is input order. It returns an `OrgChartLayout`:
  - `options`: the resolved options;
  - `nodes`: `LayoutNode[]`, breadth-first;
  - `nodeById`;
  - `edges`: `LayoutEdge[]`;
  - `bounds`: the bounding box of the cards.

  Each `LayoutNode` has:
  - `x`/`y`: d3-org-chart's anchor, i.e. the centre of the edge facing the root;
  - `position`: the top-left corner;
  - `width`, `height`, `depth`, `parentId`, `childIds`;
  - `compact`: the grid cell info, or `null`.

  Each `LayoutEdge` has `source`/`target` ids, `sourceHandle`/`targetHandle`, `sourcePoint` (the parent's outgoing join), `targetPoint` (the child anchor, or the compact stub start) and `spineTop` (compact cells only). It throws `OrgChartDataError` on malformed input. The function is pure: a 5,000-node tree takes about 15 ms.
- **`orgChartEdgePath(input)`** builds d3-org-chart's link path. It takes `orientation`, `source`, `target`, `spineFromTarget` (compact cells) and `linkYOffset` (default 30). `diagonal(s, t, m?, offsets?)` and `hdiagonal(s, t, m?)` are exact ports of the library's two generators.
- **Hierarchy and visibility:**
  - `buildHierarchy(items, getId, getParentId)` returns an `OrgHierarchy`;
  - `getVisibleTree(hierarchy, { expandedIds, paging?, pageLimits? })` returns `VisibleEntry[]`, breadth-first, including paging entries;
  - `expandedIdsForLevel(hierarchy, level)`, `allParentIds(hierarchy)`, `ancestorIds(hierarchy, id)` and `pagingNodeId(parentId)` are helpers for building expansion sets.

  Feed the visible entries, with sizes, to `layoutOrgChart`.
- **`flextree(root, { children, nodeSize, spacing? })`** is a typed port of d3-flextree 2.1.2. It returns `Map<node, { x, y }>`, where x is the centre of the box and y its top.
- **`DEFAULT_LAYOUT_OPTIONS`** holds d3-org-chart's defaults (see the layout table above).

## Differences from d3-org-chart

The geometry (positions, sizes, link paths, compact grids, orientations) is the same. Behaviour around it differs on purpose in these places:

- **Expansion model.** d3-org-chart stores flags on your data objects, and its `_expanded` means "this node must be visible". Here, expansion is a set of parent ids whose children are shown, with no mutation of your rows. Collapsing a node keeps its descendants' expansion, so re-expanding restores the subtree. That matches a click in d3-org-chart, but not its rebuild path, which forgets.
- **`initialExpandLevel`** is not one-shot, and it does not turn paging off at shallow depths. `collapseAll()` shows only the root, but it does not set level 0 permanently.
- **Paging node.** "Show more" is a synthetic extra node (`<parent>::more`) after the visible children. d3-org-chart instead turns the real child `children[P]` into the button; by default the synthetic node gets the size `nodeSize` gives that child, so the geometry is the same. As a result of the extra node, with exactly `pageSize + 1` children this package shows `pageSize` cards plus "show 1 more", where d3-org-chart shows all of them. Paging uses your `getId`. Revealing a node beyond the page raises the page limit; d3-org-chart shows the node alone after the button.
- **Animation.** The first layout appears instantly; d3-org-chart slides everything in from the root. Entering and exiting nodes move from and to their nearest visible ancestor. Edges are recomputed from the live handle positions on every frame, so they follow the cards.
- **Viewport.** `<OrgChart>` fits on the first layout; d3-org-chart shows the root at a fixed offset. After an action it centres on the node and its visible children, where d3-org-chart frames the middle BFS entries, or 7 entries in compact mode.
- **Not implemented:** non-tree "connections", highlighting, filtering/search, export and d3-org-chart's HTML node templates. Nodes are React components.
- A `-0` coordinate (the root in bottom/right) is normalised to `0`.

## How fidelity is verified

The repository's `docs/d3-org-chart/lab` runs the **real d3-org-chart 3.1.1** under jsdom and records its output as golden fixtures. The package tests compare against them:

- **10 fixture configs**: 4 orientations × compact on/off, plus two child orderings. Node order, depth, x/y, the drawn boxes and every compact field match exactly, with no tolerance.
- **60 seeded random trees** (1,099 nodes, integer and fractional sizes) × 8 configs: every x/y and compact field matches exactly.
- **Link paths**: for every link in the 10 configs, `layoutOrgChart` → anchors → `orgChartEdgePath` equals the DOM `d` attribute token for token. 6,000 direct generator samples, including NaN and edge cases, also match.
- **Handles**: on every edge, the zero-size handle's point on the card box equals `sourcePoint`/`targetPoint`. It was also checked in Chromium on the demo: endpoints sit within 0.01px of the card borders in all 4 orientations, with both node components.
- **flextree**: 2,400 random trees (more than 100k nodes) compared bit for bit with the d3-flextree package.

`docs/d3-org-chart/layout-algorithm.md` documents the algorithm in detail.
