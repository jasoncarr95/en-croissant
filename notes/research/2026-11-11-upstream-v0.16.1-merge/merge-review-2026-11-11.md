---
created: 2026-11-11
status: acted-on
source:
  tool: claude-code
  session: d1b74de2-d993-417a-8cc0-ddc62bc3ee67
  cwd: /Users/jasoncarr/projects/RANDOM/chess/en-croissant
  title: Fork sync after upstream release (fresh review of the merge, by an opus subagent)
  model: claude-fable-5-2; reviewer claude-opus-5-5
  effort: high
---

# Review: merge of upstream v0.16.1 into `yason` (branch `chore/upstream-v0.16.1`)

> Filed 2026-11-12. Finding 1 was fixed in `4f976204`, finding 2 in `55469efb`, the two test nits and the AGENTS.md nit in `4f976204` and `e1432dd9`. Findings 3, 4 and 5 are open in `notes/handoffs/2026-11-12-explorer-coverage-followups-handoff.md`.

Reviewed at HEAD `eb6ea630` (merge `09025b06`). Read-only; nothing edited, nothing run in the app.

## Verified by running

- `git diff --stat v0.16.1 HEAD -- src-tauri src/bindings` is **empty**: the Rust side and bindings match upstream exactly.
- `pnpm test`: **11 files, 91 tests, all pass.**
- `pnpm lint` (`tsc --noEmit && oxlint`): **exit 0**, warnings only. The warnings in files this merge touched are on upstream lines (unused `ThemeIcon`/`IconBook`/`IconChess` in `OpeningsPanel.tsx`; the hook and ref warnings in `RepertoireInfo.tsx` and `NewTabHome.tsx`). None are new from the re-port.
- All 16 locale files (`fd -e json src/translation` → 16) contain `Board.Database.SelectDatabase`, `Board.Database.NoSelection`, `Board.Database.AddDatabase` and `Home.RecentFiles.RemoveFromList`. `src/index.tsx` sets `returnEmptyString: false` and `fallbackLng: "en-US"`, so the empty strings fall back to en-US. en-US has real text for all four keys.
- SWR's `stableHash` (`node_modules/swr/dist/serialize-*.mjs:58-60`) skips keys whose value is `undefined`, so the `options: undefined` that `GameFilters` writes does not change any SWR key.

## Findings

### 1. bug (inferred): a tab keeps a deleted database, and querying it re-creates an empty `.duckdb` file

Files: `src/components/databases/DatabasesPage.tsx:117-126`, `src/state/databaseExplorer.ts` (no way to clear a path from other tabs), backend `src-tauri/src/db/mod.rs:143-167` + `:90-104`.

Upstream commit `e497e4eb` ("validate database path", part of v0.16.1) clears the reference when its database is deleted. It also moves the reference to the new file after a legacy conversion. Upstream needs nothing more, because its panel only ever queries `referenceDbAtom`, and `referenceDbAtom` is validated by `getDbInfo`, which calls `path.metadata()?` first and so fails cleanly on a missing file.

After the re-port, each tab queries its own path, and nothing validates or updates that path:

1. Tab A's explorer is on database X (picked, or adopted from the reference).
2. On the Databases page, delete X. `delete_database` calls `remove_duckdb_pool`, and the reference is cleared. Tab A's `localOptionsFamily("A").path` still holds X.
3. Back in tab A, make a move. The SWR key changes, and both `search_position` (`search.rs:300`) and `get_games`, the backend of `query_games` (`db/mod.rs:763`), call `get_duckdb_pool(X)`.
4. The pool entry is vacant and `path.exists()` is false, so it skips the legacy check. `create_duckdb_pool` then opens X with `AccessMode::ReadWrite`. DuckDB creates a file for a missing read-write path, and `r2d2::Pool::build` opens connections eagerly, so **an empty X.duckdb appears in the databases folder**.
5. The query fails ("games" table missing) with a red alert in the panel. The Databases page now lists a ghost entry in the "error" state. The panel's `Select` shows nothing, because X is not in `dbSelectData`.

I did not run this, but each step is read directly from the code. In `yason` the same hole existed with SQLite, so the bug is not new in kind. It does mean the merge discards upstream's protection for the board panel.

Proposed fix, mirroring `e497e4eb` at the source (jotai 2.18's `atomFamily` has `getParams()`):

```diff
--- a/src/state/databaseExplorer.ts
+++ b/src/state/databaseExplorer.ts
@@
+// A database was deleted: no tab may keep searching it. Tabs left without one adopt the reference.
+export const forgetLocalDatabaseAtom = atom(null, (get, set, path: string) => {
+    for (const tabId of localOptionsFamily.getParams()) {
+        const optionsAtom = localOptionsFamily(tabId);
+        const current = get(optionsAtom);
+        if (current.path === path) {
+            set(optionsAtom, { ...current, path: null, player1: null, player2: null, tournament: null });
+        }
+    }
+});
--- a/src/components/databases/DatabasesPage.tsx
+++ b/src/components/databases/DatabasesPage.tsx
@@
           commands.deleteDatabase(selectedDatabase.file).then((result) => {
             if (result.status !== "ok") return;
             setReferenceDatabase((current) => (current === selectedDatabase.file ? null : current));
+            forgetLocalDatabase(selectedDatabase.file);
             mutate();
```

(plus `const forgetLocalDatabase = useSetAtom(forgetLocalDatabaseAtom);` and a state test). `DatabasesPage.tsx:119` is the only `deleteDatabase` caller in `src`. A legacy conversion needs no counterpart: a tab cannot hold a legacy path, because `dbSelectData` keeps only `type === "success"` and `referenceDbAtom` rejects `needs_conversion`. The one unvalidated source is `OpeningsPanel`'s `source.file`, which comes from a database the user was just browsing.

### 2. risk (pre-existing in `yason`, kept by item 8): a transposed position reuses another node's coverage and leaves holes in the coverage map

File: `src/utils/repertoire.ts:91-106`.

The fork's `compute` returns the cached coverage for **any** node whose FEN is already in `fenCoverageCache`, leaves included, and then does not descend. Upstream (v0.16.1) reuses the cache only for leaves and never caches leaves, so it always computes a non-leaf node.

Concrete case. On the user's turn `computeNode` only descends `children[0]` (`:177`), so transpositions come from the opponent's move order. Take a white repertoire with `1.d4 d5 2.c4 e6 3.Nc3 c6 …(subtree)` and `1.d4 d5 2.c4 c6 3.Nc3 e6 …(subtree)`. Both reach the same node FEN (`makeFen(pos.toSetup())` in `state/store/tree.ts:568`, clocks included): halfmove `0`, fullmove `4`, and no en-passant square, because `e6`/`c6` are single steps.

- If the first occurrence visited is a leaf, the second, non-leaf occurrence gets the leaf's coverage (the partial `minGames / total` value) instead of its own subtree's.
- In either order, nothing under the second occurrence gets `coverageMap` or `missingGamesMap` entries. `RepertoireInfo.tsx:154,190,418` read them as `?? 0`, so those repertoire moves show **0% coverage**, and `findNextGap` sees gaps that do not exist.

The fork commit's CPU fix came from `dbMovesCache`, which allows one backend search per FEN. Once that cache exists, upstream's "always compute non-leaves" costs only an in-memory walk, O(nodes). So the coverage reuse can be narrowed without losing the fix:

```diff
-        // If we've already computed (or are computing) this FEN, reuse the result
-        if (fenCoverageCache.has(node.fen)) {
+        // A leaf that transposes into an already computed position takes its coverage;
+        // a non-leaf is walked again so its own subtree gets coverage entries (searches stay cached).
+        if (node.children.length === 0 && fenCoverageCache.has(node.fen)) {
@@
-        const promise = computeNode(node, path);
-        fenCoverageCache.set(node.fen, promise);
-        return promise;
+        const promise = computeNode(node, path);
+        if (node.children.length > 0 && !fenCoverageCache.has(node.fen)) {
+            fenCoverageCache.set(node.fen, promise);
+        }
+        return promise;
```

This is your call, since item 8 asks for the fork's `compute` logic as is. I inferred it from reading and did not run it.

### 3. risk (inherited from upstream): the first render after the panel remounts searches the previous position

File: `src/components/panels/database/DatabasePanel.tsx:156-158, 186, 196, 212`.

`localOptions.position` is per-tab state that outlives the panel: `BoardAnalysis` uses `keepMounted={false}`, so switching to the Engines panel unmounts it. Moves played elsewhere leave the stored position stale. On remount, the first render already passes `canQuery && hasLocalPosition` with the old FEN. The sync effect corrects it only after commit. Likewise, switching Lichess → Local renders once with a stale position, because the sync runs only while `db === "local"`. A duplicated tab starts on the source tab's position too.

- If SWR has the old key cached, the old position's stats show for a frame.
- If not, a full search for the old position starts. In the backend, `search_position` computes while holding the per-file `position_cache` mutex (`search.rs:317-331`), so the real query **waits behind the stale scan**.

v0.16.1 behaves the same (same per-tab atom, same effect, same deps), so this is not a merge regression.

The obvious one-liner, `hasLocalPosition = localOptions.position?.fen === debouncedFen`, has a cost. After every move, one render has the debounced FEN changed but the store not yet synced. Both SWR keys are null there, so the table empties and the count shows 0 with `isLoading` false for a frame.

A better fix builds the query position from the board at render, so the stored position no longer drives queries. The sync effect stays, keeping the state for duplicates:

```diff
-  const localOptions = useAtomValue(currentLocalOptionsAtom);
+  const storedLocalOptions = useAtomValue(currentLocalOptionsAtom);
+  // Queries always use the board's position; the stored copy can lag a render behind.
+  const localOptions = useMemo<LocalOptions>(
+    () => ({ ...storedLocalOptions, position: { fen: debouncedFen, type_: "exact" } }),
+    [storedLocalOptions, debouncedFen],
+  );
```

Add `useMemo` to the `react` import, and point the adopt effect's `localOptions.path` at `storedLocalOptions.path` (same value). Every key, `dbType`, the pagination key and `hasLocalPosition` then follow the board directly. I have not run this change; check it against `DatabasePanel.test.ts`'s source-string assertions, which still match.

### 4. nit: the write atoms take the active tab from the store, not from the panel's rendered tab

File: `src/state/databaseExplorer.ts:129-151`, `DatabasePanel.tsx:152-158`.

`adoptReferenceDatabaseAtom` and `syncCurrentLocalFenAtom` resolve `activeTabAtom` when they run, while the effect guarding them captured `tabId` from render. `closeTab` sets the store synchronously (`startTransition` only defers React's render), so `activeTabAtom` may already name the next tab. An urgent re-render of the closing tab's panel before the transition commits could then write that tab's FEN or adoption into the next tab. I found no realistic trigger, and `yason` had the same shape. Hardening would mean passing `tabId` explicitly (`syncCurrentLocalFenAtom` taking `{ tabId, fen }`). Inferred, low.

### 5. nit: `PanelWithError` precedence differs from upstream

File: `DatabasePanel.tsx:339-363`.

Upstream applies three independent `if`s, so a query error wins over the other states. HEAD uses an else-if chain: missing database, then missing Lichess token, then error. No query runs in the first two states, so SWR has no error to show and nothing visible changes. Intentional, noted only because it differs.

### 6. nit: tests lost two real guarantees

- `yason`'s state test asserted that the global reference survives `setCurrentLocalDatabaseAtom` (`expect(store.get(referenceDbAtom))…`). HEAD replaced it with a source-text check (`DatabasePanel.test.ts:13-15`). Restoring it at state level is cheap:

  ```diff
  +import { storedReferenceDbAtom } from "@/state/atoms";
  @@ src/state/tests/databaseExplorer.test.ts:47 "keeps initialized analysis tabs independent" (after the tab-a edits)
  +        expect(store.get(storedReferenceDbAtom)).toBeNull();
  ```

- Item 7 (`OpeningsPanel` sets the database on its own tab only) has no test. A source-text guard matching the existing style:

  ```ts
  import openingsPanelSource from "@/components/home/PersonalCardPanels/OpeningsPanel.tsx?raw";
  expect(openingsPanelSource).not.toContain("storedReferenceDbAtom");
  expect(openingsPanelSource).toContain("path: source?.file ?? prev.path");
  ```

- Uncovered: `OpeningsPanel` with no source. The path stays `null`, `player1` is set, and adopting the reference keeps `player1`. That works today but has no test.

The dropped `yason` tests (immediate board FEN for the exact/partial toggle; partial FEN survives sync; exact-mode resync) covered the removed toggle. Dropping them is correct under item 4. Their replacement, "always searches the exact board position", also checks that a scoutfish position gets overwritten.

### 7. nit: AGENTS.md names the wrong type checker

`AGENTS.md:26` says `pnpm lint  # Type check (tsgo) + oxlint`. `package.json:15` at HEAD (taken from v0.16.1) runs `tsc --noEmit && oxlint`; `yason` used `tsgo`.

```diff
-pnpm lint         # Type check (tsgo) + oxlint
+pnpm lint         # Type check (tsc) + oxlint
```

## Areas checked and clean

**Upstream `DatabasePanel` behaviour preserved (read).**

- Stats key: upstream's `tabType !== "options" && (db !== "local" || tabType === "stats") && !missingExplorerToken && (local → path && fen)` equals HEAD's `canQuery && (db !== "local" || (tabType === "stats" && hasLocalPosition))`, plus the `initialized` gate.
- Games tab: the `query_games` call (page size 20, `averageElo desc`, `sides ?? "WhiteBlack"`) is unchanged. Pagination keyed on `JSON.stringify(localOptions)` still resets the page when the filters or the database change, since `path` is in the key as before.
- Unchanged too: the matches count (local games → `localGames.count`, else `max(grandTotal, games.length)`), `DatabaseLoader isLoading || gamesLoading`, the per-tab error routing (`gamesError` for local Games), `OpeningsTable fen`, and `fetchOpening`'s `total` fields. The only additions are the `initialized` gate and the tab path in place of the reference.

**Effect ordering (inferred from reading; none of it was run in the app).**

- First mount of a restored tab: render 1 cannot query (`initialized` false). The three effects run in one commit: initialize, adopt (a no-op while `referenceDbAtom`'s `unwrap` fallback is still `null`), sync FEN. When the reference resolves, the adopt effect re-runs on its dependency and sets the path, and the query starts.
- No loops: adopt stops once the path is non-null, sync is guarded by an equality check, initialize by its flag.
- `OpeningsPanel` pre-set (path, players, exact `INITIAL_FEN`, source, sub-tab) survives: initialize touches only the Lichess and Masters options, adopt skips a set path, sync is a no-op at `INITIAL_FEN`.
- A user pick before the reference resolves wins, because adopt never overrides a path.
- Mantine `Select` never calls `onChange(null)` on its own (`Select.mjs` calls `setValue(null)` only from the clear button, and `allowDeselect={false}`), so no spurious database reset clears the players.
- Only the active board tab is mounted (`BoardsPage` `keepMounted={false}`), so reading the active tab in the atoms is sound.

**`currentLocalFiltersAtom` / `GameFilters` (read).**

- In `alwaysExpanded` + `hidePositionSearch` mode, every reachable `setQuery` spreads `...query`, so `position` survives and the path is re-attached by the atom.
- The extra `options: undefined` key does not affect SWR keys (verified), `JSON.stringify` drops it, `query_games` overwrites it, and Tauri IPC drops it.
- `searchPosition` forces `type_: "exact"` anyway. Behaviour matches upstream, whose `LocalOptionsPanel` passed the whole-object setter too.

**`repertoire.ts` abort and cache (read).**

- All three caches are local to one `computeTreeCoverage` call, so an aborted or failed run cannot poison the next run.
- Abort is checked before the search, after it, and again in `catch`, which re-throws when the signal is aborted. Abort is not swallowed.
- A non-abort failure is cached as zero games for that FEN within the run only, the same as upstream's per-call zero.
- Traversal is sequential, so at most one search is in flight per run.
- A same-FEN ancestor cannot deadlock: the full FEN includes the fullmove number and side to move, so it cannot repeat along one path.
- `RepertoireInfo.tsx` swaps the fork's version counter for upstream's `controller.signal.aborted` checks, which is equivalent.
- The one semantic issue is finding 2.

**Callers of moved or removed atoms and types (grep).**

- `currentLocalOptionsAtom`, `currentDbTypeAtom` and `currentDbTabAtom` are used only by `DatabasePanel`, `OpeningsPanel` and tests.
- `lichessOptionsAtom`/`masterOptionsAtom` are gone: their only users (the panel and the two options panels) use the per-tab atoms. The renamed defaults keep the same localStorage keys (`lichess-all-options`, `lichess-master-options`).
- `LocalOptions` is used only by `db.ts` and `DatabasePanel`. Every `searchPosition` caller (`DatabasePanel`, `RepertoireInfo`, `repertoire.ts`) passes the v2 `GameQuery` shape.
- `storedReferenceDbAtom` is written only by `DatabasesPage`. `referenceDbAtom` is read by `DatabasePanel` (adopt), `RepertoireInfo` and `ReportModal`.
- Tab removal: `closeTab` is the only path that drops tabs, and it calls `removeDatabaseExplorerState`. I read every other `setTabs(` site: `NewTabHome.tsx:219/234/267`, `BoardsPage.tsx:118/140/227`, `BoardGame.tsx:230/402` and `tabs.ts:131/241`. Each one renames, retypes, reorders or appends.

**Fork file set vs HEAD (merges included).** `git diff --stat 9654961d yason -- src` lists 34 files. Every one is still in the fork's delta `git diff v0.16.1 HEAD -- src`, except `RepertoireInfo.tsx`. That file equals upstream at HEAD, and its fork behaviour (abort, stale-result guard) is covered by upstream's version, see below. `OpeningsPanel.tsx` is new from upstream. Nothing from the merge commits `86bde64a`, `6f5d29bb` and `c187c474` is missing from that set.

**Fork commits vs HEAD (`git log 9654961d..yason`).**

- `a0d22ee8` (RatingsPanel date parsing): superseded. Upstream now parses `"YYYY-MM-DD"` strictly, and the DuckDB backend emits exactly that (`strftime(utc_timestamp, '%Y-%m-%d')`, `db/mod.rs:1143`).
- `da1129e8` (coverage CPU): `dbMovesCache` and the `compute` logic are kept; abort comes from upstream. See finding 2.
- `79e9dbee` (ImportModal save-to-collection, `files.ts` basename names, `treeReducer` `"?"` event): all present at HEAD.
- `06e75680` (remove from recent files): `NewTabHome.tsx`, its CSS and all 16 locales are present.
- `1208e011`, `d3065ec7`, `53e762ae` (docs, agent config, wishlist, notes image): present.
- `66fd2510` / `fb181261` (spec, plan): present.
- `cddf5ad3`, `74ef24b8`, `3596c206` (per-tab state, isolation, lifecycle): re-ported. Duplicate copies the state, close removes it, the options panels are per-tab, `NoDatabaseWarning` uses the new keys.
- `790c66dc` / `55203564` (exact/partial resync): removed with upstream's toggle, as item 4 intends.
- `2d740ea3` (search cache keyed by path): superseded. Upstream's `position_cache(&state, &file)` is per file (`search.rs:48-54`), and its key includes the filter SQL.
- `71b0b5fc` (open connections on demand): superseded. `get_or_create_database_pool` opens a pool lazily for any path. The side effect for missing files is finding 1.

**Translations (diffed).** In fr-FR, tr-TR, de-DE and it-IT, HEAD is exactly v0.16.1 plus the fork's hunks: the three `Board.Database.*` keys replace `NoReference1-3`/`SelectReference`, and `RemoveFromList` is added. No upstream text is overwritten and no fork key is lost. In these four locales the three `Board.Database.*` keys were already `""` in `yason`. `Home.RecentFiles.RemoveFromList` was missing from fr-FR, de-DE and it-IT in `yason`, and the merge adds it there as `""`, so those locales now fall back to en-US like the rest. No code still uses `NoReference*` or `SelectReference`.

## Not checked

- Anything that needs the running app: real effect timing, the database-delete scenario, the coverage holes on a real repertoire.
- Whether DuckDB's `next_move_at_fen` ever yields the `"*"` summary row that `repertoire.ts` looks for. `search_position` filters `next_move IS NOT NULL`, so `gamesEndingHere` may always be 0. That is upstream behaviour, outside this merge.
