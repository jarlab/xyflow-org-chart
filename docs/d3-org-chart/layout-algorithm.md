# How d3-org-chart lays out an org chart

This document is a study of the layout algorithm in **d3-org-chart 3.1.1** and of the engine it delegates to, **d3-flextree 2.1.2**. It is written for an engineer who will rebuild the same layout on xyflow (React Flow). It should be precise enough to reimplement from, and it also explains why the result looks the way it does.

**Citation convention.** `d3-org-chart.js:NNN` refers to `src/d3-org-chart.js` in the d3-org-chart 3.1.1 npm package. `flextree.js:NNN` refers to `src/flextree.js` in the d3-flextree 2.1.2 npm package. `tree.js:NNN` refers to d3-hierarchy's `src/tree.js` (d3.tree), which is only used for comparison. A bare `:NNN` inside a d3-org-chart paragraph means `d3-org-chart.js:NNN`.

**Defaults used in every number below,** unless stated otherwise:

| attr | default | where |
|---|---|---|
| nodeWidth, nodeHeight | 250, 150 | :52-53 |
| siblingsMargin | 20 | :55 |
| childrenMargin | 60 | :56 |
| neighbourMargin | 80 | :54 |
| compactMarginPair | 100 | :57 |
| compactMarginBetween | 20 | :58 |
| linkYOffset | 30 | :63 |
| compact | **true** | :71 |
| layout | `"top"` | :70 |
| rootMargin | 40 | :51 |
| initialExpandLevel | 1 | :34 |
| pagingStep, minPagingVisibleNodes | 5, 2000 | :64-65 |
| duration | 400 ms | :67 |

**Status of the claims.** Everything here was cross-checked against the source and, for about 90 claims, against experiments that ran the real libraries (section 11). Where an adversarial verifier corrected the first reading, the corrected version is the one given here. Statements about the React Flow API (section 10) were checked afterwards against the source and docs of `@xyflow/react` 12.12.0 / `@xyflow/system` 0.0.83, plus a small store-level experiment; they were not tested in a rendered app. Where a behaviour is plausible but not guaranteed by the source, the text says so.

---

## 1. TL;DR

### The pipeline

1. **Stratify.** The flat rows `{id, parentId}` become a d3-hierarchy tree via `d3.stratify()` (:1407-1411).
2. **Visibility and paging.** Paging removes overflow children from the data and re-stratifies (:1424-1470). Every node is then collapsed (`children → _children`), and the ancestors of every node flagged `data._expanded` are re-opened (:1492-1508, :1365-1390). Only nodes reachable through `.children` take part in the layout.
3. **Per-node flex boxes with the margins baked in.** Each node gets `nodeSize = [width + siblingsMargin, height + childrenMargin]` (rotated for left/right) (:576-592, :365-371). The horizontal margin is split evenly on both sides. The vertical margin hangs below the card.
4. **Compact pre-pass** (compact mode, the default) (:757-796). Under any parent with at least 2 leaf children, the first leaf gets a fake flex size covering a whole 2-column grid. The other leaves get `[0,0]`.
5. **d3-flextree** (:843). This is van der Ploeg's non-layered tidy-tree algorithm, which runs in linear time. `spacing(a,b) = a.parent == b.parent ? 0 : neighbourMargin` (:592). The output is `x` = the centre of the box on the breadth axis and `y` = the top of the box on the depth axis, with the root at (0,0).
6. **Compact post-pass** (:798-830). The grid leaves are moved into two columns inside the block the first leaf reserved. Columns are `maxW + 100` apart centre to centre, and rows are `rowMaxH + 20` apart.
7. **Orientation swap** (:856). top: none. bottom: `y = −y`. left: swap x and y. right: `x = −y, y = x`. After the swap, (x, y) is the centre of the node's root-facing edge.
8. **Render.** Each node `<g>` is placed at its top-left corner, `translate(x + nodeLeftX, y + nodeTopY)` (:338/375/413/450). Edges are drawn as rounded elbow paths from the child's root-facing edge to the parent's far edge (`diagonal`/`hdiagonal`, :181-262). Compact leaves get a stub to a shared "spine".
9. **Animation and viewport.** Entering and exiting nodes animate from or to "join" points next to the triggering node. A click re-centres the viewport on the clicked subtree at the current zoom (:1235-1262), and `fit()` zooms to the bounding box (:1549-1584). None of this changes the layout.

### Why it looks good (the insights that matter)

- **It is a tidy tree, generalised to boxes of any size.** With uniform sizes the result equals classic Walker/Buchheim `d3.tree` up to floating-point rounding. The algorithm enforces the standard tidy-tree rules:
  - each parent is centred over its children;
  - subtrees are packed as tightly as their **actual contours** allow, not their bounding boxes, so a deep narrow subtree can tuck under a wide neighbour;
  - small subtrees caught between larger ones are spread evenly;
  - the drawing is mirror-symmetric.

  flextree adds real box sizes: children start at their own parent's bottom edge, and contours are compared by real y-extent, so a tall card is never overlapped by a neighbour's child.
- **There is a two-level gap hierarchy.** Between ordinary (non-grid) nodes, siblings sit 20 px apart, while adjacent nodes from different families sit 100 px apart (20 + 80). Next to a compact grid the gaps are 10 / 80 / 90 px instead, because the grid block carries no margins (sections 4.3, 5.8). The eye therefore groups each family as a unit. Each family's children share one top edge, 60 px below the parent.
- **Compact mode folds the leaf fan-out into a 2-column grid hanging off a spine.** In an org chart the leaves are what make the tree wide. On the 16-node test fixture, compact mode shrinks the drawing from about 2640 px wide to about 2030 px.
- **The links form a "comb".** Every child of a parent shares one horizontal bus at the same y, with 35 px rounded corners. Compact leaves join the same bus through the spine.
- **One canonical layout frame.** Everything is computed top-down in a single frame, and the other three orientations are produced by a swap of coordinates. You only ever implement one layout.

---

## 2. The pipeline end-to-end

### 2.1 Call graph

```
render()                                                 d3-org-chart.js:525-682
 ├─ attrs.svgWidth = container width (if > 0)             :539-541
 ├─ first draw: create d3.zoom                            :556-572
 ├─ attrs.flexTreeLayout = flextree({nodeSize}).spacing() :576-592
 ├─ setLayouts({expandNodesFirst:false})                  :594 → :1403-1509
 │   ├─ full stratify (generateRoot)                      :1407-1411
 │   ├─ initialExpandLevel > 1 → data._expanded on depth ≤ L, then attr := 1   :1414-1421
 │   ├─ paging pre-pass (hiddenNodesMap, _pagingButton)   :1424-1464
 │   ├─ re-stratify data minus paged-out rows             :1467-1470
 │   ├─ size snapshot: node.width/height (pixels)         :1472-1477
 │   ├─ root.x0 = root.y0 = 0; allNodes; counts           :1480-1490
 │   └─ collapse all below root (+root if L==0); expandSomeNodes(root)   :1492-1508
 ├─ build svg > g.chart > g.center-group > {links,nodes,connections}-wrapper  :598-647
 ├─ first draw: centerG.transform = centerTransform(...)  :649-661
 └─ update(attrs.root)                                    :666

update({x0, y0, x=0, y=0, width, height})                 :833-1264
 ├─ compact? calculateCompactFlexDimensions(root)         :838-840 → :757-796
 ├─ treeData = attrs.flexTreeLayout(attrs.root)           :843
 ├─ compact? calculateCompactFlexPositions(root)          :846-848 → :798-830
 ├─ nodes = descendants(); links = descendants().slice(1) :850, :855
 ├─ nodes.forEach(layoutBindings[layout].swap)            :856
 ├─ connections (both ends visible)                       :858-877, :963-1009
 ├─ links enter/update/exit                               :879-960
 ├─ nodes enter/update/exit                               :1012-1227
 ├─ d.x0 = d.x; d.y0 = d.y                                :1230-1233
 └─ if some node has data._centered → fit({scale:false, nodes:subset})    :1235-1262
```

Other entry points:
- `updateNodesState()` (:1393-1401) does `setLayouts` followed by `update(root)`. It is used by `addNode`, `removeNode` and `loadPagingNodes`.
- `onButtonClick()` (:1305-1341) toggles `children`/`_children` on the existing hierarchy and calls `update(d)`. It does **not** re-stratify and does **not** refresh `d.width/height`.

### 2.2 Who writes `x` / `y`

The full list of writers:
- flextree, through its wrapper setters (flextree.js:104-107);
- the compact post-pass (:806-824);
- `swap` (:337, :412, :449);
- the `x0/y0` bookkeeping (:1230-1233, :1480-1481).

The compact pre-pass also writes `compactEven`, `row`, `flexCompactDim` and `firstCompactNode` on grid cells; section 5.11 lists what these hold on every other node.

The layout is recomputed **from scratch** on every `update`. flextree's wrapper constructor zeroes `x, y` (flextree.js:95-96), so nothing accumulates between runs. The root always lands at (0,0).

### 2.3 What the accessors receive

- `nodeWidth`, `nodeHeight`, `siblingsMargin`, `childrenMargin` and `neighbourMargin` receive the d3-hierarchy **stratify node** (`.data`, `.parent`, `.children`, `.depth`). They do not receive the raw row.
- `node.height` is overwritten with the pixel height at :1476. d3's hierarchy height survives as `_hierarchyHeight`.
- Inside `setLayouts` (the snapshot at :1473-1476) the accessors run while `node.height` is still the hierarchy height and `node.width` is still undefined. Inside flextree they see the pixel height (section 4.4). `_hierarchyHeight` is measured on the **paged** tree.
- flextree reads `nodeSize` through a getter that is never cached. It runs roughly 5–13 times per node per layout (flextree.js:102): about 7.2 on the 16-node fixture, 5–6 on small random trees, 7.5–8 at 100–1000 nodes. Accessors must be cheap.

---

## 3. d3-flextree in depth

d3-flextree is a JavaScript port of A.J. van der Ploeg, *Drawing Non-layered Tidy Trees in Linear Time* (Software: Practice and Experience, 2014; the README says 2013). The study compared it function by function with the Java reference `Paper.java` from github.com/cwi-swat/non-layered-tidy-trees:

| flextree.js | Paper.java | role |
|---|---|---|
| `layoutChildren` 175-190 | `firstWalk` | post-order: assign y, separate subtrees, place the parent |
| `separate` 225-266 | `seperate` | push a new subtree clear of its left siblings |
| `moveSubtree` 270-274, `distributeExtra` 276-286 | `moveSubtree`, `distributeExtra` | move a subtree; queue spacing for the siblings in between |
| `shiftChange` 213-221 | `addChildSpacing` | apply the queued spacing |
| `setLThr`/`setRThr` 296-322 | `setLeftThread`/`setRightThread` | threads and extreme nodes |
| `positionRoot` 325-337 | `positionRoot` + `setExtremes` | centre the parent |
| `updateLows` 341-351 | `updateIYL` | the "IYL" list |
| `resolveX` 196-209 | `secondWalk` | relative x → absolute x |

### 3.1 The problem, compared with Reingold–Tilford / Walker / Buchheim (`d3.tree`)

`d3.tree` treats every node as a **point on a lattice**:
- **Horizontal.** Adjacent nodes are placed `separation(a,b)` units apart, centre to centre (tree.js:152, 158, 195). The result is then scaled by `dx` (tree.js:220).
- **Vertical.** The layout is strictly layered: `y = depth·dy` (tree.js:221).
- **Contour walk.** `apportion` advances both inner contours **one depth level per step** (tree.js:191). It only ever compares two nodes at the same depth.
- **Parent placement.** The parent goes at the midpoint of its first and last child **centres** (tree.js:150).

This breaks down with variable sizes:
- **Variable widths can be faked.** `nodeSize([1,dy])` with a pixel separation `(a.w+b.w)/2 + gap` avoids overlaps when heights are uniform. The x values still differ from flextree in essentially every random tree (250 of 250 in the verification run), because the parent-centring rule differs.
- **Variable heights cannot be faked.**
  - Rows must start at each parent's bottom, not at a global `depth·dy`.
  - A tall node at depth d reaches into the band of depth d+1, but the level-by-level walk never compares it with the neighbouring subtree's depth-(d+1) nodes.
  - Experiment: take d3.tree's x values and use parent-bottom y values. 236 of 250 random variable-height trees overlap. flextree overlaps in 0 of 250, and in 0 of 2000 in a larger fuzz.

What van der Ploeg changes:

| | d3.tree (Buchheim) | flextree (van der Ploeg) |
|---|---|---|
| node | point | box `[xSize, ySize]` |
| y | `depth·dy` | `parent.y + parent.ySize` (flextree.js:179) |
| contour step | one level at a time | advance whichever contour node **ends higher** (by bottom y), or both on a tie (flextree.js:250-259) |
| who owns the colliding left node | `ancestor` / `nextAncestor` pointers | the **IYL** list of left siblings ordered by lowest y (flextree.js:339-351) |
| threads | the `t` pointer; modifier sums are rebuilt along the way | the extreme nodes carry precomputed modifier sums (`lExtRelX/rExtRelX`), so a thread joins contours across any y range in O(1) |
| gap parameter | `separation(a,b)`: a centre-to-centre multiplier (default 1 for siblings, 2 otherwise, tree.js:3-5); its argument order is inconsistent | `spacing(a,b)`: an extra edge-to-edge gap in pixels, always (left, right) |
| parent position | midpoint of the first/last child **centres** | midpoint of the first child's **left edge** and the last child's **right edge** (flextree.js:329-330) |

**Uniform sizes reduce to d3.tree.** With d3-org-chart's defaults (nodeSize `[270, 210]`, spacing 0 or 80), flextree matches `d3.tree().nodeSize([1, 210]).separation((a,b) => a.parent === b.parent ? 270 : 350)` **up to floating-point rounding** (maximum difference about 1e-11). The results are bit-identical in 989 of 1000 random trees; the rest differ only in the last bits, because the divisions in `distributeExtra` and the centring round differently. Compare with a tolerance. So d3-org-chart's default look *is* the Walker/Buchheim tidy tree. flextree only changes the picture when sizes vary.

### 3.2 Data structures

`layout(tree)` builds a parallel tree of wrapper objects (flextree.js:22-26, 116-139). Each wrapper's `data` is your hierarchy node, and the class chain is wrapper → FlexNode → d3 `Node`. `wrap` follows `node.children` only, so `_children` (collapsed) subtrees are invisible to the layout.

| field | Java | meaning |
|---|---|---|
| `x`, `y` | — | getters/setters **proxied to `data.x/.y`** (flextree.js:104-107). The constructor's `Object.assign({x:0,y:0,…})` zeroes your node's x/y before the layout runs. |
| `size` → `xSize`, `ySize` | `w, h` | `get size(){ return nodeSize(this.data) }` (flextree.js:102). Recomputed on every read, never cached. `bottom = y + ySize`, `left = x − xSize/2`, `right = x + xSize/2` (flextree.js:43-48). |
| `relX` | `mod` | the offset of this node **and its whole subtree** relative to the parent's children frame, so moving a subtree means changing one number |
| `prelim` | `prelim` | the node's centre in its own children frame. It is 0 for leaves, **except** that `setLThr/setRThr` change the extreme leaf's `prelim` and `relX` together. Only `relX + prelim` is invariant. |
| `shift`, `change` | `shift`, `change` | Walker's lazily accumulated spacing for intermediate siblings |
| `lExt`, `rExt` | `el`, `er` | the extreme (lowest) node on the subtree's left/right contour. Initially `this`. `bottom(lExt) == bottom(rExt) ==` the deepest bottom in the subtree (verified in 61,638 subtree checks, 0 mismatches). |
| `lExtRelX`, `rExtRelX` | `msel`, `mser` | the sum of `relX` along the contour path (threads included) from the subtree root to the extreme node |
| `lThr`, `rThr` | `tl`, `tr` | threads. When a contour node has no children, `nextLContour/nextRContour` follow the thread to the next contour node below it (flextree.js:288-294). |
| IYL `{lowY, index, next}` | `IYL` | a per-parent singly linked list of left siblings still visible on the right contour of the forest `c[0..i-1]`. Its head is the most recent child. Going from head to tail, `lowY` strictly increases and `index` decreases. |

Invariant: inside a subtree rooted at `s`, the centre of a descendant `v` in the frame of `s`'s parent is `Σ relX(s..v, inclusive) + prelim(v)`.

### 3.3 The passes

#### Entry: `layout(tree)` (flextree.js:22-26)
`wrap`, then `wtree.update()`, which is `layoutChildren(root)` followed by `resolveX(root)` (flextree.js:108-112). It returns `wtree.data`, i.e. **the same root object you passed in**. Only `x` and `y` are written back. Plain d3 nodes do not get `xSize`, `extents` and the rest; those exist only on nodes created with `layout.hierarchy()`.

#### First walk: `layoutChildren(w, y = 0)` (flextree.js:175-190), post-order
1. `w.y = y`. The root gets 0, and **y is the top of the box**.
2. For each child `i`, from left to right:
   - Recurse with `layoutChildren(kid, w.y + w.ySize)`. **Non-layered:** a child's top is its parent's top plus the parent's full `ySize`, which includes the vertical margin.
   - Read `lowY = bottom(i === 0 ? kid.lExt : kid.rExt)` **before** separating. `setRThr` may redirect `kid.rExt`, so the order matters.
   - If `i > 0`, call `separate(w, i, lows)`.
   - `lows = updateLows(lowY, i, lows)`.
3. `shiftChange(w)` applies the queued spacing for intermediate siblings.
4. `positionRoot(w)` centres w and inherits the extremes.

#### `separate(w, i, lows)` (flextree.js:225-266): push c[i] clear of the forest c[0..i-1]
All positions are in w's children frame, where child k's centre is `c[k].relX + c[k].prelim`. When c[i] arrives, its `relX` is 0, so it usually overlaps everything.

```
rContour = c[i-1]; rSumMods = c[i-1].relX       // right contour of the left forest
lContour = c[i];   lSumMods = c[i].relX         // left contour of the new subtree
isFirst = true
while rContour && lContour:
  if bottom(rContour) > lows.lowY: lows = lows.next          // the owner of rContour is an older sibling
  dist = (rSumMods + rContour.prelim) - (lSumMods + lContour.prelim)
       + rContour.xSize/2 + lContour.xSize/2
       + spacing(rContour.data, lContour.data)               // (left, right), hierarchy nodes
  if dist > 0 || (dist < 0 && isFirst):
      lSumMods += dist; moveSubtree(c[i], dist); distributeExtra(w, i, lows.index, dist)
  isFirst = false                                            // cleared unconditionally
  rb = bottom(rContour); lb = bottom(lContour)
  if rb <= lb: rContour = nextRContour(rContour); if rContour: rSumMods += rContour.relX
  if rb >= lb: lContour = nextLContour(lContour); if lContour: lSumMods += lContour.relX
if !rContour && lContour: setLThr(w, i, lContour, lSumMods)  // new subtree is deeper
elif rContour && !lContour: setRThr(w, i, rContour, rSumMods) // left forest is deeper
```

- **`dist`** is the overlap of the left node's right edge past the right node's left edge, plus the required gap. A positive value means "push c[i] right by dist".
- **`isFirst`.** The first comparison is always between the two sibling **roots**. Only on that comparison is a negative `dist` also applied, which pulls c[i] left until the roots are exactly `spacing` apart. After it, comparisons can only push right. This plays the role of d3.tree's "place next to the left sibling first" (tree.js:152, 158). Without it, a leaf sibling next to a wide subtree ends up needlessly far away (experiment: L:[−22.5,−12.5], M:[12.5,22.5] instead of touching).
- **Which pairs are compared.** Each step advances the contour node(s) that end higher, so every compared pair overlaps in y. Nodes that only touch vertically (one's bottom equals the other's top) are never compared.
- **Difference from the Java reference.** Java clears `first` only after a move (Paper.java:70-73). If the root comparison gives exactly 0, a later negative `dist` can then pull the subtree left into its sibling. The Java rule produced overlaps in 9 of 20,000 random trees; flextree produced 0.

#### `moveSubtree(s, d)` (flextree.js:270-274)
`s.relX += d; s.lExtRelX += d; s.rExtRelX += d`. This moves the subtree in O(1) and keeps the extreme sums consistent.

#### `distributeExtra` + `shiftChange` (flextree.js:276-286, 213-221): Walker's even spreading
Suppose c[i] is pushed by `dist` because it collides with an older sibling `si = lows.index < i−1`. The siblings between them would otherwise stay bunched against `si`. With `n = i − si > 1` and `delta = dist/n`:

```
c[si+1].shift += delta;  c[i].shift -= delta;  c[i].change -= dist - delta      // queue (O(1))
// later, once per parent:
shiftSum = 0; changeSum = 0
for c in children: shiftSum += c.shift; changeSum += shiftSum + c.change; c.relX += changeSum
```

Child j with `si < j < i` gets an extra `(j − si)·dist/n`, and child i and every later child get exactly 0. Each gap from si to i therefore grows by `dist/n`. The verifier checked this formula against all 62,680 children of 2000 random trees (maximum error 7.8e-14). Example: siblings `[A(deep), s1, s2, D(deep)]`, where D collides with A at depth 3 with dist 30. s1 gets +10 and s2 gets +20, giving A −45, s1 −15, s2 15, D 45. Without distribution the result is s1 −25, s2 −5.

Applying the shifts here (before `positionRoot`) instead of in the second walk, as Java does, changes no position: the maximum |dx| over 3000 trees is 0. This is because the first and last children always receive 0 extra.

`shiftChange` adds to an intermediate child's `relX` without updating its `*ExtRelX`. That is harmless, because intermediate children are never on the parent's outer contours.

#### Threads: `setLThr` / `setRThr` (flextree.js:296-322)

`setLThr(w, i, lContour, lSumMods)`: the new subtree c[i] is deeper than the whole forest c[0..i−1], so the forest's left contour must continue from c[0]'s lowest-left node into c[i].
```
e = c[0].lExt
e.lThr = lContour
diff = lSumMods - lContour.relX - c[0].lExtRelX
e.relX += diff; e.prelim -= diff        // walking the thread now yields the true modifier sum;
                                        // e's absolute x is unchanged (relX + prelim preserved)
c[0].lExt = c[i].lExt; c[0].lExtRelX = c[i].lExtRelX
```
`setRThr` is the mirror image. The left forest is deeper, so `c[i].rExt.rThr = rContour`, and `c[i].rExt/rExtRelX` take `c[i−1]`'s values.

The thread-adjusted `relX` **is** read by `resolveX` on the extreme leaf. It is harmless only because that node is a leaf and `relX + prelim` is preserved. A thread target can be **another sibling root**: with tall leaf A, short leaf B and tall leaf C, `B.rThr → A`, so C is compared with A (see 3.6).

#### `positionRoot(w)` (flextree.js:325-337)
```
w.prelim = ((k0.relX + k0.prelim - k0.xSize/2) + (kf.relX + kf.prelim + kf.xSize/2)) / 2
w.lExt = k0.lExt; w.lExtRelX = k0.lExtRelX; w.rExt = kf.rExt; w.rExtRelX = kf.rExtRelX
```
The parent is centred over **first child's left edge … last child's right edge**, measured on the margin-inclusive boxes. Example: children 100 wide and 10 wide put the parent at 0, while the midpoint of the child centres is 22.5. In a variable-size pipeline experiment (top, non-compact), a parent landed at x = −500 over children at −660 (xSize 280) and −360 (xSize 320), i.e. (−800 + −200)/2, while the mean of the child centres is −510. In the ground-truth fixture top-true, the root at 0 is centred over mA's flex left edge (−902.5) and mC's flex right edge (+902.5) (section 4.4).

#### `updateLows(lowY, index, lows)` (flextree.js:341-351)
Pop every entry with `lowY <= newLowY`: those siblings are now completely hidden behind the new subtree. Then prepend `{lowY, index}`. In `separate`, the rule `if bottom(rContour) > lows.lowY: lows = lows.next` advances at most one entry per step. That is enough, because each listed sibling owns at least one contour node. Verified: at all 131,538 comparisons in 2000 random trees, `lows.index` equalled the child of w that really owns `rContour`.

#### Second walk: `resolveX(w, prevSum, parentX)` (flextree.js:196-209)
The root call has no arguments, so `prevSum = −root.relX − root.prelim`. This **pins the root's centre at x = 0**. Then for every node, `sum = prevSum + w.relX` and `w.x = sum + w.prelim`. The walk follows real parent→child edges only, never threads. There is **no normalisation**: the tree extends into negative x. Java instead shifts the tree so that min x = 0.

### 3.4 Faithful pseudocode (verified)

This reimplementation produced **0 difference** in x and y from the real library over 3000 random trees with mixed sizes and sibling/cousin spacing. The verifier also transcribed it independently and got the same result.

```js
// Input: hierarchy with node.children (null/[] for leaves); nodeSize(node) -> [xSize, ySize] (margins INCLUDED);
// spacing(leftNode, rightNode) -> extra horizontal gap. Output: node.x = CENTRE, node.y = TOP; root at (0,0).
function flextreeLayout(root, nodeSize, spacing) {
  const wrap = (d, parent) => {
    const [xs, ys] = nodeSize(d);                       // library re-calls nodeSize on every read; caching is equivalent
    const w = { d, parent, xs, ys, y: 0, relX: 0, prelim: 0, shift: 0, change: 0,
                lThr: null, rThr: null, lExtRelX: 0, rExtRelX: 0 };
    w.lExt = w; w.rExt = w;
    w.kids = d.children && d.children.length ? d.children.map(c => wrap(c, w)) : null;
    return w;
  };
  const bottom = n => n.y + n.ys;
  const nextL = n => n.kids ? n.kids[0] : n.lThr;
  const nextR = n => n.kids ? n.kids[n.kids.length - 1] : n.rThr;
  const moveSubtree = (s, d) => { s.relX += d; s.lExtRelX += d; s.rExtRelX += d; };
  const distributeExtra = (w, i, si, dist) => {
    const n = i - si;
    if (n > 1) { const delta = dist / n;
      w.kids[si + 1].shift += delta; w.kids[i].shift -= delta; w.kids[i].change -= dist - delta; }
  };
  const setLThr = (w, i, lC, lSum) => {
    const k0 = w.kids[0], e = k0.lExt;
    e.lThr = lC;
    const diff = lSum - lC.relX - k0.lExtRelX;
    e.relX += diff; e.prelim -= diff;
    k0.lExt = w.kids[i].lExt; k0.lExtRelX = w.kids[i].lExtRelX;
  };
  const setRThr = (w, i, rC, rSum) => {
    const cur = w.kids[i], e = cur.rExt;
    e.rThr = rC;
    const diff = rSum - rC.relX - cur.rExtRelX;
    e.relX += diff; e.prelim -= diff;
    cur.rExt = w.kids[i - 1].rExt; cur.rExtRelX = w.kids[i - 1].rExtRelX;
  };
  const separate = (w, i, lows) => {
    let r = w.kids[i - 1], rSum = r.relX;
    let l = w.kids[i],     lSum = l.relX;
    let isFirst = true;
    while (r && l) {
      if (bottom(r) > lows.lowY) lows = lows.next;
      const dist = (rSum + r.prelim + r.xs / 2) - (lSum + l.prelim - l.xs / 2) + spacing(r.d, l.d);
      if (dist > 0 || (dist < 0 && isFirst)) {
        lSum += dist; moveSubtree(w.kids[i], dist); distributeExtra(w, i, lows.index, dist);
      }
      isFirst = false;
      const rb = bottom(r), lb = bottom(l);
      if (rb <= lb) { r = nextR(r); if (r) rSum += r.relX; }
      if (rb >= lb) { l = nextL(l); if (l) lSum += l.relX; }
    }
    if (!r && l) setLThr(w, i, l, lSum);
    else if (r && !l) setRThr(w, i, r, rSum);
  };
  const firstWalk = (w, y) => {
    w.y = y;
    let lows = null;
    (w.kids || []).forEach((k, i) => {
      firstWalk(k, w.y + w.ys);
      const lowY = bottom(i === 0 ? k.lExt : k.rExt);   // read BEFORE separate
      if (i > 0) separate(w, i, lows);
      while (lows && lowY >= lows.lowY) lows = lows.next;
      lows = { lowY, index: i, next: lows };
    });
    if (w.kids) {
      let s = 0, c = 0;
      for (const k of w.kids) { s += k.shift; c += s + k.change; k.relX += c; }
      const k0 = w.kids[0], kf = w.kids[w.kids.length - 1];
      w.prelim = ((k0.relX + k0.prelim - k0.xs / 2) + (kf.relX + kf.prelim + kf.xs / 2)) / 2;
      w.lExt = k0.lExt; w.lExtRelX = k0.lExtRelX; w.rExt = kf.rExt; w.rExtRelX = kf.rExtRelX;
    }
  };
  const secondWalk = (w, sum) => {
    sum += w.relX;
    w.d.x = sum + w.prelim;
    w.d.y = w.y;
    (w.kids || []).forEach(k => secondWalk(k, sum));
  };
  const wr = wrap(root, null);
  firstWalk(wr, 0);
  secondWalk(wr, -wr.relX - wr.prelim);
  return root;
}
```

The details that carry the weight:
- `isFirst = false` is unconditional;
- `lowY` is read before `separate`;
- the thread setters adjust both `relX` and `prelim`;
- contours advance by bottom y, not by depth.

### 3.5 Worked example: the README tree

R is `[1×1]` with children A `[2×4]` and B `[3×1]`, and B has a child C `[4×1]`. Spacing is 0.
1. `separate(R,1)`, roots A|B: `dist = 0+1 − (0−1.5) = 2.5`, so `B.relX = 2.5`.
2. A's bottom is 5 and B's bottom is 2, so only the left contour advances, to C. A|C: `dist = 1 − (2.5 − 2) = 0.5`, so `B.relX = 3`.
3. The left contour runs out (C's bottom is 3, which is < 5), so `setRThr` runs: `C.rThr = A`, `diff = −3`, `C.relX = −3`, `C.prelim = +3`.
4. `positionRoot`: `R.prelim = (−1 + 4.5)/2 = 1.75`.
5. `resolveX`: R(0,0), A(−1.75,1), B(1.25,1), C(1.25,2).

The wide C clears the tall A because they overlap in y (A spans 1..5, C spans 2..3). That forces a 0.5 gap between A and B, which a layered algorithm would never detect.

### 3.6 Semantics and caveats

- **Coordinates.** `x` is the **centre** of the xSize box and `y` is the **top**. The root is at (0,0). The box `[x−xSize/2, x+xSize/2] × [y, y+ySize]` is the exclusion zone that the algorithm keeps disjoint.
- **No vertical spacing accessor.** All vertical gap must go into `ySize`, and it belongs to the box of the parent above it.
- **Adjacent siblings end up *at least* `spacing` apart, not exactly.** After the root comparison they are exactly `spacing` apart, but deeper collisions and `distributeExtra` can widen the gap. In a fuzz with spacing 3, 4844 of 10,285 adjacent sibling pairs ended up further apart than 3.
- **`spacing()` is also called for same-parent, non-adjacent pairs.** Calls go to adjacent sibling roots (always the first call), to cousins of any degree along the inner contours, to nodes **at different depths** (e.g. a tall depth-1 node against a neighbour's depth-2 node), and, through threads, to **non-adjacent siblings**. Example: with tall/short/tall leaves L0, L1, L2, the calls are `L0|L1`, `L1|L2` and `L0|L2`, the last via `L1.rThr → L0`, and it gets spacing 0 because the parent is shared. This also happens with compact mode's `[0,0]` placeholders. It is benign, because the sibling in between already enforces the separation.
- **Spacing is enforced only between contour neighbours.** Constraints between other pairs hold only transitively, through the boxes in between. A non-transitive spacing function (e.g. "40 if the path length is > 4 else 0") left y-overlapping pairs closer than `spacing(a,b)` in 18 of 800 trees. d3-org-chart's `sameParent ? 0 : 80` is unaffected in practice.
- **Zero-size nodes are accepted, with surprising results.** The root comparison of two zero-width siblings gives `dist = 0`, so nothing moves and lone zero-width siblings **coincide at one x**. They spread only if a later sibling collides with an older one, through `distributeExtra`. A zero `ySize` puts the children at the parent's own y. d3-org-chart's compact placeholders are zero-size, but they are moved afterwards (section 5), so this is not visible there.
- **Negative spacing** is honoured and makes boxes overlap by that amount.
- **Mirror symmetry.** Reversing every child list negates every x, up to about 1e-12, even with variable sizes, provided the spacing function is symmetric.
- **Complexity is O(n).** Each step of `separate` retires at least one contour node, IYL entries are pushed and popped once each, and `shiftChange` is O(children). Measured: about 6 ms for 1k nodes, 41 ms for 10k, 278 ms for 100k and 808 ms for 300k, i.e. about 2.7 µs/node (machine-dependent). `spacing` is called about 1–2 times per node, and `nodeSize` roughly 5–13 times per node because it is never cached (about 7.2 on the 16-node fixture). **Memoise sizes.**
- **Recursion.** `wrap`, `layoutChildren` and `resolveX` recurse to the depth of the tree. A single chain deeper than **1712** nodes throws `RangeError` with Node 22's default stack (7984 with `--stack-size=4000`; browsers differ). This is irrelevant for org charts.
- **`layout.hierarchy()`** captures the nodeSize accessor when it is created. If you change `nodeSize` later, `layout()` uses the new sizes but `node.xSize` reports the old ones. d3-org-chart does not use this API.
- **Imports.** `import {flextree} from 'd3-flextree'` works in bundlers and in plain Node 22 ESM, which resolves `main`, the UMD build. Only a deep import of `d3-flextree/index.js` fails, because its internal imports lack file extensions.

---

## 4. How d3-org-chart drives flextree

### 4.1 The configuration (d3-org-chart.js:576-592)

```js
attrs.flexTreeLayout = flextree({
  nodeSize: node => layoutBindings[layout].nodeFlexSize({
    state: attrs, node,
    width: attrs.nodeWidth(node), height: attrs.nodeHeight(node),
    siblingsMargin: attrs.siblingsMargin(node), childrenMargin: attrs.childrenMargin(node) }),
}).spacing((nodeA, nodeB) => nodeA.parent == nodeB.parent ? 0 : attrs.neighbourMargin(nodeA, nodeB));
```

`nodeFlexSize` (top :365-371, bottom :403-409, left :328-334, right :435-441):
- compact and `node.flexCompactDim` set → `flexCompactDim`, verbatim (section 5);
- top/bottom → `[width + siblingsMargin, height + childrenMargin]`;
- left/right → `[height + siblingsMargin, width + childrenMargin]` (the rotated frame).

Running d3-flextree directly with this exact configuration on a `d3.stratify` root reproduced the real OrgChart's top-layout x/y with a maximum difference of 0 (verified under jsdom).

### 4.2 Flex box vs drawn box (top layout, defaults)

```
 x-135      x-125                    x                   x+125      x+135
   ┊          ┊                      ┊                     ┊          ┊
y  ┌──────────┬────────────────────────────────────────────┬──────────┐ ─┐
   │  sm/2=10 │                                            │ sm/2=10  │  │
   │          │            drawn card  250 × 150           │          │  │ height
   │          │      g transform = translate(x-125, y)     │          │  │ 150
   │          │                                            │          │  │
y+150 ─ ─ ─ ─ └──────────────────────┬─────────────────────┘ ─ ─ ─ ─ ─│ ─┘
   │                                 │  link from (x, y+150)            │ ─┐
   │              childrenMargin = 60 (belongs to THIS node's box)    │  │ 60
   │                                                                  │  │
y+210 ────────────────────────────────────────────────────────────────┘ ─┘
   └────────────────── flex box: xSize = 270, ySize = 210 ────────────┘
                     children's flex boxes start at y + 210
```

- `siblingsMargin` is split evenly: 10 px on each side of the card.
- `childrenMargin` sits entirely **below** the card. It is evaluated on the **parent** (`childrenMargin(parent)`), because it lives inside the parent's ySize.
- The drawn card is `[x − w/2, x + w/2] × [y, y + h]`.

### 4.3 The resulting gaps

Non-compact (`compact(false)`), measured on the drawn cards:

| pair | gap | why |
|---|---|---|
| adjacent siblings | **20** (at least; more if deeper subtrees collide) | 10 + 10 of baked-in margin, spacing 0 |
| adjacent cousins / different families (contour neighbours) | **100** | 10 + 10 + neighbourMargin 80 |
| parent bottom → child top | **60** | parent's ySize = h + 60; measured from the parent's **far edge** |

Compact mode (the default) changes the numbers next to a grid. The grid block carries no margins (section 5.8):

| pair | gap |
|---|---|
| grid block ↔ adjacent non-leaf sibling | **10** (= siblingsMargin/2), when the block is no taller than that sibling's flex box; otherwise deeper cousin comparisons push it to e.g. 90 |
| grid block ↔ cousin grid block | **80** (neighbourMargin only) |
| grid block ↔ cousin normal node | **90** |
| between the two grid columns | **100** (compactMarginPair) when widths are uniform |
| between grid rows | **20** (compactMarginBetween) after the tallest cell in the row |

Examples from the ground-truth fixture (top, 16 nodes, section 11):
- non-compact: `a1|a2 = 20`, `a5|b1 = 100`, `bS|c1 = 100`;
- compact: `b2|bS = 10`, mA grid flex edge → b1 flex edge `= 80` (the drawn `a2|b1` gap is 115, because a2 is narrower than its 320 px column slot).

### 4.4 Consequences you will see

- **Rows are not aligned across subtrees when parent sizes differ.** Each child's `y = parent.y + parent.height + childrenMargin(parent)`. In the fixture, mB is 200 px tall, so mB's children start at y = 470 while mA's and mC's start at y = 420. In left/right the same happens with widths: mB is 360 wide, so its children are at x = 730 versus 620. If you want aligned rows, give every node at one depth the same ySize, e.g. the depth's maximum height + childrenMargin. That is an enhancement, not what d3-org-chart does.
- **A parent is centred over the flex span of its children, not over a middle child.** In the compact top fixture the root is centred over mA's flex left edge (−902.5) and mC's flex right edge (+902.5). mB, the middle child, is at x = 117.5.
- **Expanding any subtree can move every node.** Placement is a global left-to-right merge, and only the root is pinned. Expanding a node does not necessarily move it, though: flextree does not separate nodes that do not overlap in y. In one experiment, expanding node 2 left it at x = −135 while its children extended under collapsed sibling 3's column.
- **Size snapshot mismatch.** `d.width/height` are written once per `setLayouts`, before collapsing (:1472-1477). flextree, however, calls `nodeWidth/nodeHeight` again on every `update` (:578-579). Rendering, links, buttons and fit use the snapshot. If an accessor depends on expansion state (e.g. `d => d.children ? 300 : 200`), the reserved space and the drawn box disagree. Verified: an overlap of −80 px. `onButtonClick` never refreshes the snapshot. In compact mode the first frame is hidden from this, because the grid sizes read the stored `node.width/height` (:777-781); the overlap appears after an expand.

---

## 5. Compact mode in depth

Compact is **on by default** (:71). It is what makes the default chart look the way it does: leaf siblings form a two-column grid that hangs off a vertical spine. Everything in this section happens in the **canonical flex frame**, before the orientation swap:
- `x` = breadth centre, `y` = depth top;
- `sizeColumn` = breadth size (width in top/bottom, height in left/right);
- `sizeRow` = depth size (height in top/bottom, width in left/right) (:323-327, :353-357, :393-397, :442-446).

### 5.1 Eligibility (:765-770)

For each node in pre-order with `node.children && node.children.length > 1`:
- `compactChildren = node.children.filter(d => !d.children)`, i.e. children that are **currently drawn without children**. This includes stratify leaves (`children` undefined) **and collapsed managers** (`children = null`, `_children` set).
- If `compactChildren.length < 2`, skip. This guard also prevents a NaN: with one compact child, `oddMax` would be `undefined`.
- Non-leaf siblings stay normal flextree nodes and are laid out beside the grid.

Consequences:
- A single child never triggers compact mode.
- **Two leaves do**: one row, 600 wide (±175), versus 520 (±135) with compact off, and the links switch from top-entry to side-entry.
- Grids never nest directly, but every generation can have its own grid.
- Expanding a collapsed manager pulls it out of its parent's grid, and every later grid member shifts cell. Paging-button nodes are leaves too, so they take a grid cell (with a hidden link).

### 5.2 Row/column assignment (:771-776)

Compact index `i` follows `node.children` order with the non-leaves filtered out:
- `firstCompact = (i == 0)`;
- `compactEven = (i % 2 == 0)`;
- `row = floor(i/2)`.

Even = **left** column in top/bottom, **upper** row in left/right. Cells fill row by row: (0,L) (0,R) (1,L) (1,R) …. With an odd count the last row has only a left cell, and the grid keeps its full width.

### 5.3 The grid block (:777-793)

```
maxCol    = max(sizeColumn(c) for all compact children)        // evenMax/oddMax are computed, then merged: ONE width for both columns
rowMax[r] = max(sizeRow(c) + compactMarginBetween(c)) per row  // groupBy → Object.entries, rows ascending
first.flexCompactDim = [2*maxCol + compactMarginPair,  Σ_r rowMax[r] − compactMarginBetween]
others.flexCompactDim = [0, 0]
all.firstCompactNode = compactChildren[0]
parent.flexCompactDim = null                                    // redundant (already reset at :762)
```

The parent does **not** reserve the room. The **first leaf** acts as a proxy for the whole grid, and `nodeFlexSize` returns `flexCompactDim` verbatim, with **no siblingsMargin and no childrenMargin**. flextree therefore sees one leaf of size `[gridWidth, exactGridHeight]` in the first leaf's sibling slot, plus several zero-size leaves.

The block's ySize matters even though it is a leaf. flextree separates contours by y-overlap, so neighbouring cousin subtrees are pushed away from the **whole** grid height, not just its first row. Example: two managers with 5 leaves each produce blocks [−640, −40] and [40, 640], exactly 80 apart.

### 5.4 What flextree does with the placeholders

- When a zero-size placeholder is first separated, it lands on its left sibling's right flex edge (flextree.js:238-247). With 5 leaves, the raw flextree x values are L1 = 0 (the centre of a 600 block) and L2..L5 = 300.
- In mixed groups, a later collision can move the placeholders again through `distributeExtra`, so they can land anywhere between their neighbours. For example, with default sizes and margins, `[L1, L2, L3, A(k1..k6)]` where each k_i has one child of its own (so A's children are **not** compactable) gives raw L1 = −612.5, L2 = 5.83, L3 = 324.17 and A = 777.5. If A's 6 children are leaves instead, they form A's own grid and the raw values become L1 = −257.5, L2 = 124.17, L3 = 205.83. Either way it does not matter, because the placeholders are moved into the grid afterwards.
- In an **all-leaf group**, the trailing zero-size nodes sit on the block's right edge. `positionRoot` therefore centres the parent **exactly over the block**.

### 5.5 Post-pass: x (:798-815)

Let `fch` be the first compact child (the first child with a truthy `flexCompactDim`; `[0,0]` is truthy), `D = fch.flexCompactDim[0]` and `pair = compactMarginPair`.

```
L = fch.x − D/2                                   // :806  block left edge (fch.x is mutated to this)
even i > 0:  x = L + D/4 − pair/4                 // :807
odd i:       x = L + 3D/4 + pair/4                // :808
centerX = L + D/2                                 // :810  middle of the block = spine
fch.x   = L + D/4 − pair/4                        // :811
offsetX = parent.x − centerX                      // :812
if |offsetX| < 10: every compact child x += offsetX   // :813-815
```

**Derivation.** Substitute `D = 2·maxCol + pair`:
- left column centre = `L + maxCol/2 + pair/2 − pair/2` = **`L + maxCol/2`**;
- right column centre = `L + 1.5·maxCol + pair/2 + pair/2` = **`L + 1.5·maxCol + pair`**;
- so the column centres are **`maxCol + pair` apart**, and the clear gap between the column *slots* is exactly `pair`;
- `centerX = L + maxCol + pair/2` is the middle of that gap, which is where the spine runs.

Each column slot is `maxCol` wide, and each node is centred in its slot. So with uniform widths the visible column gap is exactly `pair` = 100. When one leaf is wider, the narrower cells float in an over-wide slot and the visible gaps grow, e.g. 170 and 135 in the fixture below.

**`if (i & i % 2 - 1)` (:807).** By precedence this is `i & ((i % 2) − 1)`, which evaluates to 0, 0, 2, 0, 4, 0, 6, 0 for i = 0..7. It is truthy exactly for even i > 0, so even cells go left and odd cells go right (i = 0 is handled at :811). It reads like a bug but behaves as intended. A port can write `i % 2 === 0 ? left : right`; that version matched the library exactly on 2800 random trees.

**The `|offsetX| < 10` snap.**
- All-leaf groups: `offsetX` is exactly 0 (section 5.4), so the grid is centred under the parent and the spine is a straight vertical line.
- Mixed groups (leaves plus managers): the parent is centred over the whole top-level span of its children. The grid usually sits off-centre by much more than 10 px and stays there. In the fixture, mB's grid is 135 px left of mB.
- Symmetric mixed arrangements, e.g. `[A(a1), L1, L2, B(b1)]`, also give `offsetX = 0`, so they are centred too. This accounted for 69 of 70 mixed-group snaps in a uniform-size fuzz. A real sub-10 px nudge is rare.

### 5.6 Post-pass: y (:817-826)

```
rowMaxNoMargin[r] = max(sizeRow(c)) per row
cumSum = d3.cumsum(rowMaxNoMargin.map(e => e[1] + compactMarginBetween(e)))   // e is a [rowKey, size] ENTRY, not a node
row 0:  y = fch.y                      // = parent.y + parent.height + childrenMargin (flextree output)
row r:  y = fch.y + cumSum[r − 1]
```

Cells are aligned to the root-facing edge in their row: top-aligned in top, bottom-aligned in bottom, left-aligned in left, right-aligned in right. The row pitch is the tallest cell in the row plus 20.

**`compactMarginBetween` receives a `[rowKey, maxSize]` entry here (:818)**, but a node at :780 and :787. A node-dependent margin therefore makes the reserved height and the actual row placement disagree. Verified: `d => d.id ? 40 : 20` reserved 530 px of height (3 × (150 + 40) − 40) but placed rows 170 apart, because the `[rowKey, size]` entry has no `.id`. The grid therefore uses only 490 px and leaves 40 px of the reservation empty. With the opposite asymmetry (margin larger for the entry call than for the node call) the rows overflow the reserved block: in one pipeline experiment (node 20, entry 200), row 2 sat at y = 560 where the reservation assumed 380. `compactMarginPair` is also called with different arguments in different places (fch at :786, each child at :807-811, the link's child at :351/:352). With L1 → 100 and every other cell → 40, the columns become uneven (L1 at −175, L3/L5 at −160, L2/L4 at 160) and different cells' spines land at different x (L2's at −15, L1's at 0), so the shared spine breaks. Use constants.

### 5.7 Worked example: the fixture's mA (top layout, compact)

mA has 5 leaves. a3 is 320×190; a1, a2, a4 and a5 are 250×150. mA is at x = −767.5, y = 210 (card 250×150).

**Dimensions pass**
- even = a1, a3, a5 (left column); odd = a2, a4 (right column); rows 0, 0, 1, 1, 2.
- `maxCol = 320` (a3), so `D = 2·320 + 100 = 740`.
- rows with margin: row0 max(150, 150) + 20 = 170, row1 max(190, 150) + 20 = 210, row2 150 + 20 = 170. Sum 550, minus 20 = **530**.
- `a1.flexCompactDim = [740, 530]`; a2..a5 = `[0, 0]`.

**flextree.** a1's flex box is centred under mA, because mA is an all-leaf parent: `a1.x = −767.5` and `a1.y = 210 + 150 + 60 = 420`. The block spans x ∈ [−1137.5, −397.5].

**Positions pass**
- `L = −1137.5`.
- left column `x = L + 740/4 − 25 = −977.5` (= L + 320/2).
- right column `x = L + 3·740/4 + 25 = −557.5` (= L + 1.5·320 + 100).
- The column centres are 420 = 320 + 100 apart. `centerX = −767.5 = mA.x`, so `offsetX = 0`.
- `cumSum` of (row max + 20) = [170, 380, 550], so the row tops are 420, 590 and 800.

| node | x (centre) | y (top) | drawn box (L, T, R, B) |
|---|---|---|---|
| a1 | −977.5 | 420 | −1102.5, 420, −852.5, 570 |
| a2 | −557.5 | 420 | −682.5, 420, −432.5, 570 |
| a3 | −977.5 | 590 | −1137.5, 590, −817.5, 780 |
| a4 | −557.5 | 590 | −682.5, 590, −432.5, 740 |
| a5 | −977.5 | 800 | −1102.5, 800, −852.5, 950 |

Visible gaps: row0 a1|a2 = 170 and row1 a3|a4 = 135. These are larger than 100 because the 250-wide cells sit centred in 320-wide slots. The drawn extent of the grid is offset −17.5 from mA, purely because of a3; the flex block itself is exactly centred. From mA's bottom (360), the parent-to-cell gaps per row are 60, 230 and 440.

```
                              ┌──────── mA ────────┐  y 210..360, x −892.5..−642.5
                              └─────────┬──────────┘
                                        │ spine x = −767.5 (= mA.x; offsetX 0 → straight, r = 0)
   left slot [−1137.5,−817.5]   gap 100 │ [−817.5,−717.5]    right slot [−717.5,−397.5]
     ┌──── a1 250×150 ────┐             │             ┌──── a2 250×150 ────┐   row 0  y 420..570
     │                    ├─────────────┼─────────────┤                    │   stubs at y 495
     └────────────────────┘             │             └────────────────────┘
   ┌────── a3 320×190 ──────┐           │             ┌──── a4 250×150 ────┐   row 1  y 590..780 / 590..740
   │                        ├───────────┼─────────────┤                    │   stubs at y 685 / 665
   │                        │           │             └────────────────────┘
   └────────────────────────┘           │
     ┌──── a5 250×150 ────┐             │                                     row 2  y 800..950
     │                    ├─────────────┘                                     stub at y 875
     └────────────────────┘
   flex block of a1: x −1137.5..−397.5 (740), y 420..950 (530)
```

**A mixed group in the same fixture.** mB (360×200, x = 117.5) has children b1, b2 and the sub-manager bS.
- The b-grid is `[600, 150]`. b1 is at −192.5 and b2 at 157.5 (350 = 250 + 100 apart), and the block spans [−317.5, 282.5].
- bS (x = 417.5) has a flex box [282.5, 552.5] that touches the block, so the drawn gap b2|bS is **10**.
- mB is centred over [−317.5, 552.5], i.e. at 117.5, while the grid centre is −17.5. The offset is 135, so there is no snap and the spine meets the shared bus with a rounded elbow.

### 5.8 Margins and tight spots

- The block has **no siblingsMargin padding**, so the tightest clearance in compact charts is 10 px, between a grid and an adjacent non-leaf sibling (b2|bS above). The 10 px case needs the block to be no taller than the neighbour's flex box. With a taller grid (2+ rows at defaults: 320 > 210), the neighbour's children overlap the block in y and get cousin spacing. Example: `[L1, A(a1), L2, L3]` gives a visible gap of 90.
- The block's depth extent is the exact grid bottom, without the extra 60 px that a normal leaf's flex box has below it.

### 5.9 Leaf/non-leaf order

- The grid lands in the **first leaf's** flextree slot.
- Interleaved `(b1, bS, b2)` gives coordinates identical to `(b1, b2, bS)`: zero-size b2 lands at bS's right edge, `positionRoot` sees the same span, and b2 is then pulled back into the grid.
- Manager-first `(bS, b1, b2)` puts the grid to the **right** of bS (bS −100, b1 160, b2 510). It also changes the spread at root level: the mA|mB gap becomes 745 instead of 580.

### 5.10 Left/right: the grid is transposed

In left/right, `sizeColumn = height` and `sizeRow = width`. The grid's 2 "columns" become **two screen rows**, and its "rows" advance away from the parent along x.

Fixture left-true, mA's grid:
- a1 (620, −672.5) and a2 (620, −382.5): 290 = 190 + 100 apart, because a3's height of 190 is the max.
- The rows sit at x = 620, 890 and 1230. The pitch is the row's max width + 20, and the a3 row is 320 wide.
- The result is a band two cells tall that extends in the parent-to-child direction.

`right` mirrors `left` in x exactly, and `bottom` mirrors `top` in y exactly (0 mismatches over the fixtures).

### 5.11 Verified compact port (canonical frame)

The following matched the real library's x/y with **max error 0**. The tests were 200 random trees in the first study, then 400 + 400 + 1000 + 1000 in verification, covering all 4 orientations, uniform and random sizes, about 20% collapsed nodes, and 7888 compact groups (4352 mixed, 2034 odd-count).

```js
// canonical frame: breadth(n) = sizeColumn, depth(n) = sizeRow  ((w,h) for top/bottom, (h,w) for left/right)
function compactPrePass(root, { breadth, depth, pair = 100, between = 20 }) {
  root.eachBefore(n => { n.flexCompactDim = n.compactEven = n.firstCompactNode = null; });
  root.eachBefore(n => {
    if (!n.children || n.children.length < 2) return;
    const cc = n.children.filter(c => !c.children);            // drawn without children (collapsed managers count)
    if (cc.length < 2) return;
    cc.forEach((c, i) => { c.compactEven = i % 2 === 0; c.row = Math.floor(i / 2); c.firstCompactNode = cc[0]; });
    const colW = Math.max(...cc.map(breadth));
    const rowMax = new Map();
    cc.forEach(c => rowMax.set(c.row, Math.max(rowMax.get(c.row) ?? -Infinity, depth(c))));
    const gridH = [...rowMax.values()].reduce((s, h) => s + h + between, 0) - between;
    cc.forEach((c, i) => c.flexCompactDim = i === 0 ? [2 * colW + pair, gridH] : [0, 0]);
  });
}
// flextree nodeSize: n => n.flexCompactDim ?? [breadth(n) + siblingsMargin, depth(n) + childrenMargin]
function compactPostPass(root, { depth, pair = 100, between = 20 }) {
  root.eachBefore(n => {
    if (!n.children) return;
    const cc = n.children.filter(c => c.flexCompactDim);
    if (!cc.length) return;
    const f = cc[0], D = f.flexCompactDim[0], L = f.x - D / 2;
    const leftX = L + D / 4 - pair / 4, rightX = L + 3 * D / 4 + pair / 4, centerX = L + D / 2;
    cc.forEach((c, i) => c.x = i % 2 === 0 ? leftX : rightX);
    const off = n.x - centerX;
    if (Math.abs(off) < 10) cc.forEach(c => c.x += off);
    const rowMax = new Map();
    cc.forEach(c => rowMax.set(c.row, Math.max(rowMax.get(c.row) ?? -Infinity, depth(c))));
    const rowTop = []; let acc = 0;
    [...rowMax.keys()].sort((a, b) => a - b).forEach(r => { rowTop[r] = acc; acc += rowMax.get(r) + between; });
    const y0 = f.y;                                            // parent.y + parent depth size + childrenMargin
    cc.forEach(c => c.y = y0 + rowTop[c.row]);
  });
}
```

**Where `between` goes in the row height.** The two passes above both add `between` *after* the row max. That is faithful to the library only for a **constant** `compactMarginBetween`, which is the only setting that gives a consistent grid anyway (section 5.6). The library itself is asymmetric:
- for the reservation, it adds `between(cell)` per cell **inside** the row max (:780), then subtracts `between(firstCell)` once (:787), as in the section 5.3 pseudocode;
- for placement, it adds `between(entry)` **after** the row max, where `entry` is the `[rowKey, size]` pair (:818).

A port that has to reproduce a node-dependent margin bug-for-bug should copy those three call sites, arguments included. Otherwise use a constant, and the two forms are identical.

**Values of the compact fields.** The library's pre-pass (:759-764) resets `firstCompact`, `compactEven`, `flexCompactDim` and `firstCompactNode` to `null` on every node, but **not** `row`. With `compact(false)` the pre-pass never runs, so none of them is ever written.

| node | `compactEven` | `row` | `flexCompactDim` | `firstCompactNode` |
|---|---|---|---|---|
| grid cell, first (i = 0) | `true` | `0` | `[D, H]` (the whole block) | itself |
| grid cell, i > 0 | `i % 2 === 0` | `floor(i/2)` | `[0, 0]` | the first cell |
| outside any grid, compact on | `null` | `undefined`, unless an earlier layout on the **same** hierarchy objects set it | `null` | `null` |
| any node, compact off | `undefined` | `undefined` (same caveat) | `undefined` | `undefined` |

Because d3-org-chart rebuilds hierarchy objects on every `setLayouts`, a stale `row` survives only across toggle-path updates. The fixtures write every one of these "absent" values as `null` (run.cjs maps `undefined` to `null`), so a port should normalise with `?? null` before comparing.

**How the fixtures serialise these fields** (run.cjs:232-235):
- `compactEven` and `row` are stored as they are, with `undefined` mapped to `null`;
- `flexCompactDim` is the raw array (`[D, H]` on the first cell, `[0, 0]` on the others), or `null`;
- `firstCompactNode` is **not** a node: it is the first cell's data id as a string (e.g. `"a1"` for every cell of mA's grid), or `null`.

---

## 6. Orientations

All four layouts run the **same** flextree in the canonical frame: flex-x is the breadth centre and flex-y is the near (top) edge on the depth axis. The only differences are the size passed in and the swap applied afterwards (:856).

| | top | bottom | left | right |
|---|---|---|---|---|
| `nodeFlexSize` (non-compact) | `[w+sm, h+cm]` :370 | `[w+sm, h+cm]` :408 | `[h+sm, w+cm]` :333 | `[h+sm, w+cm]` :440 |
| `swap` | none :374 | `y = −y` :412 | `x ↔ y` :337 | `x = −y_flex, y = x_flex` :449 |
| node.x means | horizontal **centre** | horizontal **centre** | **left** edge | **right** edge |
| node.y means | **top** edge | **bottom** edge | vertical **centre** | vertical **centre** |
| children grow toward | +y | −y | +x | −x |
| `nodeUpdateTransform` (top-left of card) | `(x − w/2, y)` :375 | `(x − w/2, y − h)` :413 | `(x, y − h/2)` :338 | `(x − w, y − h/2)` :450 |
| bbox offsets `nodeLeftX, RightX, TopY, BottomY` | −w/2, w/2, 0, h :341-344 | −w/2, w/2, −h, 0 :379-382 | 0, w, −h/2, h/2 :304-307 | −w, 0, −h/2, h/2 :416-419 |
| `compactDimension` (sizeColumn, sizeRow) | (w, h) :353-357 | (w, h) :393-397 | (h, w) :323-327 | (h, w) :442-446 |
| compact "even" cell | left column | left column | upper row | upper row |
| edge generator | `diagonal` :373 | `diagonal` :411 | `hdiagonal` :336 | `hdiagonal` :448 |
| expand button (node-local) | `(w/2, h)` :362-363 | `(w/2, 0)` :400-401 | `(w, h/2)` :320-321 | `(0, h/2)` :428-429 |
| `centerTransform` (first draw) | `translate(W/2, 40)` :364 | `translate(W/2, H−40)` :402 | `translate(40, H/2)` :322 | `translate(W−40, H/2)` :434 |

Invariants (verified on every node of all 16 configurations of the pipeline experiment and all 10 fixtures):
- after the swap, (x, y) is the centre of the card's **root-facing edge**;
- `nodeUpdateTransform(n) = translate(x + nodeLeftX(n), y + nodeTopY(n))`;
- the rect/foreignObject sit at local `(0, 0, w, h)` (:1156-1159, :1286-1291);
- the root is at (0, 0) in every layout.

**How bottom and right are produced.** Bottom is top mirrored in y: same x values, y negated. Right is left mirrored in x. In both left and right the first child is at the top (smallest y); the swap does not reverse sibling order. `compactDimension.reverse` exists but is never used.

**A quirk of the bindings (deliberate, not a typo).** `nodeJoinY` for bottom is `y − h − h` (:384), and `nodeJoinX` for right is `x − w − w` (:420). Both place an entering card flush against the parent's outgoing edge.

`zoomTransform` exists in every binding but is never called. The top and bottom versions even contain a stray `}`: `'translate(400,0}) scale(1)'` (:372, :410).

---

## 7. Edges

### 7.1 Anchors (post-swap coordinates)

A tree link is drawn **for each child** `d` (the datum is the child, `links = descendants().slice(1)`, keyed by `nodeId(d.data)`, :855, :881-883). The path runs **child → parent**.

| | child anchor `linkX/Y` | parent anchor `linkParentX/Y` = `linkJoin(parent)` | compact stub start `linkCompactX/YStart` | compact spine top `compactLinkMidX/Y` |
|---|---|---|---|---|
| top | (x, y): top-centre :358-359 | (px, py + ph): bottom-centre :360-361 | (x ± w/2, y + h/2) :349-350 | (fch.x + D/4 + pair/4, fch.y) :351-352 |
| bottom | (x, y): bottom-centre :391-392 | (px, py − ph): top-centre :398-399 | (x ± w/2, y − h/2) :387-388 | (fch.x + D/4 + pair/4, fch.y) :389-390 |
| left | (x, y): left-middle :312-313 | (px + pw, py): right-middle :318-319 | (x + w/2, y ± h/2) :314-315 | (fch.x, fch.y + D/4 + pair/4) :316-317 |
| right | (x, y): right-middle :424-425 | (px − pw, py): left-middle :426-427 | (x − w/2, y ± h/2) :430-431 | (fch.x, fch.y + D/4 + pair/4) :432-433 |

- In the compact columns, `±` is `+` when `compactEven`. The stub therefore starts at the middle of the side facing the spine: the right edge of left-column cells in top/bottom, and the bottom edge of upper-row cells in left/right.
- After the post-pass, `fch.x + D/4 + pair/4` equals the block centre plus any snap offset, i.e. the spine.
- In left/right, `fch.x` post-swap is the near edge of row 0.

### 7.2 The vertical generator `diagonal(s, t, m, offsets = {sy:0})` (:225-262)

It is called as `diagonal(n, p, m, {sy: attrs.linkYOffset})` (:946):
- `n` = child anchor, or the spine top for compact cells;
- `p` = parent anchor;
- `m` = stub start, or `n` when not compact.

```js
function diagonal(s, t, m, { sy = 0 } = {}) {      // exact port of :225-262
  const x = s.x, ex = t.x, ey = t.y;
  const mx = (m && m.x != null) ? m.x : x;
  const my = (m && m.y != null) ? m.y : s.y;         // PRE-offset y
  const xr = (ex - x) < 0 ? -1 : 1;
  const yr = (ey - s.y) < 0 ? -1 : 1;                // direction taken BEFORE the offset
  const y = s.y + sy;                                // child end shifted +sy in screen y, every layout
  let r = Math.min(35, Math.abs(ex - x) / 2);
  r = Math.min(r, Math.abs(ey - y) / 2);
  const h = Math.abs(ey - y) / 2 - r;
  const w = Math.abs(ex - x) - 2 * r;                // FULL dx here
  const busY = y + (h + r) * yr;                     // = (y + ey)/2 when the signs agree
  return `M ${mx} ${my} L ${x} ${my} L ${x} ${y} L ${x} ${y + h * yr} ` +
         `C ${x} ${busY} ${x} ${busY} ${x + r * xr} ${busY} ` +
         `L ${x + (w + r) * xr} ${busY} ` +
         `C ${ex} ${busY} ${ex} ${busY} ${ex} ${ey - h * yr} ` +
         `L ${ex} ${ey}`;
}
```

It matched `lib.diagonal` **byte for byte** on 2000 random inputs.

Path structure:
1. `M m` → `L (x, my)`: the horizontal compact stub to the spine. It has zero length when not compact.
2. `L (x, y+sy)`: the vertical run to the offset child point.
3. A straight run to `r` short of the bus.
4. Corner 1: a cubic whose **two control points both sit on the corner vertex**. Its midpoint is at `vertex + (r/8, r/8)`, compared with 0.293r for a circular arc, so the corner is tighter than a quarter circle.
5. The horizontal bus.
6. Corner 2.
7. `L t`.

**What `linkYOffset = 30` does.** It is documented only as a Safari fix (:63):
- **top:** `busY = parentBottom + (cm + 30)/2`, which with cm = 60 is **parentBottom + 45 = childTop − 15**, not the gap midpoint (+30). `r = min(35, |dx|/2, 45)`. A non-compact path goes 30 px *into* the child card and comes back. With the default transparent node rect (`fill none`, :35, :1162) that segment is visible unless the node content is opaque.
- **bottom:** the +30 moves the child end *toward* the parent. `busY = parentTop − (cm − 30)/2` = parentTop − 15, and `r ≤ 15`. With `childrenMargin < 30` the bus lands inside the parent card and the corners reverse direction. The formula `busY = (s.y + 30 + t.y)/2` fails exactly when t.y lies between s.y and s.y + 30.
- **left/right:** ignored entirely (see `hdiagonal`).
- With `sy = 0` and the default cm = 60, `r = min(35, |dx|/2, 30) = min(30, |dx|/2)`. The corner is 30 px only when |dx| ≥ 60; children close to the parent's x get `r = |dx|/2`, and a child directly below gets a straight line. A full 35 px corner needs cm ≥ 70 (and |dx| ≥ 70).

**Clamping.**
- `|dx| < 70` with `|dy'| ≥ |dx|`: `r = |dx|/2` and `w = 0`, an S-bend with no straight bus.
- `dx = 0`: a straight vertical line.
- Small `dy'`: `r = |dy'|/2` and `h = 0`.

Example path (top, child at (−220, 160) under a parent whose bottom is at (0, 100)):

```
M -220 160 L -220 160 L -220 190 L -220 180 C -220 145 -220 145 -185 145 L -35 145 C 0 145 0 145 0 110 L 0 100
```

### 7.3 The horizontal generator `hdiagonal(s, t, m)` (:181-223)

It takes **no offsets**. The class wrapper passes them in, but the default function drops them.

```js
function hdiagonal(s, t, m) {                     // exact port of :181-223
  const x = s.x, y = s.y, ex = t.x, ey = t.y;
  const mx = (m && m.x != null) ? m.x : x, my = (m && m.y != null) ? m.y : y;
  const xr = (ex - x) < 0 ? -1 : 1, yr = (ey - y) < 0 ? -1 : 1;
  let r = Math.min(35, Math.abs(ex - x) / 2);
  r = Math.min(r, Math.abs(ey - y) / 2);
  const w = Math.abs(ex - x) / 2 - r;              // HALF dx here (h is computed in the source but unused)
  const busX = x + (w + r) * xr;                   // = (x + ex)/2, exact midpoint of the depth gap
  return `M ${mx} ${my} L ${mx} ${y} L ${x} ${y} L ${x + w * xr} ${y} ` +
         `C ${busX} ${y} ${busX} ${y} ${busX} ${y + r * yr} ` +
         `L ${busX} ${ey - r * yr} ` +
         `C ${busX} ${ey} ${busX} ${ey} ${ex - w * xr} ${ey} ` +
         `L ${ex} ${ey}`;
}
```

- The compact stub is **vertical first** (`M m → L (mx, y)`, then along the spine to `(x, y)`). `diagonal` does the stub horizontally.
- With cm = 60, `r = min(30, |dy|/2)` and `w = 30 − r`. Only when |dy| ≥ 60 do the curves start right at the child's edge with no straight horizontal run. For |dy| < 60, which is common (middle children, a single child, compact spines centred on the parent), there is a straight run of `30 − |dy|/2` at each end, and a straight line when dy = 0. Example: `hdiagonal({x:310,y:0}, {x:250,y:20}, …)` gives r = 10, w = 20: `M 310 0 L 310 0 L 310 0 L 290 0 C 280 0 280 0 280 10 L 280 10 C 280 20 280 20 270 20 L 250 20`.

Both generators always emit **exactly 24 numbers** in the fixed command sequence `M L L L C L C L`. That is what lets d3's string interpolation morph any link into any other.

### 7.4 Compact links

Top layout:
- the path runs from the stub start `(x ± w/2, y + h/2)` horizontally to the spine x;
- then up the spine (in the empty gap between the columns) to `fch.y + 30`;
- then into the normal elbow to the parent's bottom-centre.

Note that the vertical run goes from the stub to `fch.y + 30`; it never visits `fch.y` itself.
- When the grid is centred under the parent (all-leaf), the spine x equals the parent x, so `r = 0` and the path is one straight line. Example, 5 leaves under M at x = 0: `M -50 285 L 0 285 L 0 240 L 0 195 C 0 195 0 195 0 195 L 0 195 C 0 195 0 195 0 195 L 0 150`.
- When the grid is off-centre (mixed groups), the spine top joins the **same bus y** as the non-compact siblings, with a rounded elbow.
- Every compact cell's path redraws the shared spine from its own mid-height up to the parent. With opaque, uniform strokes the overlapping paths merge into one line. With translucent strokes the overlaps darken, and highlighting one cell (`_upToTheRootHighlighted` + `raise()`) highlights the whole spine above it.
- Short cards (half-height < 30) produce a small spur: the stub starts above `fch.y + 30`, so the path first goes *down*.
- Left/right: a vertical stub from the cell's top or bottom edge to the horizontal spine at the gap centre, then along the spine to `fch.x` (the near edge of row 0), then the `hdiagonal` elbow at the midpoint of the childrenMargin gap. Example: `M 435 -50 L 435 0 L 310 0 L 280 0 … L 250 0`.

### 7.5 Enter / update / exit

- **Enter** (:886-895): `diagonal(o, o, o)` with `o = linkJoin({x0, y0, width, height})` of the node passed to `update()`, i.e. the trigger's **old** position. `sy` is 0 here, so the path is degenerate: all 12 points coincide at o (the 24 numbers alternate between o.x and o.y).
- **Update** (:923-947): a 400 ms transition to `diagonal(n, p, m, {sy: 30})`. d3 interpolates the 24 numbers linearly, so intermediate frames are *not* true `diagonal()` outputs (the clamps get interpolated too).
- **Connections** (section 7.6) do not morph smoothly on enter: they enter as the 24-number `diagonal(o, o, null, {sy: 30})` (:974-979) and transition to an 8-number `linkHorizontal` path. `interpolateString` builds on the target's template and pairs it with only the first 8 of the 24 source numbers, so the first frame jumps.
- **Exit** (:950-960): a transition to `diagonal(o, o, null, {sy: 30})` with `o = linkJoin(x, y, …)`. `x` and `y` were destructured at :833, **before** the layout ran, so exits collapse to the trigger's **old** position. In vertical layouts the end shape is a 60 px sliver (`o.y − 15 .. o.y + 45`); in horizontal layouts it is a true point.
- **Style** (:901-920, :171-179):
  - stroke `#E4E2E9`, width 1, `fill none`;
  - `_upToTheRootHighlighted` links: `#E27396`, width 5, `raise()`d (but still under the nodes);
  - links whose child is a paging button: `display: none`.
- **Draw order:** `links-wrapper`, then `nodes-wrapper`, then `connections-wrapper` (:629-642). Links are under the nodes, connections over them.

### 7.6 Connections (non-tree links)

`attrs.connections = [{from, to, label}]` (:858-877, :963-1009).
- Each one is resolved against all hierarchy nodes and drawn only when **both ends are visible**.
- The path is `d3.linkHorizontal()` (:291) from `linkX/Y(source)` (the root-facing anchor) to `linkJoinX/Y(target)` (the outgoing anchor). That gives `M sx,sy C mx,sy mx,ty tx,ty` with `mx = (sx + tx)/2`.
- Style: pink `#E27396`, width 5, round caps, `pointer-events: none`, drawn **over** the nodes.
- Markers are built from a string in `defs` (:264-289):
  - the label marker's width comes from canvas `measureText`. Without a 2D context (some SSR/jsdom setups), any visible connection throws;
  - `markerUnits` defaults to `strokeWidth`, so marker geometry is ×5;
  - marker ids are `<from>_<to>` with no chart prefix;
  - orientation is chosen from raw `node.x` rather than path endpoints, which flips the label for same-depth connections in the **left** layout only;
  - the data join has no key (index-based); exit is an opacity fade.
- Connections never affect layout.

### 7.7 Expand/collapse button

- On every update, `g.node-button-g` is translated to `(buttonX, buttonY)` in node-local coordinates. Its 40×40 rect/foreignObject sit at `(−20, −20)`, so the button is **centred on the outgoing join point**, exactly where the child links end (:1092-1189).
- `display: none` when `_directSubordinates == 0`.
- opacity 1 only when the node has `children` or `_children` and is not a paging button.

### 7.8 Pseudocode for an xyflow custom edge

Build the path from the endpoints React Flow already passes to the edge (`sourceX/Y`, `targetX/Y` in `EdgeProps`), and keep only **relative offsets** in `edge.data`. React Flow's `EdgeWrapper` recomputes those endpoints from the store on every node update, so the edge follows tweened (`setNodes` per frame, section 10.6) or dragged nodes for free. An edge that reads absolute anchors from `data` stays frozen at the final layout while the nodes move.

This relies on **zero-size handles** placed as in section 10.5, so that the endpoints are exactly d3-org-chart's anchors:
- source = the parent's `linkParent` anchor (its outgoing edge centre);
- target = the child anchor `linkX/Y` for normal children, or, when the edge selects the compact cell's spine-facing side handle, the **stub start** `linkCompactX/YStart`.

```tsx
// Edge data produced by layout()/toFlow(): only relative values, so the path follows live node positions
type OrgEdgeData = {
  vertical: boolean;                              // top/bottom → diagonal, left/right → hdiagonal
  linkYOffset?: number;                           // 30 to match d3-org-chart; 0 for a symmetric bus
  spineFromTarget?: { dx: number; dy: number };   // compact only: spine top − stub start (section 10.5)
};

function OrgEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerStart, markerEnd }:
                 EdgeProps<Edge<OrgEdgeData>>) {
  const parent = { x: sourceX, y: sourceY };      // parent join (zero-size source handle)
  const tgt = { x: targetX, y: targetY };         // child anchor, or stub start for a compact cell
  const s = data?.spineFromTarget;                // `data` is optional in EdgeProps: use ?.
  const n = s ? { x: targetX + s.dx, y: targetY + s.dy } : tgt;    // spine top, or the child anchor
  const d = data?.vertical === false
    ? hdiagonal(n, parent, tgt)
    : diagonal(n, parent, tgt, { sy: data?.linkYOffset ?? 30 });
  return <BaseEdge id={id} path={d} style={style}
                   markerStart={markerStart} markerEnd={markerEnd} interactionWidth={0} />;
}
```

`EdgeProps<EdgeType extends Edge>` picks `id`, `data`, `style`, … from the edge type and adds `sourceX/Y`, `targetX/Y` and the marker ids; `data` is typed optional, hence the `?.`. `BaseEdgeProps` extends `SVGAttributes<SVGPathElement>` and requires `path`. (Checked against `@xyflow/react` 12.12.0 types.)

Notes:
- **Where React Flow puts the endpoints.** `getHandlePosition` returns the **outer edge** of the handle's bounding box on its `Position` side: Top → (x + w/2, y), Bottom → (x + w/2, y + h), Left → (x, y + h/2), Right → (x + w, y + h/2) of the handle box. The default handle is 6×6 px plus a 1 px border (8 px box), centred on the card border by `translate(-50%, -50%)`, so default endpoints land **4 px outside the card** (experiment: a child whose top is at y = 210 gave targetY = 206 with the default handle and 210 with a zero-size one). Invisible handles (`opacity: 0`, `visibility: hidden`) keep their box and do **not** remove the offset. Only a zero-size handle puts the point on the border. The base CSS sets `min-width/min-height: 5px`, so override all of it: `style={{ width: 0, height: 0, minWidth: 0, minHeight: 0, border: 0 }}`. Never use `display: none`; the handle must stay measurable.
- **Direction.** Edges are naturally `source = parent`, `target = child`, but the ported path runs child → parent, like d3-org-chart's. React Flow's `markerEnd` would therefore render at the **parent**. d3-org-chart uses no markers or dash animation on tree links, so this only matters if you add them; then reverse the path or swap the marker props.
- `interactionWidth={0}` removes the invisible 20 px hit path that `BaseEdge` adds per edge by default. An org chart rarely needs clickable links, and d3-org-chart's connections are `pointer-events: none`.

---

## 8. State and interaction that affect layout

### 8.1 Pure layout vs rendering

| affects the layout (positions) | rendering only |
|---|---|
| data structure (ids, parentIds, child **order**) | node / button / paging-button HTML |
| visible set: `_expanded` flags, `initialExpandLevel` (incl. sticky 0), paging (`_pagingStep`), reveal flags (`_centered`, `_highlighted`, `_upToTheRootHighlighted`, only via the paging reveal) | link shapes (`diagonal`/`hdiagonal`, `linkYOffset`, spine/stub) |
| node sizes (`nodeWidth/nodeHeight`) and margins | highlight strokes, `linkUpdate`/`nodeUpdate` |
| `compact` flag | enter/exit animation origins, durations |
| `layout` orientation | connections, markers |
| | zoom, pan, `fit`, centering, `centerTransform` |

### 8.2 The expand/collapse model

State lives on the **user's data objects** (`attrs.data`), which stratify does not copy. The flags are `_expanded, _centered, _centeredWithDescendants, _highlighted, _upToTheRootHighlighted, _pagingStep, _pagingButton, _directSubordinates, _directSubordinatesPaging, _totalSubordinates, _filteredOut`. Hierarchy nodes are rebuilt on every `setLayouts`. Expansion is structural: `children` holds the visible children and `_children` the collapsed ones.

- **`data._expanded` means "this node must be visible", not "show my children".** `expandSomeNodes` (:1365-1390) walks every node. For each flagged node it climbs `parent` and re-opens `_children` until it reaches an already-open ancestor. The flagged node becomes visible together with all its siblings, but its own children stay collapsed unless one of them is flagged. Example: `setExpanded(4)` shows 4 and its sibling 5, but not 4's child 6.
- **`setLayouts`** (:1403-1509), step by step:
  1. full stratify;
  2. `initialExpandLevel L > 1`: flag every node with depth ≤ L, then reset the attr to 1. It is **one-shot**, and it runs on the full tree before paging, so it **defeats paging** at depth ≤ L;
  3. paging pre-pass;
  4. filtered stratify;
  5. size snapshot;
  6. counts;
  7. collapse every child of the root recursively, plus the root itself if `L == 0` (a value that is **never reset**; `collapseAll()` sets it permanently);
  8. `expandSomeNodes(root)`.

  The `expandNodesFirst` branch (:1493-1496) is dead code. The visible tree is a pure function of the data, the flags, `_pagingStep` and `L == 0`.
- **`onButtonClick(d)`** (:1305-1341) is the toggle path:
  - returns if `d` is a paging button;
  - if `setActiveNodeCentered` (default true), sets `_centered` and `_centeredWithDescendants`;
  - **collapse**: `_children = children; children = null`, and clears `_expanded` on **d itself** and all its descendants;
  - **expand**: `children = _children`, and flags each direct child `_expanded`;
  - then `update(d)`, with no re-stratify.
- **The toggle path and the rebuild path disagree.**
  - A click keeps a collapsed subtree's inner `children`/`_children`, so re-expanding restores the grandchildren. The next rebuild (`render`, `addNode`, paging load) uses the flags the collapse cleared and forgets them.
  - On the next rebuild, a collapsed node n **vanishes** iff its parent is not the root (or L == 0) **and** no `_expanded` flag remains anywhere in the parent's subtree outside n's subtree.
- **`setExpanded(id, false)`** clears `_expanded` on id and on every other descendant of id's parent. After a render, every sibling subtree collapses. id and its siblings disappear only if their parent is not the root. Called on the root, it does nothing. `setExpanded` searches `allNodes`, so paged-out ids are "not found".
- **`setCentered`, `setHighlighted` and `setUpToTheRootHighlighted`** (:1619-1668) set `_expanded` on the node **and all its ancestors**, and those flags are permanent: `clearHighlighting()` followed by `render()` keeps the revealed and expanded nodes visible, including nodes beyond the paging page. These setters do not re-render; chain `.render()`.
- **`expandAll()`** flags every row and renders. That also defeats paging. **`collapseAll()`** clears the flags and sets `initialExpandLevel(0)` permanently.

### 8.3 Paging

Configuration: `minPagingVisibleNodes(node)` (default 2000, so effectively off) and `pagingStep(node)` (default 5).
- Each parent gets `data._pagingStep = P` the first time it is seen, with **`P = minPagingVisibleNodes(parent)`** (:1425-1430). Despite its name, `minPagingVisibleNodes` is therefore the number of children shown under each parent before the button, not a total visible-node threshold. P persists on the data and is re-initialised only when falsy, i.e. on every rebuild while it is 0. So `minPagingVisibleNodes = 0` makes `children[0]` the paging button and shows no real child (visible: parent `0` and button `1[PB]` only).
- With N data children and N > P + 1:
  - `children[0..P−1]` render normally;
  - `children[P]`, **a real data node**, gets `_pagingButton = true`. It has a normal card footprint, a hidden incoming link and an invisible expand button, and in compact mode it takes a grid cell. It also keeps its own (collapsed) subtree: if one of its children carries `_expanded`, that child is drawn hanging under the "show more" pill;
  - `children[P+1..]` and their subtrees are **removed from the data** before the second stratify (:1467-1470), so they take no space.
- With N == P + 1 there is no button.
- Clicking the pill calls `loadPagingNodes`, which sets `_pagingStep += pagingStep(parent)` and does a full rebuild (:1587-1595). Example: P goes 3 → 8 → 13.
- **The filter uses raw `d.id`, not the `nodeId` accessor** (:1470). With custom id fields, including the library's own documented `nodeId/parentNodeId` field names, paging silently hides nothing, although the button flag is still set.
- **Reveal walk** (:1448-1461): a hidden child carrying `_expanded`, `_centered`, `_highlighted` or `_upToTheRootHighlighted` un-hides itself and its hidden ancestors.
  - A flagged node beyond the page appears **alone, after the button** (e.g. `…,4[PB],8`).
  - If the walk passes the button node, every sibling is un-hidden and permanently flagged `_expanded`, while `_pagingStep` stays unchanged. This also happens via `setCentered`/`setHighlighted` on any descendant of the button node.
  - The walk is order-dependent for deep nodes.

### 8.4 What triggers a relayout

| trigger | path | `update()` source → animation origin |
|---|---|---|
| `render()` (incl. `expandAll`, `collapseAll`, and flag setters followed by `.render()`) | rebuild | root, with `x0 = y0 = 0` |
| `addNode`, `removeNode`, `loadPagingNodes` → `updateNodesState()` | rebuild | root (new nodes fly in from under the **root**, not from their manager) |
| expand button click → `onButtonClick` | toggle | the clicked node's previous position |
| `clearHighlighting()` | `update(root)`, no rebuild | root |
| window resize | **none**: only the svg `width` attribute changes, and `attrs.svgWidth` goes stale until the next `render()` (:672-675) | — |

Every `update` recomputes the full layout from scratch. Only the root is fixed, at (0,0).

### 8.5 Animation origins (`x0`/`y0`)

- After every update, `d.x0 = d.x; d.y0 = d.y` in **post-swap** coordinates (:1230-1233). `setLayouts` builds fresh nodes with `root.x0 = root.y0 = 0` (:1480-1481).
- **Entering nodes** start at `nodeJoin({x: x0, y: y0, width, height})` of the **trigger** (:1018-1027). In top this is `(x0 − w/2, y0 + h)`, computed with the **trigger's** width and height. The root enters at a raw `translate(x0, y0)` without the join offset (:1023), so on the first render it slides from (0, 0) to its `nodeUpdateTransform`: by (−w/2, 0) in top, (−w/2, −h) in bottom, (0, −h/2) in left and (−w, −h/2) in right. Only in top is it a pure horizontal slide (:338, :375, :413, :450).
- **Exiting nodes** all fly to `nodeJoin(maxDepthNode.parent)` (:1212-1223). Despite the name, `maxDepthNode` is the **shallowest** exiting node; on ties the reduce keeps the last one. On the toggle path its parent has its **new** coordinates. On the rebuild path the bound data are stale hierarchy objects, so it has its **old** coordinates.
- **Links** enter from and exit to the trigger's **old** join point (section 7.5). When the clicked node moves, the nodes and links visibly diverge during the transition.

### 8.6 Centering and fit

- **First draw:** `g.center-group` gets `centerTransform` (section 6), and the d3-zoom transform on `g.chart` starts as identity. This runs only on `firstDraw`, so switching the layout later keeps the old offset until `fit()` is called.
- **`fit({animate = true, nodes = visible, scale = true})`** (:1566-1584, :1549-1564):
  - bbox from `x + nodeLeftX … x + nodeRightX` and `y + nodeTopY … y + nodeBottomY`, padded by **50** layout units on each side;
  - `k = scale ? min(8, 0.9 / max(bw/W, bh/H)) : lastTransform.k`;
  - `T = translate(W/2, H/2) · scale(k) · translate(−cx, −cy)` is applied through `zoomBehavior.transform` while `centerG` animates to `translate(0, 0)`;
  - `k` is **not** clamped to `scaleExtent` (only zoomIn/zoomOut are clamped).
- **Auto-centre after an update** (:1235-1262): the first node in `allNodes` with `data._centered` is framed with `scale: false` (the zoom is kept). The framed set is:
  - the node alone, without `_centeredWithDescendants`;
  - in compact mode, the first 7 BFS descendants (the node included);
  - in non-compact mode, the middle 2–3 entries of the BFS `descendants()` array. For array lengths 1, 2, 3, 4, 5 that is {0}, {0,1}, {1,2}, {1,2,3}, {2,3}, so the clicked node itself is excluded once there are 3 or more entries.
  - A stale `_centered` on a collapsed, never-laid-out node produces `translate(NaN, NaN)`.
- **`initialZoom(k)`** only sets the first-draw scale of `centerG`. d3-zoom's own k starts at 1, so the first fit or centre after a user zoom makes the scale jump.

---

## 9. Quirks, bugs and limitations (consolidated, verified)

**Layout geometry**
1. Per-node sizes are supported, but rows are not depth-aligned when parent sizes differ (section 4.4).
2. The size snapshot (`d.width/height`, :1472-1477) diverges from the live accessor calls inside flextree (:578-579) when sizes depend on state. That produces overlaps, e.g. −80 px. Button clicks never refresh the snapshot.
3. `nodeWidth/nodeHeight` see `d.height` as the hierarchy height in `setLayouts` but as the pixel height inside flextree. `d.parent.height` is already in pixels during `setLayouts`, because `root.each` is breadth-first.
4. Sibling gaps are *at least* siblingsMargin. Adjacent siblings at depth 1 can be far apart because of their subtrees' contours (fixture top-false: mA|mB = 890, mB|mC = 315).
5. `neighbourMargin` also applies vertically across depths: a tall node next to a neighbour's child gets the full 80 extra, which can push whole subtrees apart.
6. flextree calls `nodeSize` roughly 5–13 times per node with no cache, so expensive accessors multiply the cost.

**Compact**

7. The grid block has no siblingsMargin and no childrenMargin padding. The result is 10 px clearance to an adjacent manager versus 20 between normal siblings, and 80 rather than 100 between cousin blocks.
8. Both columns get the width of the widest cell, so narrow cells float in over-wide slots and get longer stubs.
9. In mixed groups the grid sits in the first leaf's slot and is usually off-centre from the parent. The `|offsetX| < 10` snap is a magic threshold.
10. `compactMarginBetween` gets `[rowKey, size]` at :818 but a node at :780 and :787. `compactMarginPair` is called with different nodes at :786, :807-811 and :351. Only constant margins are consistent.
11. `if (i & i % 2 - 1)` is obfuscated but correct.
12. Collapsed managers and paging buttons are packed into grids. Expanding a node reflows the grid non-locally.
13. Two leaves make the row *wider* (600 vs 520).
14. `row` is not reset (harmless). The parent's `flexCompactDim = null` (:793) is redundant. `compactDimension.reverse` and `compactViewIndex` are dead code.

**Edges**

15. `linkYOffset = 30` makes the top and bottom layouts asymmetric. In top, the bus sits 15 px above the child and the path dips 30 px into the child card. In bottom, the bus sits 15 px from the parent (15 px above its top edge on screen, on the child side) with r ≤ 15; with cm < 30 it lands inside the parent. In left/right the offset is ignored.
16. `yrvs` is computed before the offset (:236 vs :238).
17. `w` uses the full dx in `diagonal` (:247) but dx/2 in `hdiagonal` (:206), and `hdiagonal` computes an unused `h`.
18. Enter paths use `sy = 0` while update and exit use `sy = 30`. The vertical exit shape is a 60 px sliver.
19. On the toggle (click) path, exiting links go to the trigger's old position, while exiting nodes go to the parent's new position. On the rebuild path, exiting nodes also use old coordinates, because their bound data come from the previous stratify (section 8.5).
20. Mid-transition link frames are interpolated strings, not real elbows.
21. Connection markers: no id prefix, orientation from raw node.x (wrong in the left layout), ×5 scale from `markerUnits`, canvas required.
22. Links to paging buttons get `display: none`; all others get the invalid value `'auto'`.
23. A custom `chart.diagonal(fn)` receives `offsets === undefined` on enter, so a default parameter value is needed. Such overrides do take effect: `layoutBindings` bound the prototype forwarder at construction, and the forwarder reads the current `diagonal`/`hdiagonal` attribute from the chart state on every call (:1272-1281).

**State / API**

24. `_expanded` means "visible". The doc comments omit `.data` (:98-100) and name `hierarchyHeight` instead of `_hierarchyHeight` (:88).
25. The toggle and rebuild paths disagree, and collapsed nodes can vanish on the next rebuild (section 8.2).
26. `setExpanded(id, false)` collapses every sibling subtree.
27. `initialExpandLevel > 1` and `expandAll` defeat paging. `initialExpandLevel 0` is sticky. `minPagingVisibleNodes` changes after the first render are ignored, because `_pagingStep` persists.
28. The paging filter uses raw `d.id` (:1470).
29. The paging reveal shows a lone node after the button and is order-dependent.
30. The default accessors `d.nodeId || d.id` treat id 0 as missing.
31. `addNode` never checks `parentFound`. A missing parent corrupts `attrs.data`, and every later render throws `missing: X`. An object with no parentId throws before the push (the data stays intact), while a self-parented object is pushed and then stratify throws `cycle`, corrupting the data. Nodes added under a collapsed or leaf parent stay hidden; a node added under a parent that was expanded by a click **is** visible after the rebuild.
32. `removeNode` leaves `_filteredOut = true` forever, so a re-added object is dropped by the next unrelated `removeNode`.
33. Before the first `render()`, `setCentered`, `setHighlighted`, `setUpToTheRootHighlighted`, `addNode` (non-empty) and `removeNode` throw (`generateRoot` is null). `setExpanded`, `collapseAll` and `clearHighlighting` also throw (`allNodes` is undefined). `expandAll` is safe.
34. `expandSomeNodes` can traverse the same children twice, which is quadratic in the depth of flagged paths.
35. A stale `_centered` steals centering, or yields NaN for a node that was never laid out.
36. Keyboard asymmetry: Enter/Space on a node toggles expansion, while a mouse click on the body only calls `onNodeClick`.

**Viewport**

37. `centerTransform` is applied only on the first draw. After any `fit()`, the offset moves into the zoom transform and `centerG` becomes the identity.
38. `fit` ignores `scaleExtent` and caps k at 8. `scaleExtent` is read only once, at the first draw.
39. Window resize does not update `attrs.svgWidth`.
40. `svgHeight` defaults to `window.innerHeight − 100`, read once in the constructor.

**Packaging**

41. `require('d3-org-chart')` resolves through `exports.default` to the ESM `src/d3-org-chart.js`. Under Node ≥ 22.12 (or 20.19+), `require(esm)` loads it and its bare `'d3-flextree'` import resolves through `main` to the UMD build, so it works (verified: a harness variant using it regenerated top-true with 0 difference). The UMD build `build/d3-org-chart.js` also works. Only a deep import of d3-flextree's `module` entry (`d3-flextree/index.js`) fails, because its internal imports have no file extensions (section 3.6). The source never imports `d3-transition`; `.transition()` works only because `d3-zoom` imports it as a side effect.

---

## 10. Porting to xyflow (React Flow)

The React Flow statements below were checked against the docs and the published source of **`@xyflow/react` 12.12.0** and **`@xyflow/system` 0.0.83** (npm latest on 2026-10-04), plus a store-level experiment that adopts nodes and computes edge positions. They were not exercised in a rendered app, and line numbers will drift between versions, so pin `@xyflow/react@^12.12` or re-check after upgrading. Where a behaviour is plausible but not guaranteed by the source, the text says so. React Flow's own layouting guide recommends d3-flextree for nodes of different sizes (https://reactflow.dev/learn/layouting/layouting), and the v12 migration notes say layout code must read `node.measured`, not `node.width/height` (https://reactflow.dev/learn/troubleshooting/migrate-to-v12).

### 10.1 Architecture

```
            ┌──────────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐
 rows +     │ buildVisibleRows()   │   │ layout(rows, sizes,   │   │ toFlow(result)        │
 UI state ─▶│ (pure)               │──▶│        opts) (pure)   │──▶│ nodes[] + edges[]     │──▶ <ReactFlow/>
 (expanded, │ paging, filter to    │   │ stratify → compact pre│   │ positions, edge.data  │
  paging)   │ visible rows         │   │ → flextree → compact  │   │ (relative offsets)    │
            └──────────────────────┘   │ post → swap           │   └──────────────────────┘
                                       └───────────────────────┘
                                             ▲ sizes: Map<id,{w,h}> (fixed or measured)
```

- **Keep the state outside the data:**
  - `expandedParents: Set<id>`, or a per-node `visible` flag if you want d3-org-chart's exact semantics;
  - `pagingStep: Map<parentId, number>`;
  - optional reveal flags;
  - `rootCollapsed`.

  Derive the visible tree on every change. This avoids d3-org-chart's in-place mutation and stale flags. `expandedParents` (children shown iff the parent is in the set) is simpler, and it never makes a just-collapsed node vanish.
- **Pass only visible nodes to the layout, and omit the rest from React Flow too.** Collapsed and paged-out nodes must not appear in `children`, otherwise they reserve space. React Flow does not render `hidden: true` nodes (`NodeWrapper` returns null), and `fitView` and `useNodesInitialized` skip them by default, but hidden nodes are never measured, and v12.12 has no explicit rule that hides the **edges** attached to a hidden node (`EdgeWrapper` checks only `edge.hidden` and whether both ends have handle bounds; the edges probably disappear once a later `updateNodeInternals` pass clears the hidden node's handle bounds, but nothing guarantees it). If you use `hidden`, also set `hidden: true` on every incident edge. Omitting collapsed and paged-out nodes and their edges is simpler and avoids unmeasured ghosts; React Flow's own expand/collapse example (Pro) also derives the visible subset.
- **Use string ids.** d3-hierarchy coerces ids to strings. Do not copy the `||`-based accessors, so that 0 stays a valid id.

### 10.2 `layout(visibleRows, sizes, opts)`

You can use `d3-flextree` and `d3-hierarchy` directly. flextree is about 350 lines with no DOM dependency, and its output was shown to match d3-org-chart exactly with the configuration below. `flextree({nodeSize}).spacing(sp)(root)` is equivalent to `flextreeLayout(root, nodeSize, sp)` from section 3.4: both write `x` (breadth centre) and `y` (depth top) onto the hierarchy nodes, and `sp` receives the (left, right) hierarchy nodes. Either one can be used.

```ts
import { stratify, type HierarchyNode } from 'd3-hierarchy';
import { flextree } from 'd3-flextree';

type Orientation = 'top' | 'bottom' | 'left' | 'right';
type Opts = { orientation: Orientation; compact: boolean;
  siblingsMargin: number; childrenMargin: number; neighbourMargin: number;
  compactMarginPair: number; compactMarginBetween: number; };
type Pt = { x: number; y: number };
type NodeOut = { anchor: Pt; topLeft: Pt; w: number; h: number;
  // compact cells only; colWidth = maxCol (breadth units), rowTop = depth offset of this cell's row from row 0
  compact?: { even: boolean; row: number; colWidth: number; rowTop: number } };

export function layout(rows: {id: string; parentId: string | null}[],   // the VISIBLE rows only
                       sizes: Map<string, {w: number; h: number}>, o: Opts) {
  const root = stratify<any>().id(d => d.id).parentId(d => d.parentId)(rows);
  const horiz = o.orientation === 'left' || o.orientation === 'right';
  const S = (n: any) => sizes.get(n.id)!;
  const breadth = (n: any) => horiz ? S(n).h : S(n).w;      // = compactDimension.sizeColumn
  const depth   = (n: any) => horiz ? S(n).w : S(n).h;      // = compactDimension.sizeRow

  if (o.compact) compactPrePass(root, { breadth, depth, pair: o.compactMarginPair, between: o.compactMarginBetween });
  flextree({
    nodeSize: (n: any) => n.flexCompactDim ?? [breadth(n) + o.siblingsMargin, depth(n) + o.childrenMargin],
  }).spacing((a: any, b: any) => a.parent === b.parent ? 0 : o.neighbourMargin)(root);
  if (o.compact) compactPostPass(root, { depth, pair: o.compactMarginPair, between: o.compactMarginBetween });

  const out = new Map<string, NodeOut>();
  root.each((n: any) => {                                    // descendants() order = breadth-first
    const { w, h } = S(n);
    let x = n.x, y = n.y;                                    // canonical: x = breadth centre, y = depth top
    switch (o.orientation) {                                 // d3-org-chart swap
      case 'bottom': y = -y; break;
      case 'left':   [x, y] = [y, x]; break;
      case 'right':  [x, y] = [-y, x]; break;
    }
    const topLeft = o.orientation === 'top'    ? { x: x - w / 2, y }
                  : o.orientation === 'bottom' ? { x: x - w / 2, y: y - h }
                  : o.orientation === 'left'   ? { x, y: y - h / 2 }
                  :                              { x: x - w, y: y - h / 2 };
    const f = n.flexCompactDim ? n.firstCompactNode : null;  // canonical-frame values, read before any swap
    out.set(n.id, { anchor: { x, y }, topLeft, w, h,
      compact: f ? { even: n.compactEven, row: n.row,
                     colWidth: (f.flexCompactDim[0] - o.compactMarginPair) / 2, rowTop: n.y - f.y } : undefined });
  });
  return { root, nodes: out };       // edges: see 7.1 / 7.8 / 10.5 (compute anchors from `out`)
}
```

`compactPrePass` and `compactPostPass` are the verified functions from section 5.11, written in the canonical frame. Because sizes come from a `Map`, the repeated `nodeSize` calls cost a map lookup each. Feed the **same** sizes to the layout and to rendering, which avoids d3-org-chart's snapshot mismatch.

**Output order.** Per-node output here, d3-org-chart's own `nodes` array and the fixtures' `nodes[]` are all in `root.descendants()` order, which is breadth-first. Compare outputs **by id**, not by index.

**Edge geometry** (from `out`, per section 7.1). For each non-root visible node `c` with parent `p`:
- `parent = linkJoin(p)`: top `(p.x, p.y + p.h)`, bottom `(p.x, p.y − p.h)`, left `(p.x + p.w, p.y)`, right `(p.x − p.w, p.y)`, all in post-swap anchor coordinates;
- `child = c.anchor`;
- if `c` is compact, the stub start and the spine offset come from section 10.5. In the canonical frame the spine is at the block centre (+ snap), and the spine top is at row 0's near edge.

### 10.3 Coordinates: d3-org-chart → React Flow

- d3-org-chart's post-swap `(x, y)` live in `g.center-group` space. That is a plain 2-D space with the root at (0, 0), exactly like React Flow's flow coordinates.
- React Flow's `node.position` is the node's **top-left** with the default `nodeOrigin = [0, 0]`. Use `topLeft` above: it is exactly d3-org-chart's `nodeUpdateTransform`. **This is the recommended route.**
- Anchor-based positions also work: React Flow computes `internals.positionAbsolute = position − origin·dims`, and both edges (`getHandlePosition`) and `fitView` read `positionAbsolute`, so they stay consistent. The origins are top `[0.5, 0]`, bottom `[0.5, 1]`, left `[0, 0.5]`, right `[1, 0.5]`. Two caveats:
  - the origin offset uses `measured ?? width ?? initialWidth ?? 0`, so it is 0 until the size is known. Set `node.width/height` so the first frame is right;
  - when switching orientation at runtime, the `<ReactFlow>` props are applied with `nodes` **before** `nodeOrigin`, so the new nodes are adopted with the **old** origin, and positions are recomputed only on a later adopt or measurement (which may never come if `measured` is preserved). Cards can be left offset. Use the per-node `origin` field (`Node.origin`, v12) in `toFlow` instead of the global prop, so the origin always travels with the node object being adopted.
- The tree extends into negative coordinates, which is fine for React Flow.

### 10.4 Sizes: fixed or measured (two-pass)

d3-org-chart lays out with the **configured** `nodeWidth/nodeHeight`, never with measured DOM. In React Flow you can either:
1. **Use fixed sizes** (simplest; this reproduces d3-org-chart). Set `node.width`/`node.height` to the layout size: React Flow applies them as inline dimensions, so `measured` equals the layout size and the node is visible on the first paint. Render the card content to fit.
2. **Measure, then lay out:**
   - render the nodes once. React Flow renders unmeasured nodes with `visibility: hidden`, but only until they are measured; they then become visible at their stale positions before your layout effect runs, so keep your own `laidOut` flag and hide the cards until the first layout;
   - wait until React Flow has measured them. `useNodesInitialized()` turns true once every non-hidden node has dimensions and handle bounds. It returns false for an empty flow, ignores hidden nodes by default, and flips false → true whenever nodes are added, which is what drives a re-layout on expand;
   - read sizes from `getInternalNode(id)?.measured` or `useStore(s => s.nodeLookup)`. In a controlled flow, `measured` appears on **your** node objects only if you apply the `'dimensions'` changes through `onNodesChange`/`applyNodeChanges`; `getNodes()` returns your objects as given;
   - run `layout` and `setNodes` with the positions (merging into the previous objects, see 10.6);
   - re-run when a measured size changes, guarding against loops: compare with the previous sizes, using a tolerance.

   Newly revealed (expanded) children cannot be pre-measured with `hidden: true`, because hidden nodes are never observed. Render them invisibly instead (e.g. `opacity: 0` at the parent's join point), let them be measured, then lay out.

   Measured sizes make every row's y depend on its parent's actual height (section 4.4). If you want aligned rows, normalise the depth size per depth.

### 10.5 Handles and edges

Per orientation, matching `linkParent` and `linkX/Y`:

| layout | parent (source) handle | child (target) handle | compact cell target handle (even / odd) | generator |
|---|---|---|---|---|
| top | `s-bottom` | `t-top` | `t-right` / `t-left` | `diagonal` |
| bottom | `s-top` | `t-bottom` | `t-right` / `t-left` | `diagonal` |
| left | `s-right` | `t-left` | `t-bottom` / `t-top` (upper / lower row) | `hdiagonal` |
| right | `s-left` | `t-right` | `t-bottom` / `t-top` (upper / lower row) | `hdiagonal` |

- **A handle on each end is required.** `getEdgePosition` returns null (and `onError` reports error 008) unless the source node has a measured source `<Handle>` and the target node a target `<Handle>` (or `node.handles`) in the default strict connection mode.
- **Render a stable handle set and select handles per edge.** Give every handle a unique id and render the same set on every card: targets `t-top/t-right/t-bottom/t-left`, sources `s-top/s-right/s-bottom/s-left`, all zero-size (section 7.8) and `isConnectable={false}`. Pick them with `edge.sourceHandle`/`edge.targetHandle` as in the table. Without `targetHandle`, React Flow uses the **first** target handle in the node's bounds, so a compact edge would attach to the top handle (experiment: no `targetHandle` → t-top; `'t-right'` → the right mid-point; an unknown id → error 008 and no edge). A stable set matters because a node's role changes (leaf ↔ manager, even ↔ odd, orientation). If the rendered handles do change, call `useUpdateNodeInternals`; React Flow does it for you only when `node.sourcePosition`/`targetPosition` change.
- **With zero-size handles at these positions the `EdgeProps` endpoints equal d3-org-chart's anchors exactly:** source = `linkParent`, target = `linkX/Y`, or `linkCompactX/YStart` for the compact side handle. Non-compact edges are then pure functions of `(sourceX, sourceY, targetX, targetY)` and still reproduce d3-org-chart's bus: in top, `busY = (targetY + 30 + sourceY)/2`.
- **Compact edges** are `diagonal(stub + offset, parentJoin, stub, {sy})` (or `hdiagonal(stub + offset, parentJoin, stub)`), as in d3-org-chart :946, with `stub = (targetX, targetY)` from the side handle. Store the offset from the stub start to the spine top in `edge.data.spineFromTarget`. With `maxCol = compact.colWidth`, `pair = compactMarginPair` and `rowTop = compact.rowTop` from 10.2 (cell size w × h):
  - top: `dx = ±(maxCol/2 + pair/2 − w/2)` (+ for even, left-column cells), `dy = −(rowTop + h/2)`;
  - bottom: same `dx`, `dy = +(rowTop + h/2)`;
  - left: `dy = ±(maxCol/2 + pair/2 − h/2)` (+ for even, upper-row cells), `dx = −(rowTop + w/2)`;
  - right: same `dy`, `dx = +(rowTop + w/2)`.

  These follow from the stub at (x ± w/2, y + h/2) and the spine top at (fch.x + D/4 + pair/4, fch.y) in section 7.1, with column centres at ±(maxCol/2 + pair/2) from the spine (section 5.5).
- **Do not rely on `getSmoothStepPath` for an exact match.** It does accept `centerY` (and `stepPosition`), so with `centerY = busY` and `borderRadius: 35` it is a close approximation for non-compact links. But its corners are quadratic `Q` curves with the control point on the vertex (default `borderRadius` 5, `offset` 20), whose midpoint sits r/4 from the vertex, against r/8 for d3-org-chart's cubic-on-vertex corners, and it cannot draw the compact stub and spine. Port `diagonal`/`hdiagonal` (section 7) into a custom edge that renders `<BaseEdge path=…>` (section 7.8).
- **Stacking.** Each edge is its own `<svg style={{zIndex}}>` in the viewport's stacking context, and nodes carry an inline zIndex: 0, or 1000 when selected, because `elevateNodesOnSelect` defaults to true. Edges with zIndex ≥ 1 draw over unselected nodes but under a selected one unless their zIndex > 1000 or `elevateNodesOnSelect={false}`. Give cross-link ("connection") edges such a zIndex so they draw over nodes, as d3-org-chart's do. Do **not** use zIndex to emulate d3-org-chart's `raise()` of highlighted tree links, because any zIndex > 0 lifts them over the cards; move highlighted edges to the end of the `edges` array instead, since later edges paint later.
- Sibling edges overlap exactly on the bus and spine. Use opaque strokes, or draw one bus or spine per family to avoid darker overlaps (see also the performance note in 10.6).

### 10.6 Expand/collapse, paging and animation

- **Expand/collapse:** toggle membership in `expandedParents`, re-derive the visible tree, re-run `layout` (it is stateless and cheap: about 41 ms per 10k nodes for flextree alone), and diff the nodes/edges.
- **Paging:** represent "show more" as a normal-size node that replaces `children[P]`, with its incoming edge hidden. Remove `children[P+1..]`. Clicking adds `pagingStep` and re-derives. Decide deliberately how a centred/highlighted node beyond the page is revealed. d3-org-chart shows it alone after the button; bumping `pagingStep` is cleaner.
- **Keep `measured` across updates.** If every relayout (or animation frame) builds fresh node objects without `measured`, `adoptUserNodes` resets their handle bounds, `useNodesInitialized` flips to false and `getEdgePosition` returns null for them, so **all edges vanish** until the ResizeObserver re-measures. Merge into the previous objects instead, e.g. `setNodes(prev => prev.map(n => ({ ...n, position: next.get(n.id)! })))`, or keep object identity for unchanged nodes and run a controlled flow with `onNodesChange` + `applyNodeChanges` so `'dimensions'` changes write `measured` back.
- **Animation.** React Flow does not animate node positions: the node transform is an inline `translate(positionAbsolute)` and the base CSS has no transition. Options:
  - tween positions between the old and new layout yourself (e.g. `d3-timer`/`requestAnimationFrame` interpolation, calling `setNodes` per frame over 400 ms with cubic in-out easing, merging as above). Edges built from `EdgeProps` (section 7.8) then stay exact on every frame, which is better than d3's interpolated path strings. This is also the approach of React Flow's Pro example "node-position-animation";
  - a CSS `transition: transform` on `.react-flow__node` is cheaper, but edges are computed from store positions and will jump rather than follow.

  To mimic d3-org-chart:
  - entering children start at the clicked node's **old** join point (top: old `(x − w/2, y + h)` as the top-left). Entering nodes have no handle bounds until measured, so their edges appear one frame late unless `node.width/height` are set and the handles render immediately;
  - exiting nodes and their edges must **stay** in the `nodes`/`edges` arrays, tweened to the join point of the parent of the shallowest exiting node, and be removed when the exit animation ends;
  - new nodes from a full rebuild come from under the root.
- **Interaction defaults for an org chart:** `nodesDraggable={false}`, `nodesConnectable={false}` (or `isConnectable={false}` on the handles), and `elementsSelectable={false}` or `selectable: false`/`focusable: false` on edges, so clicks do not apply the selected-edge style. Put `className="nodrag nopan"` on the expand/collapse button inside the custom node, and stop propagation if `onNodeClick` is used.
- **Performance at org-chart scale:** each edge renders its own `<svg>` plus a 20 px invisible interaction path; set `interactionWidth={0}`. Consider one custom "family" edge per parent that draws the bus and spine once and fans out to all children: it cuts DOM size and removes the overlap darkening. Consider `onlyRenderVisibleElements` for big charts, and define `nodeTypes`/`edgeTypes` outside the component.

### 10.7 Viewport

- React Flow's viewport `{x, y, zoom}` maps a flow point p to `p·zoom + (x, y)` relative to the React Flow container, as `setCenter`'s `x = width/2 − cx·zoom` shows. React Flow wraps d3-zoom (`XYPanZoom` in `@xyflow/system`), so the semantics match d3-zoom's transform.
- d3-org-chart's effective transform is `zoom ∘ centerG`, where centerG is first `centerTransform` and becomes the identity after `fit`. For the initial view use the `defaultViewport` prop rather than `setViewport` after mount: top `{x: W/2, y: 40, zoom: 1}`, left `{x: 40, y: H/2}`, bottom `{x: W/2, y: H − 40}`, right `{x: W − 40, y: H/2}`, where W × H is the React Flow container (`useStore(s => s.width)` / `s.height`). Do not set the `fitView` prop: d3-org-chart does not fit on the first draw.
- **Widen the zoom range.** `minZoom`/`maxZoom` default to **0.5 / 2**, and fit zoom is clamped to them, so a wide org chart cannot be fitted at all with the defaults (a 6000-wide bbox in a 1200-wide pane stays at zoom 0.5). d3-org-chart's `scaleExtent` is [0.001, 20] and its fit can reach k = 8: set `maxZoom={8}` (to reproduce the `min(8, …)` cap) and `minZoom` well below 0.5.
- **Fit like d3-org-chart:** compute the bbox of the card boxes padded by 50 flow units, then call `fitBounds(bbox, { padding: 1/9, duration: 400 })`. A numeric padding p gives `zoom = (W − 2·floor((W − W/(1+p))/2)) / bw ≈ W / ((1+p)·bw) = 0.9·W/bw`, i.e. d3-org-chart's `k = 0.9 / max(bw/W, bh/H)`, centred on the bbox (experiment: W = 1200, H = 800, bbox {−1100, −50, 2300, 900}: both give `{x: 576.52, y: 212.17, zoom: 0.4696}`). Plain `fitView({nodes})` still differs because it has no 50-unit pad (its `padding` also accepts `'Npx'`, `'N%'` and per-side objects). The manual route also works: `setViewport({x: W/2 − k·cx, y: H/2 − k·cy, zoom: k}, {duration: 400})` (signature `setViewport(viewport, {duration, ease, interpolate}) → Promise<boolean>`). `setViewport` does not clamp the zoom, but the next wheel or pinch snaps it into [minZoom, maxZoom], so widen the range there too.
- **Centre on click:** same formula with `k = current zoom`, over the subset in section 8.6, or simply over the clicked node plus its visible children. With `setCenter`, always pass the zoom, `setCenter(cx, cy, { zoom: getZoom(), duration: 400 })`, because it defaults to `maxZoom` when zoom is omitted. If you want the clicked node to stay pixel-stable (d3-org-chart does not do this), offset the viewport by `−(newPos − oldPos)·zoom` instead.
- Disable node dragging (`nodesDraggable={false}`) unless you want users to move cards. With `EdgeProps`-based edges (section 7.8) the edges do follow drags.

### 10.8 What to deliberately do differently (optional)

- Use `expandedParents` instead of visibility flags.
- Key paging by your own id accessor.
- Use constant compact margins, or pad the grid block by `siblingsMargin` to avoid the 10 px pinch.
- Optionally centre the parent over a mixed group's grid.
- Use `linkYOffset = 0` if you prefer a symmetric bus; corners are then `min(30, |dx|/2)` with cm = 60, i.e. 30 px once the child is at least 60 px off the parent's axis.
- Measure sizes once per layout pass.
- Keep layout and render sizes from the same source.

---

## 11. Validation and reproducibility

### 11.1 What was verified and how

- **Source study.** Five topics were each studied twice: pipeline, flextree, compact, edges and state.
  - A reader deep-read d3-org-chart 3.1.1 `src/d3-org-chart.js`, d3-flextree 2.1.2 `src/flextree.js` and d3-hierarchy `tree.js`, and wrote claims with experiments.
  - An independent verifier re-ran or rebuilt each experiment against the real libraries and graded every claim.
- **Verdicts.** **91 claims** were graded: **82 confirmed**, **9 partially confirmed** (corrected in this document), **0 refuted**. 90 were checked by experiment and 1 by code reading. The verifiers also logged **39 errors in the readers' prose**, all corrected here, and **41 additional findings**, folded in.
- **Equivalence tests:**
  - flextree reimplementation (section 3.4) vs the real d3-flextree: 0 difference in x/y on 3000 random trees with mixed sizes.
  - Compact port (section 5.11) vs the real d3-org-chart: max error 0 on 200 trees (study), then 400 + 400 + 1000 + 1000 trees (verification: 4 orientations, random sizes, about 20% collapsed, 7888 compact groups).
  - Raw d3-flextree configured as in section 4.1 vs the real OrgChart's top layout under jsdom: max difference 0.
  - `diagonal` pseudocode vs the library's `diagonal`: byte-identical on 2000 random inputs.
  - Uniform-size flextree vs `d3.tree`: equal within about 1e-11 (989/1000 bit-identical).
  - flextree box overlaps: 0 in 2000 + 20,000 random trees. The Java-style `isFirst` rule overlapped in 9 of 20,000.
- **Ground-truth fixture harness.** The real `OrgChart` class (UMD build; the logic is identical to `src` apart from the module wrapper) ran under jsdom.
  - **Configuration:** svg 1200×800, `duration(0)`, `initialExpandLevel(99)`, `expandAll()`, sizes `d.data.w||250` × `d.data.h||150`, default margins passed explicitly.
  - **Dataset (16 nodes):** root → mA (5 leaves, a3 = 320×190), mB (360×200; leaves b1, b2 and sub-manager bS with leaves s1–s3), mC (one leaf c1).
  - **10 fixtures:** `{top,left,bottom,right}-{true,false}` (compact on/off), plus `extra-top-true-interleaved` (b1, bS, b2) and `extra-top-true-managerfirst` (bS, b1, b2).
  - **What each fixture records per node:** the stored `x, y, width, height, compactEven, row, flexCompactDim, firstCompactNode`, plus the **actual DOM** `g.node` transform and rect size.
  - **Checks:**
    - all 16 nodes are visible in every fixture;
    - the convention boxes of section 6 equal the DOM boxes for every node;
    - bottom = top mirrored in y and right = left mirrored in x, with 0 mismatches;
    - **0 overlapping node pairs in all 10 fixtures.**

    | fixture | overlaps | min separation | between |
    |---|---|---|---|
    | top-true / bottom-true | 0 | 10 (x) | b2 / bS |
    | left-true / right-true | 0 | 10 (y) | b2 / bS |
    | top-false / bottom-false | 0 | 20 (x) | a1 / a2 |
    | left-false / right-false | 0 | 20 (y) | a1 / a2 |
    | extra-top-true-interleaved | 0 | 10 (x) | bS / b2 |
    | extra-top-true-managerfirst | 0 | 10 (x) | bS / b1 |

  - **jsdom stubs** (none of them touch the layout maths):
    - a fake canvas 2D context;
    - an `SVGElement.transform.baseVal.consolidate()` shim, which is required because d3's transform tween parses it even with duration 0;
    - defensive `getBBox`, `getComputedTextLength`, `matchMedia` and `ResizeObserver`;
    - `pretendToBeVisual` for `requestAnimationFrame`, with globals installed before d3 loads.

### 11.2 Reproducing

The lab is packaged in **`docs/d3-org-chart/lab`** in this repository (see its `README.md`). It pins exact versions (d3-org-chart 3.1.1, d3-flextree 2.1.2, d3-hierarchy 3.1.2, jsdom 29.1.1, every d3-* package) and needs Node `^20.19 || ^22.13 || >=24`; the fixtures were generated with Node 22.14.0. Run `npm ci` first.
- `run.cjs` is the harness. `node run.cjs` regenerates all fixtures in place and prints the analysis. `node run.cjs --check` (`npm run check`) regenerates into a temp directory and byte-compares with the golden files, exiting 1 on drift. `node run.cjs --out DIR` writes the dumps elsewhere. `node run.cjs --layout top --compact true --print` runs one configuration; note that without `--out` it writes into the golden `fixtures/` directory.
- `analyze.cjs` is the convention check, overlap check, gap report and compact-grid report: `node analyze.cjs fixtures/*.json`.
- `fixtures/*.json` holds the 10 ground-truth dumps. Their `nodes[]` are in `root.descendants()` (breadth-first) order, and absent compact fields are written as `null` (section 5.11).
- `reference-layout.cjs` and `check-reference.cjs` are the clean-room reimplementation and its fixture check (section 11.3): `node check-reference.cjs` (`npm run check-reference`) needs only `d3-hierarchy`.
- **Loading d3-hierarchy from CommonJS.** d3-hierarchy 3.x is `"type": "module"`. From a `.cjs` file, use `require('d3-hierarchy')`, which relies on `require(esm)` (on by default from Node 20.19 and 22.12; the lab's engines range already guarantees it). Do **not** require the UMD file `dist/d3-hierarchy.js`: the subpath is not in the package's `exports` (`ERR_PACKAGE_PATH_NOT_EXPORTED`), and loading it by absolute path parses it as ESM, which returns an empty module (`stratify is not a function`). On older Node, use `await import('d3-hierarchy')`.

The numbers quoted in sections 4–6 (mA grid, mB mixed group, gaps, transposed left grid) come from these fixtures.

### 11.3 Clean-room test: can the layout be rebuilt from this document?

An agent that had not seen the d3-org-chart or d3-flextree sources reimplemented the layout using only this document. It transcribed flextree from section 3.4, the compact passes from sections 5.3 and 5.11, `nodeFlexSize` from sections 4.1 and 6, the spacing rule from section 4.1 and the orientation swap from section 6. It used d3-hierarchy's `stratify` to build the tree and called `nodeWidth`/`nodeHeight` once per node with the hierarchy node, as d3-org-chart does (the test datasets, sizes and margins were copied from `run.cjs`).

In the latest round (round 1) it was compared with all 10 ground-truth fixtures, by id and in breadth-first order, on x/y (tolerance 1e-6), width, height, `compactEven`, `row`, `flexCompactDim` and `firstCompactNode`. **All 10 matched on the first run, with no iterations:** `top-true`, `top-false`, `bottom-true`, `bottom-false`, `left-true`, `left-false`, `right-true`, `right-false`, `extra-top-true-interleaved` and `extra-top-true-managerfirst`. None mismatched, and x/y were exact (max |dx|, |dy| = 0). The same code also reproduced numbers quoted in the text: the README tree in section 3.5 (R(0,0), A(−1.75,1), B(1.25,1), C(1.25,2)), the drawn width of 2640 without compact vs 2030 with it, and both sets of raw placeholder values in section 5.4 (−612.5 / 5.83 / 324.17 / 777.5 and −257.5 / 124.17 / 205.83). An earlier round (round 0) had also matched all 10 fixtures; the gaps it reported (the null values of the compact fields, the breadth-first output order, `flextreeLayout` vs `flextree(…)`, and an underspecified example in 5.4) were fixed before round 1.

Round 1 reported three remaining gaps. None of them changed a number, and all three are now fixed:
- **Loading d3-hierarchy from a `.cjs` file.** Requiring the UMD file crashed its first run; section 11.2 now says to use `require('d3-hierarchy')`.
- **How the fixtures store the compact fields.** `firstCompactNode` is an id string and `flexCompactDim` the raw array; the agent had to read this off the JSON. Section 5.11 now states it.
- **Where `compactMarginBetween` goes in the row height.** It is inside the row max in 5.3 and after it in 5.11. The two agree only for a constant margin, and the document did not say which one the library uses where. Section 5.11 now spells out the three call sites.

The round-1 code, tidied, is in the lab as **`reference-layout.cjs`** (header: provenance, options, output convention). **`check-reference.cjs`** runs it on the fixture datasets and compares it with `fixtures/*.json`; it passes on all 10 fixtures and exits 1 on any mismatch. It needs only `d3-hierarchy`: `npm ci && node check-reference.cjs` (or `npm run check-reference`) in `docs/d3-org-chart/lab`.
