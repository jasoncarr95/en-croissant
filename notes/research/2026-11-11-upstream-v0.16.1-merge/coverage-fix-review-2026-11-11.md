---
created: 2026-11-11
status: acted-on
source:
  tool: claude-code
  session: d1b74de2-d993-417a-8cc0-ddc62bc3ee67
  cwd: /Users/jasoncarr/projects/RANDOM/chess/en-croissant
  title: Fork sync after upstream release (fresh review of the coverage fixes, by an opus subagent)
  model: claude-fable-5-2; reviewer claude-opus-5-5
  effort: high
---

# Review: 55469efb + 2a2a84da (`computeTreeCoverage` transpositions)

> Filed 2026-11-12. Findings 1, 3 and 4 were fixed in `cca23f55`, finding 2 in `22cd0cda` after the database check it asks for (the aix extension's `matches_fen.cpp` compares pieces, side to move, castling rights and en-passant square, no clocks). Finding 5 and the untested cases under Q6 are open in `notes/handoffs/2026-11-12-explorer-coverage-followups-handoff.md`. The scratch harness the review names was not kept.

Read-only review. Nothing in the worktree was edited, committed or pushed. `git status --short` in the
worktree is empty after the review, and HEAD is still `2a2a84da`.

## What I ran

- `pnpm test`: 12 files, **97 tests passed**.
- `pnpm lint`: **exit 0**, 96 warnings, none of them errors. Two of the warnings are in the new test file:
  `src/utils/tests/repertoire.test.ts:5:44` (vitest/require-mock-type-parameters) and `:159:19`
  (vitest/require-to-throw-message).
- A scratch vitest harness (outside the worktree, own config aliasing `@` to the worktree's `src`):
  `/Users/jasoncarr/.claude-tmp/claude-501/-Users-jasoncarr-projects-RANDOM-chess-en-croissant/d1b74de2-d993-417a-8cc0-ddc62bc3ee67/scratchpad/harness/`
  - `before1.ts` = `55469efb^:src/utils/repertoire.ts`, `before2.ts` = `2a2a84da^:…`, current = the worktree file.
  - `coverage-review.test.ts`: the four repo tests on all three versions, real-FEN transposition check with
    chessops, gap finders on a "direct" rare-move shape, a user-alternative case, order dependence, the
    leaf-twin missing count, mid-run abort with an `unhandledRejection` listener, and a 300-tree random
    property test against `before2`.
  - `fixed.ts` + `fixed.test.ts`: the current file with the fixes proposed below applied, re-run against the
    same cases and the property test.
  - Run with `pnpm vitest run --config <harness>/vitest.config.ts --reporter=verbose`. Output in `run.txt`
    and `run-fixed.txt` there.

Everything marked **(ran)** below was observed in that harness; **(inferred)** is from reading the code.

## Summary

| #   | Severity | Finding                                                                                                                                                                                 |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **bug**  | Gap buttons now walk into rare move orders: "biggest gap" can lose the real biggest hole, and "next gap" can send you down a rare order where fixing it doesn't move the coverage (ran) |
| 2   | **risk** | Both fixes key on the full FEN string, so a transposition whose halfmove clock differs (1.d4 Nf6 2.c4 e6 3.Nf3 vs 1.d4 Nf6 2.Nf3 e6 3.c4) is still missed (ran)                         |
| 3   | risk     | The second pass is one pre-order sweep, so whether a rare path gets coverage depends on child order (ran)                                                                               |
| 4   | risk     | The second pass also fills alternative user moves (`children[1+]`) that happen to transpose, so sibling alternatives show real coverage next to an empty bar (ran)                      |
| 5   | nit      | A leaf that transposes takes its coverage from the first non-leaf twin but its missing count from the last one (from 55469efb) (ran)                                                    |
| 6   | nit      | Two of the four tests are guards that pass on the old code; untested cases listed under Q6                                                                                              |
| —   | clean    | Q2 (first-pass numbers unchanged), Q3 bounds, Q5 abort and unhandled rejections                                                                                                         |

## Q1. Can the second pass write wrong or misleading entries?

I traced each case through `compute` / `computeNode` (`src/utils/repertoire.ts:86-186`) and the panel
(`src/components/panels/practice/RepertoireInfo.tsx`).

- **A rare opponent move into a searched position (the intended case).** `compute` writes the same coverage,
  games and missing count as the twin, plus entries for the moves under it. At the parent, the panel lists
  that move under "rare moves" with N/A (`RepertoireInfo.tsx:753`). Once you step into it, the moves show
  the twin's coverage. This is **correct (ran)**.
- **A leaf.** If a non-leaf twin is in `fenCoverageCache`, the leaf takes the twin's coverage (`:94-103`),
  which is upstream's design. If not, `computeNode` gives the usual leaf value (partial `minGames/total` on
  the opponent's turn, 0 and `missing = total` on yours) with no new search. Values are correct apart from
  finding 5.
- **A position with fewer than `minGames` games.** It gets coverage 1, missing 0 and games = total
  (`:123-128`), the same as the main walk would give, and nothing below it is followed. In the panel every
  row there reads N/A (games < minGames), and the gap finders skip it (`games < minGames`). **Clean.**
  The sweep can still go on below it and fill descendants whose FEN was searched, but nothing displays them
  unless you navigate in. Harmless.
- **Your own move that is not `children[0]` (a user alternative).** If its FEN was searched elsewhere, the
  sweep computes it and its subtree. **Misleading (ran): finding 4.**
- **A rare opponent move that also feeds the gap finders.** **Wrong for the gap buttons (ran): finding 1.**

## Q2. Does the second pass change numbers the first pass wrote?

**Clean (ran + inferred).**

- **Inferred:** `computeTransposedPaths` calls `compute` only on a key with no `coverageMap` entry. Main-walk
  entries are closed under ancestors, and the sweep is pre-order. So when it reaches a node with no entry,
  no descendant of that node has one either, and `compute` only writes fresh keys (its own and its
  descendants'). Ancestors and the root are never recomputed. `fenCoverageCache` is only set when absent
  (`:107`), so later leaves see the same twin value as before.
- **Ran:** in 300 random trees (transposition-dense fake FENs, both colours), every key that
  `2a2a84da^` wrote has an identical coverage, games and missing value in the current code.

## Q3. Cost

**Clean on the bounds (inferred, confirmed by the property test).**

- `compute`/`computeNode` runs **at most once per tree path in total**:
  - The main walk is a plain tree walk: each node is reached only from its parent, and since 55469efb no
    subtree is pruned by FEN.
  - The sweep only computes paths with no entry, and each such `compute` writes entries for everything it
    visits.
  - `computeTransposedPaths` itself runs once per node in the start subtree. Each call does a
    `path.join(",")` and a `[...path, i]`: O(N·depth) string work, which is trivial at 6,955 nodes.
- **Searches ≤ distinct FENs in the tree.** `getDbMoves` is only called from `computeNode` on tree nodes, and
  `dbMovesCache` is per FEN (ran: no FEN searched twice in 300 trees).
- **The sweep can trigger new searches.** Under a transposed entry, the repertoire may continue differently
  from the twin's subtree, and those positions get searched. That is legitimate. It does not cascade: newly
  cached FENs only make nodes eligible that come _later_ in the same sweep, and earlier ones are never
  revisited. That is what makes it bounded, and also what causes finding 3.

## Q4. `findNextGap` / `findBiggestGap`: regression

**Bug (ran). Finding 1.**

The gap finders never filtered rare moves themselves. They relied on rare paths having no entry: no entry
means `games = 0`, which is below `minGames`, so the path is pruned (`repertoire.ts:225`, `:273`). Now a
node under a rare move has `gamesMap` = the position's total (large, because the position is common), so:

- **Next gap goes through a rare order (ran).** At an opponent node, children are tried in index order
  (`:231`). If the rare move's child comes first and is not fully covered, "Go to your next gap" lands under
  the rare order.
  - **(inferred)** The tree is not a DAG, so filling that gap adds moves under the rare-order node only.
  - **(inferred)** Root coverage (computed through the common order) does not change, and the same gap is
    still listed under the common order. You do the work twice.
- **The same missing position is counted twice.** Biggest gap gets two candidates with the same missing
  count. Ties go to the shorter path, then to the first found, so the rare copy wins whenever its branch
  comes first.
- **Biggest gap can lose the real biggest hole.**
  - At `:291` an opponent node counts as a gap only if no child "has a gap". `traverse` returns `true` for
    any child that is not fully covered and has at least `minGames` games.
  - A rare child under the transposition now qualifies, so its parent stops being reported, even when the
    parent's real problem is a significant opponent move missing from the repertoire.

**Scenario (ran, `coverage-review.test.ts` "direct shape").** A White repertoire.

- Opponent node O2 has c2 (5 games, rare) leading into position T, also reached commonly via O1; c3 (35)
  fully covered; and c4 (100 games) **not in the repertoire**.
- T's subtree is only partly covered.

|                 | Next gap from O2's parent       | Biggest gap                                                                   |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| before 2a2a84da | O2 (the missing c4)             | O2 (missing 100)                                                              |
| now             | `0,1,0,0,0,0` (through rare c2) | `0,0,0,0,0,0` (missing 30); O2's 100-game hole is no longer reported anywhere |

**Proposed fix (ran in `fixed.ts`).** Hand the gap finders the main walk's `gamesMap`. In
`RepertoireInfo.tsx`, `gamesMap` is only used by the two gap finders (`:107`, `:121`, `:132`, `:213`, `:223`),
so no consumer changes:

```diff
     const startNode = getNodeAtPath(root, startPath);
     await compute(startNode, startPath);
+    // The gap buttons follow the main walk only: a gap reached through a rare move order is the
+    // same gap as on the common order, and filling it there would not change the coverage.
+    const mainGamesMap = new Map(gamesMap);
     await computeTransposedPaths(startNode, startPath);
-    return { coverageMap, gamesMap, missingGamesMap };
+    return { coverageMap, gamesMap: mainGamesMap, missingGamesMap };
```

- With this, the direct-shape gaps match `2a2a84da^` exactly. In 300 random trees, both gap finders return
  the same paths as `2a2a84da^`, while the rare-order coverage entries stay for display.
- **What it costs, in the panel (inferred):**
  - `findNextGap` starts from the position you're on. If you stand inside a rare-order line, you get no
    "Go to your next gap" there, although the current code gives one.
  - If the main walk is fully covered, the green "No gaps found" notice can appear next to partly filled
    bars under a rare order.
  - Both are exactly how it behaved before 2a2a84da. I still recommend the fix: a missing gap button is
    milder than one that sends you down the wrong order, or one that hides the biggest hole.
- The test at `repertoire.test.ts:130` (`gamesMap.get(key)` equals the twin's) has to drop the `gamesMap`
  line or assert it is undefined.
- If you'd rather keep `gamesMap` honest, return a separate `gapGamesMap` and pass that to the two finders
  instead. Same effect, two more lines in `RepertoireInfo.tsx`.

## Q5. Abort handling

**Clean (ran + inferred).**

- **Ran:** I aborted inside the Nth mocked search, once during the main walk (on N) and once during the
  sweep (on a position only the sweep searches). Both runs rejected. An `unhandledRejection` listener saw
  nothing.
- **Inferred:**
  - Every promise stored in `dbMovesCache` or `fenCoverageCache` is also returned to and awaited by its
    creator (`getDbMoves` → `computeNode`; `compute` returns `promise`), so a rejection always has a handler.
  - Later awaits of an already-rejected promise only happen during unwinding.
  - `computeTransposedPaths` checks the signal at every node (`:194`), and `getDbMoves`' catch rethrows on
    abort (`:77`).
  - If the abort lands after the last check, the call resolves with complete maps, never partial ones.
  - `RepertoireInfo.tsx:130` drops the result on an aborted signal anyway.

## Q6. Do the tests pin both behaviours?

**(ran) Each repo test on the code before each commit.** I used trimmed copies of the four tests that keep
their key assertions, not the file verbatim:

| Test                                           | before 55469efb | before 2a2a84da | now    |
| ---------------------------------------------- | --------------- | --------------- | ------ |
| `:75` both move orders                         | **fails**       | passes          | passes |
| `:97` searches each position once              | passes          | passes          | passes |
| `:108` rare move order                         | **fails**       | **fails**       | passes |
| `:146` stops when aborted (pre-aborted signal) | passes          | passes          | passes |

So `:75` pins 55469efb and `:108` pins 2a2a84da. `:97` and `:146` are guards, not regression tests.

**Untested realistic cases:**

1. The gap finders. There are no tests for `findNextGap` / `findBiggestGap` at all, and finding 1 would
   have shown up in one.
2. A transposition with different halfmove clocks (finding 2). The tests use label FENs, so they can't catch
   it.
3. A rare move leading _directly_ into a searched position, where the parent was visited. That is the
   reported 1.c4 Nf6 2.d4 g6 shape. The repo test has two unvisited nodes in between, which also hides
   finding 1.
4. A user alternative that transposes (finding 4).
5. Child-order dependence (finding 3).
6. Aborting mid-run, during either pass.
7. A non-empty `startPath`.

## Findings in detail

### 1. bug — gap buttons follow rare move orders

`src/utils/repertoire.ts:204-206` (cause) and `:225` / `:273` / `:291` (effect). The scenario and fix are
under Q4.

### 2. risk — transpositions that differ only in the halfmove clock are still missed

`src/utils/repertoire.ts:45`, `:94`, `:107`, `:195` (every cache key is `node.fen`). FENs come from
`makeFen(pos.toSetup())` (`src/state/store/tree.ts:568`), which includes the halfmove clock.

**Ran (chessops):**

- SAME: 1.d4 Nf6 2.c4 g6 / 1.c4 Nf6 2.d4 g6 (the reported case ends on a pawn move, so the clock is 0 in
  both).
- DIFF: 1.d4 Nf6 2.c4 e6 3.Nf3 (`… - 1 3`) / 1.d4 Nf6 2.Nf3 e6 3.c4 (`… - 0 3`).
- DIFF: 1.d4 d5 2.Nf3 Nf6 / 1.Nf3 d5 2.d4 Nf6.
- DIFF: 1.Nf3 Nf6 2.c4 / 1.c4 Nf6 2.Nf3.

Any transposition whose last pawn move or capture falls on a different ply gets two FEN strings. Neither
the sweep's `dbMovesCache.has` gate nor the leaf cache matches them, so the rare order still reads 0% (ran:
`fixed.test.ts` "halfmove-clock transposition", where the current code writes no entry). Each order is also
searched separately.

This was not introduced by these commits, but it bounds what they fix: Queen's Gambit and Catalan move
orders are exactly this kind.

**Inferred, worth one check in the app:** whether the database ignores the clock.

- Weak evidence that it does: the backend's result cache key starts with an EPD, which has no clocks
  (`src-tauri/src/db/search.rs:55-61`).
- Against that: the same key also carries the WHERE text, and the full FEN goes into `matches_fen`
  (`search.rs:257-263`, `:386`). `matches_fen` lives in the aixchess DuckDB extension, which I could not
  read.
- Searching both FENs above in the reference database and comparing totals settles it. Fix 2 depends on
  that check.

**Proposed fix (ran in `fixed.ts`).** Key all three caches and the sweep gate by the first four FEN fields,
and keep sending the full FEN to `searchPosition`:

```diff
+// The database counts games by position, so move orders that differ only in the halfmove clock
+// are the same position.
+const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
```

Then use `positionKey(fen)` / `positionKey(node.fen)` in place of `fen` / `node.fen` in every
`dbMovesCache`, `fenCoverageCache` and `fenMissingCache` call: lines 45, 46, 82, 94, 95, 98, 99, 102, 107,
108, 126, 140, 149, 172, 178, 184 and 195. chessops writes an en-passant square only when the capture is
legal, so field 4 is safe to keep.

**This fix is not display-only (inferred).**

- A leaf whose position matches a non-leaf twin apart from the clock gets its own leaf value today. With the
  fix, the main walk gives it the twin's coverage instead (`:94`), so ancestor and root percentages can
  change.
- That is the same leaf rule upstream already applies to exact-FEN transpositions, so it is arguably more
  correct, but expect the root number to move.
- The property test cannot show this: its fake FENs have no clock fields, so `positionKey` does nothing
  there. The only run that exercises it is the single clock-differing case in `fixed.test.ts`.

### 3. risk — the sweep depends on child order

`src/utils/repertoire.ts:193-201`.

**Scenario (ran).** Branch X comes first and has a rare move into position T, which the main walk never
searched. Branch Y comes later and has a rare move into S, which was searched. S's subtree reaches T, so T is
searched during the sweep, but after X was passed.

- T under X gets no entry and reads 0%.
- Swap the child order of X and Y and it gets coverage.

In random transposition-dense trees, 160 of 300 had at least one such missed path. That rate is
exaggerated, because the fake FEN pool is tiny. Real repertoires will hit it far less often, but the result
depends on the order you added the lines in.

**Proposed fix (ran in `fixed.ts`).** Repeat the sweep until no new position is searched:

```diff
-    await computeTransposedPaths(startNode, startPath);
+    let searchedBefore: number;
+    do {
+        searchedBefore = dbMovesCache.size;
+        await computeTransposedPaths(startNode, startPath);
+    } while (dbMovesCache.size > searchedBefore);
```

- Each extra sweep is one O(N) walk with no repeated `compute` calls (the `coverageMap.has` gate). The loop
  ends because `dbMovesCache` only grows and is bounded by distinct positions.
- With this fix: 0 missed paths in 300 trees, and both orders get the entry.

### 4. risk — alternative user moves get coverage only when they transpose

`src/utils/repertoire.ts:198`: the sweep recurses into every child. The main walk only follows
`children[0]` on your turn (`:181`).

**Scenario (ran).** At your move you have a main reply P and an alternative Q, and Q's position is reached
by a common line elsewhere. The sweep computes Q and its subtree.

- In the "Your response" list (`RepertoireInfo.tsx:413-431`), Q shows a real coverage bar, while any other
  alternative R shows the empty 3% gray bar, only because R doesn't transpose.
- That reads as "Q is covered, R is not", when R simply wasn't computed.
- 4,254 such entries appeared across the 300 random trees.
- **(inferred)** Without fix 1, the gap finders can also descend into these side lines, which don't count
  toward the parent's coverage. In my one alternative-move case the gap output was the same in both
  versions, because `children[0]` comes first.

**Proposed fix (ran in `fixed.ts`).** Follow the same reply rule as the main walk:

```diff
-        for (let i = 0; i < node.children.length; i++) {
+        const isOpponentTurn = node.halfMoves % 2 !== userParity;
+        const followed = isOpponentTurn ? node.children.length : Math.min(node.children.length, 1);
+        for (let i = 0; i < followed; i++) {
             await computeTransposedPaths(node.children[i], [...path, i]);
```

The repo's rare-order test still passes with this.

Computing _all_ alternatives instead would be a product choice. It means more searches, and the parent's
coverage would still ignore them.

### 5. nit — a transposing leaf mixes values from two twins

`src/utils/repertoire.ts:102` with `:172`.

Since 55469efb, each non-leaf occurrence of a FEN runs `computeNode` and overwrites
`fenMissingCache[fen]`. `fenCoverageCache[fen]`, though, keeps the first occurrence's promise. A leaf with
that FEN therefore gets coverage from twin #1 but its missing count from twin #N.

**Ran.** Q appears twice with different replies: one misses a 20-game move, the other a 100-game move. Then
Q appears as a leaf.

- Before 55469efb: the leaf gets 20.
- Now: the leaf gets 100, next to twin #1's coverage.

This only changes how "biggest gap" ranks such a leaf.

**Fix.** Set `fenMissingCache` once, in `compute`, next to `fenCoverageCache`:

```ts
const first = node.children.length > 0 && !fenCoverageCache.has(node.fen);
const promise = computeNode(node, path);
if (first) fenCoverageCache.set(node.fen, promise);
const coverage = await promise;
if (first) fenMissingCache.set(node.fen, missingGamesMap.get(pathKey) ?? 0);
return coverage;
```

Then drop the `fenMissingCache.set` lines from `computeNode`. Don't attach the write with
`promise.then(...)`: a derived promise that nobody awaits would turn an abort into an unhandled rejection. I
did not run this one.

### 6. nit — tests

Covered under Q6. The two lint warnings in the new test file are style only.

## Clean areas

- First-pass numbers, root and ancestors are unchanged by the sweep (Q2).
- At most one `compute` per path. Searches are bounded by distinct positions, with no duplicate search
  (Q3).
- Abort rejects in both passes, with no unhandled rejection (Q5).
- Low-game positions and leaves reached by the sweep get the same values the main walk would give (Q1).

## Recommended order

1. Fix 1: three lines, and restores the gap buttons.
2. Fix 4: two lines.
3. Fix 2, after the one-minute database check.
4. Fix 3.
5. Add tests for the direct rare-move shape with both gap finders, plus a clock-differing pair.

Fixes 1-4 were run together in `fixed.ts`. The 300-tree property test still holds there: first-pass values
unchanged, gap finders identical to `2a2a84da^`, no order-dependent misses. That test does not exercise
fix 2 (see above).
