# d3-org-chart ground-truth lab

This lab runs the real `OrgChart` class from d3-org-chart 3.1.1 under jsdom. It renders a fixed synthetic org in every `layout` × `compact` combination and saves the resulting node positions as JSON fixtures in `fixtures/`. Two more generators record seeded random trees (`fixtures-random/`) and the exact link paths the library draws (`fixtures-links/`). The `xyflow-org-chart` package (`packages/xyflow-org-chart`) tests its layout and its edge paths against these golden files.

Each fixture records two things for every node: the `x`/`y` that d3-org-chart stores on the hierarchy node, and the box that d3-org-chart actually drew in the DOM. The DOM box comes from the `<g class="node">` translate plus the `rect` size, so it is independent of `x`/`y`.

| File | Purpose |
|---|---|
| `run.cjs` | The harness. Sets up jsdom, loads OrgChart, renders the configs and writes `fixtures/*.json`. Exports `runConfig`, `DATA`, `DATA_INTERLEAVED`, `DATA_MANAGER_FIRST`, `MARGINS`. |
| `analyze.cjs` | Checks the fixtures. It confirms the per-layout box convention against the DOM box, tests every pair of nodes for overlap, and prints gaps and compact grid geometry. Exports `analyze`, `analyzeAll`, `CONVENTION`, `overlapCheck`. |
| `fixtures/` | 10 golden dumps: `{top,left,bottom,right}-{true,false}.json` (layout-compact), plus `extra-top-true-interleaved.json` and `extra-top-true-managerfirst.json`. |
| `reference-layout.cjs` | An independent reimplementation of the layout (flextree + compact passes + orientation swap) written by a clean-room agent from `../layout-algorithm.md` alone (round 1 of the clean-room test, section 11.3; tidied). Exports `layoutOrgChart(rows, options)`, `flextreeLayout`, `compactPrePass`, `compactPostPass`, `DEFAULTS`. `nodeWidth`/`nodeHeight` receive the d3-hierarchy node, as in d3-org-chart. Depends only on `d3-hierarchy`, loaded with `require('d3-hierarchy')` (require(esm); do not require its `dist/` UMD file). See its header for the options and output convention. |
| `check-reference.cjs` | Runs `reference-layout.cjs` on the fixture datasets, with the harness's sizes and margins, and compares every node (by id) with `fixtures/*.json`: x/y within 1e-6, sizes and compact fields exactly, and node order. Exits 1 on any mismatch. Currently: all 10 match. |
| `gen-random.cjs` | Renders 60 seeded random trees (1–40 nodes, 1,099 in all; integer, fractional or mostly uniform sizes; some with rows listed child-before-parent) through `run.cjs`'s `runConfig` in all 4 layouts × compact on/off, and writes `fixtures-random/layouts.json`. Flags: `--trees N`, `--out FILE`, `--check`. Takes about 70 s (one 120 ms wait per config). |
| `fixtures-random/` | `layouts.json` (about 270 KB): the inputs and the real chart's x/y and compact fields for every random tree and config. Schema in `gen-random.cjs`'s header. Used by the package's `test/core/random.test.ts` and `test/e2e.links.test.ts`. |
| `gen-links.cjs` | Records the real link paths. For the same 10 configs as `run.cjs` it saves the final DOM `d` of every `path.link`, and checks each one against a direct call of the layout binding's `diagonal` with `update()`'s inputs. It also calls the real `diagonal`/`hdiagonal` on 3,000 samples each (seeded random inputs plus hand-written edge cases). Flags: `--check`. |
| `fixtures-links/` | `<config>.json`: `meta` (config, layout, compact, margins, `linkYOffset` 30), `nodes[]` in breadth-first order (as in `fixtures/`, without `box`/`domTransform`) and `links[]` = `{ id (child id), parentId, compactCell, d }`. `generators.json`: `{ meta, diagonal: [...], hdiagonal: [...] }`, each sample `{ s, t, m?, offsets?, d }`, where an absent key means the argument was `undefined`. Used by the package's `test/paths/*` and `test/e2e.links.test.ts`. |
| `package.json` / `package-lock.json` | Exact versions: d3-org-chart 3.1.1, d3-flextree 2.1.2, jsdom 29.1.1, and every d3-* package pinned. |

## Running it

You need a Node version with `require(esm)`: `^20.19 || ^22.13 || >=24`. The fixtures were generated with Node 22.14.0.

```sh
npm ci                 # install exactly what package-lock.json lists
npm run check          # regenerate into a temp dir and byte-compare with fixtures/ (exits 1 on drift)
npm run fixtures       # regenerate fixtures/ in place, then print the analysis
npm run analyze        # analyse fixtures/*.json (exits 1 on any overlap or convention mismatch)
npm run check-reference   # compare reference-layout.cjs with fixtures/*.json (needs only d3-hierarchy)
npm run random         # regenerate fixtures-random/layouts.json (about 70 s)
npm run check-random   # regenerate in memory and byte-compare with fixtures-random/layouts.json
npm run links          # regenerate fixtures-links/
npm run check-links    # regenerate in memory and byte-compare with fixtures-links/
node run.cjs --layout left --compact true --print --no-analyze   # one config, printed as a table
node run.cjs --out /some/dir                                     # write the dumps somewhere else
```

Careful: without `--out`, a filtered run such as `node run.cjs --layout top --compact true` writes into the golden `fixtures/` directory. Use `--out` (or `--check`) when you only want to look.

The harness loads `build/d3-org-chart.js`, the UMD build, which it finds via `require.resolve`. The UMD build contains the same layout logic as `src/`. `require('d3-org-chart')` would also work on the Node versions above: it resolves through `exports.default` to the ESM source, whose bare `'d3-flextree'` import resolves through `main` to flextree's UMD build (a harness variant using it regenerated `top-true` with 0 difference). Only a deep import of `d3-flextree/index.js` fails, because its internal imports have no file extensions.

jsdom is missing a few browser APIs, so the harness stubs them: canvas `getContext`, `SVGElement.transform.baseVal.consolidate()` (the d3 transform transition needs it), `getBBox`, `matchMedia` and `ResizeObserver`. None of these stubs affect the layout math.

## Synthetic dataset and chart settings

Nodes are 250×150 unless a size is listed.

```
root
├─ mA            leaves a1 a2 a3(320×190) a4 a5
├─ mB (360×200)  leaves b1 b2, then sub-manager bS with leaves s1 s2 s3
└─ mC            single leaf c1 (never compacted: a grid needs at least 2 leaf children)
```

The dataset is chosen to cover these cases:
- `a3` is a wide, tall leaf, so the compact grid under mA has mixed cell sizes.
- `mB` is a large manager, so its children start lower than its siblings' children.
- `mB` mixes leaves with a non-leaf (`bS`), so only some of its children go into a grid.

The two extra fixtures use `layout: 'top'` with `compact: true`. They change only the order of mB's children:

| Fixture | Dataset | mB's child order |
|---|---|---|
| `extra-top-true-interleaved` | `DATA_INTERLEAVED` | `b1, bS, b2` |
| `extra-top-true-managerfirst` | `DATA_MANAGER_FIRST` | `bS, b1, b2` |

Chart settings:
- **Size and render options:** `svgWidth(1200)`, `svgHeight(800)`, `duration(0)`, `initialExpandLevel(99)`, `rootMargin` left at its default of 40.
- **Node size:** `nodeWidth = d.data.w || 250`, `nodeHeight = d.data.h || 150`.
- **Margins:** siblingsMargin 20, childrenMargin 60, neighbourMargin 80, compactMarginPair 100, compactMarginBetween 20. These are the library defaults, set explicitly.
- **Sequence:** the harness calls `render()`, then `expandAll()`, then waits 120 ms for the transitions to flush. Then it reads `getChartState().root.descendants()` and the DOM.

## Fixture schema

```jsonc
{
  "meta": {
    "library": "d3-org-chart@3.1.1 (UMD build) under jsdom",
    "layout": "top" | "left" | "bottom" | "right",
    "compact": true | false,
    "margins": { "siblingsMargin": 20, ... },
    "defaultNodeSize": [250, 150],
    "centerGTransform": "translate(600,40) scale(1)",   // where the root anchor sits in the SVG
    "visibleNodeCount": 16, "domNodeCount": 16,
    "fields": "...", "dataset": "DATA" | "DATA_INTERLEAVED" | "DATA_MANAGER_FIRST"
  },
  "nodes": [ /* root.descendants() order (breadth-first) */ ]
}
```

| Node field | Meaning |
|---|---|
| `id`, `parentId`, `depth` | Tree structure. The root has `parentId: null` and depth 0. |
| `x`, `y` | Final coordinates in centerG space, after flextree, after `calculateCompactFlexPositions` and after the layout's `swap`. The root is always at `(0,0)`. Add the `centerGTransform` translate to get SVG pixels. |
| `width`, `height` | The node's real drawn size. They are not swapped in left/right. |
| `compactEven` | Compact grid leaves only. `true` means column 0 (the left column in top/bottom, the upper column in left/right). `false` means column 1. `null` for nodes outside a grid and in every non-compact fixture. |
| `row` | Compact grid row index, `floor(i / 2)`. `null` outside a grid. (The library itself leaves `row`, and with compact off all four compact fields, `undefined`; the harness writes `undefined` as `null`. See `../layout-algorithm.md` section 5.11.) |
| `flexCompactDim` | `[cross, main]` extent of the compact block in the flextree frame, where cross is the sibling axis. Only the grid's first leaf has the real value, for example `[740, 530]` for mA in top. The other grid leaves have `[0, 0]`. `null` outside a grid. In left/right, cross is measured with heights and main with widths. |
| `firstCompactNode` | The id of the grid's first leaf, or `null`. |
| `box` | `{left, top, right, bottom}` of the drawn rect in centerG space, read from the DOM. |
| `domTransform` | The raw `transform` attribute of the node's `<g>`. |

### Coordinate convention per layout

`analyze.cjs` checks this table against the DOM boxes in all 10 fixtures.

| layout | `x` is | `y` is | box `[left, top, right, bottom]` | children grow | centerG translate |
|---|---|---|---|---|---|
| top | horizontal centre | top edge | `[x-w/2, y, x+w/2, y+h]` | +y | `(svgWidth/2, rootMargin)` = (600, 40) |
| bottom | horizontal centre | bottom edge | `[x-w/2, y-h, x+w/2, y]` | −y | `(svgWidth/2, svgHeight-rootMargin)` = (600, 760) |
| left | left edge | vertical centre | `[x, y-h/2, x+w, y+h/2]` | +x | `(rootMargin, svgHeight/2)` = (40, 400) |
| right | right edge | vertical centre | `[x-w, y-h/2, x, y+h/2]` | −x | `(svgWidth-rootMargin, svgHeight/2)` = (1160, 400) |

`bottom` is `top` with y negated, and `right` is `left` with x negated.

The fixtures have no overlapping boxes. The smallest gap is 20 (siblingsMargin) in non-compact fixtures. In compact fixtures it is 10 (siblingsMargin/2), between a compact grid and an adjacent non-leaf sibling. For the full algorithm write-up, see `../layout-algorithm.md`.
