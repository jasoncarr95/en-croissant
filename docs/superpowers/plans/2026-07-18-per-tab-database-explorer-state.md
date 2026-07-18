# Per-Tab Database Explorer State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every analysis tab retain an independent database-explorer source, selected Local database, filters, and sub-tab while preserving application-wide defaults and guaranteeing that Rust searches use the mmap index belonging to the requested database.

**Architecture:** Add a focused Jotai state module containing tab-keyed explorer working copies plus explicit initialize, copy, and remove operations. Keep the existing persisted atoms as defaults for future tab initialization. Change the Rust cache from an unkeyed mapping to one path-tagged mapping shared by search, membership checks, and reference-database preload. Cut the database panel over only after the backend no longer relies on selector-triggered invalidation.

**Tech Stack:** React 19, TypeScript, Jotai, SWR, Vitest/jsdom, Tauri 2, Rust, mmap/rkyv, pnpm.

## Global Constraints

- Implement against the latest `upstream/master`, not the personal fork's documentation commits. Keep the design and plan commits out of an upstream code pull request unless the maintainer asks for them.
- Before editing code, run:

  ```bash
  git fetch upstream
  gh pr view 795 --repo franciscoBSalgueiro/en-croissant --json state,isDraft,mergedAt,url
  ```

  Expected on 2026-07-18: PR #795 is open and draft. If it has merged and removed the mmap cache, stop and rewrite Task 1 for the merged database layer; do not reintroduce the old cache.
- Preserve `referenceDbAtom` as the global default used by reports, repertoire features, and startup preload. The database selector inside an analysis tab must never write it.
- Preserve storage keys `lichess-all-options` and `lichess-master-options` so existing preferences migrate without user action.
- Do not persist per-tab working copies across application restarts. Restored tabs use the latest persisted defaults when the Database panel first mounts.
- Do not add an LRU or multi-index mmap cache. One mapping remains retained; a replaced mapping may remain alive only while an in-flight search holds its existing `Arc` clone.
- Keep SWR keys value-based; do not add the analysis-tab ID. Identical queries across tabs must still deduplicate. Closing a tab releases its Jotai working state but does not introduce a new SWR eviction policy.
- Keep the existing Rust `line_cache` keyed by `(GameQuery, PathBuf)` unchanged. The fix prevents wrong-index reuse; it does not add result-cache eviction. Call out that distinct per-tab queries can increase existing result-cache cardinality.
- Do not edit `src/bindings/generated.ts`; this change does not alter Tauri command signatures.
- Follow red-green-refactor for each behavior. Run the named failing test before implementation, then the same test after implementation.
- Use `pnpm` commands from `AGENTS.md`. The checked environment is Node v24.15.0, pnpm 11.13.1, and Rust 1.97.1.
- Commit after each task with the listed focused commit. Do not stage unrelated files from the user's worktree.

## File Responsibility Map

- `src/state/databaseExplorer.ts`: owns transient explorer working state keyed by analysis-tab ID and the only explicit initialize/copy/remove lifecycle operations.
- `src/state/atoms.ts`: continues to own application-wide persisted defaults; it no longer owns active explorer working state.
- `src/components/panels/database/DatabasePanel.tsx`: renders and queries from only the active tab's working state.
- `src/components/panels/database/options/*.tsx`: edits only the active tab's working filters.
- `src/components/tabs/BoardsPage.tsx`: tells the explorer state module when a tab is duplicated or actually closed.
- `src-tauri/src/db/search.rs`: validates, opens, and selects the mmap index that matches the requested database path.
- `src-tauri/src/main.rs`: retains one path-tagged mmap cache entry in application state.
- `src-tauri/src/db/mod.rs`: delegates reference preload to the same path-aware search-index loader.
- `src/state/tests/databaseExplorer.test.ts`: verifies frontend ownership, initialization, cloning, cleanup, and exact/partial FEN rules without rendering React.

---

## Task 1: Make the Rust mmap cache path-aware

**Files:**

- Modify: `src-tauri/src/main.rs:75-90`
- Modify: `src-tauri/src/db/search.rs:1-30,250-310,480-535,560-end`
- Modify: `src-tauri/src/db/mod.rs:1898-1930`

**Interfaces:**

- Consumes: `get_index_path(&Path) -> PathBuf`, `MmapSearchIndex::is_valid`, `MmapSearchIndex::open`, and `generate_search_index` from the existing Rust database layer.
- Produces: `get_or_load_search_index(file: &Path, state: &tauri::State<'_, AppState>) -> Result<MmapSearchIndex, Error>` and `AppState.db_cache: Mutex<Option<(PathBuf, MmapSearchIndex)>>` for all Local search consumers.

### 1.1 Add the failing cache identity test

- [ ] In `src-tauri/src/db/search.rs`, extend the existing `#[cfg(test)] mod tests` with a helper that writes a distinguishable index:

  ```rust
  use tempfile::tempdir;

  fn write_test_index(path: &Path, ids: &[i32]) {
      let entries = ids
          .iter()
          .map(|id| SearchGameEntry {
              id: *id,
              white_id: 1,
              black_id: 2,
              date: None,
              result: GameResult::Draw,
              pawn_home: 0,
              white_material: 0,
              black_material: 0,
              white_elo: 0,
              black_elo: 0,
              fen: None,
              moves: vec![],
          })
          .collect();
      SearchIndex { entries }.write_to(path).unwrap();
  }
  ```

- [ ] Add these imports inside the test module, then add the test:

  ```rust
  use crate::db::search_index::{SearchGameEntry, SearchIndex};
  use std::path::Path;
  ```

  ```rust
  #[test]
  fn mmap_cache_reloads_when_the_index_path_changes() {
      let dir = tempdir().unwrap();
      let a_path = dir.path().join("a.ecsi");
      let b_path = dir.path().join("b.ecsi");
      write_test_index(&a_path, &[1]);
      write_test_index(&b_path, &[2, 3]);

      let cache = Mutex::new(None);
      let a = get_or_open_search_index(&cache, &a_path).unwrap();
      let b = get_or_open_search_index(&cache, &b_path).unwrap();
      let a_again = get_or_open_search_index(&cache, &a_path).unwrap();

      assert_eq!(a.len(), 1);
      assert_eq!(b.len(), 2);
      assert_eq!(a_again.len(), 1);
      assert_eq!(a.get_entry_ref(0).unwrap().id, 1);
      let cached_path = cache.lock().unwrap().as_ref().unwrap().0.clone();
      assert_eq!(cached_path, a_path);
  }
  ```

  The assertion against `a` after loading `b` proves replacement does not invalidate an in-flight clone.

- [ ] Run the focused test:

  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml mmap_cache_reloads_when_the_index_path_changes
  ```

  Expected: compilation fails because `get_or_open_search_index` does not exist and the cache type cannot yet be inferred as the path-tagged tuple.

### 1.2 Implement one path-tagged cache entry

- [ ] In `src-tauri/src/main.rs`, change `AppState.db_cache` to:

  ```rust
  db_cache: Mutex<Option<(PathBuf, MmapSearchIndex)>>,
  ```

- [ ] In `src-tauri/src/db/search.rs`, import `Path` alongside `PathBuf` and add the pure cache helper near the position-search functions:

  ```rust
  fn get_or_open_search_index(
      cache: &Mutex<Option<(PathBuf, MmapSearchIndex)>>,
      index_path: &Path,
  ) -> std::io::Result<MmapSearchIndex> {
      let mut cache = cache.lock().unwrap();

      if let Some((cached_path, index)) = cache.as_ref() {
          if cached_path == index_path {
              return Ok(index.clone());
          }
      }

      let index = MmapSearchIndex::open(index_path)?;
      *cache = Some((index_path.to_path_buf(), index.clone()));
      Ok(index)
  }
  ```

- [ ] Add one wrapper that retains the existing validate/generate behavior and is visible to the parent `db` module:

  ```rust
  pub(super) fn get_or_load_search_index(
      file: &Path,
      state: &tauri::State<'_, AppState>,
  ) -> Result<MmapSearchIndex, Error> {
      let index_path = get_index_path(file);

      if !MmapSearchIndex::is_valid(&index_path) {
          info!("Search index not found, generating automatically...");
          super::generate_search_index(file, state).map_err(|error| {
              Error::from(std::io::Error::other(format!(
                  "Failed to generate search index: {error}"
              )))
          })?;
      }

      get_or_open_search_index(&state.db_cache, &index_path).map_err(Error::from)
  }
  ```

- [ ] Replace both duplicated cache blocks in `search_position` and `is_position_in_db` with:

  ```rust
  let mmap_index = get_or_load_search_index(&file, &state)?;
  ```

  Keep the existing semaphore permit, timing logs, `line_cache`, and collision locking unchanged.

- [ ] In `src-tauri/src/db/mod.rs`, keep `clear_games` assigning `None`; the tuple type requires no other change there. Replace `preload_reference_db`'s open-if-empty block with:

  ```rust
  search::get_or_load_search_index(&file, &state)?;
  Ok(())
  ```

  This makes preload obey path identity instead of treating any populated mapping as the requested reference database.

### 1.3 Verify cache correctness and formatting

- [ ] Run:

  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml mmap_cache_reloads_when_the_index_path_changes
  cargo test --manifest-path src-tauri/Cargo.toml db::search
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  ```

  Expected: the focused identity test passes, all `db::search` tests pass, and Rust formatting reports no diff.

- [ ] Inspect the replacement logic for the bounded-memory contract:

  ```bash
  rg -n "db_cache|MmapSearchIndex::open|get_or_load_search_index" src-tauri/src/main.rs src-tauri/src/db
  ```

  Expected: all search/preload application-state reads are path-aware; there is still exactly one `Option<(PathBuf, MmapSearchIndex)>` cache entry; the only production open that populates this cache is inside the helper. Independent `search_index.rs` unit tests may still call `MmapSearchIndex::open` directly.

### 1.4 Commit

- [ ] Stage only the three Rust files and commit:

  ```bash
  git add src-tauri/src/main.rs src-tauri/src/db/search.rs src-tauri/src/db/mod.rs
  git commit -m "fix: key database search cache by path"
  ```

---

## Task 2: Add tab-scoped explorer working state and defaults

**Files:**

- Create: `src/state/databaseExplorer.ts`
- Create: `src/state/tests/databaseExplorer.test.ts`
- Modify: `src/state/atoms.ts:15-25,380-420`
- Modify: `src/utils/db.ts:1-30,160-185`
- Modify: `src/utils/repertoire.ts:1-5`
- Modify: `src/components/panels/database/DatabasePanel.tsx:35-70` only for the `LocalOptions` type move

**Interfaces:**

- Consumes: `activeTabAtom`, `referenceDbAtom`, and the two persisted default atoms from `src/state/atoms.ts`.
- Produces: the `LocalOptions` type in `src/utils/db.ts`; current working atoms; `initializeDatabaseExplorerStateAtom`; `setCurrentLocalDatabaseAtom`; and `syncCurrentLocalFenAtom` for Task 3.

### 2.1 Move the Local options type out of the component

- [ ] Define and export `LocalOptions` beside the database utilities in `src/utils/db.ts`:

  ```ts
  export type LocalOptions = {
    path: string | null;
    fen: string;
    type: "exact" | "partial";
    player: number | null;
    color: "white" | "black";
    start_date?: string;
    end_date?: string;
    result: "any" | "whitewon" | "draw" | "blackwon";
  };
  ```

- [ ] Remove `import type { LocalOptions } from "@/components/panels/database/DatabasePanel";` from both utility files, delete the type declaration from `DatabasePanel.tsx`, and use these exact replacements:

  ```ts
  // src/state/atoms.ts and src/utils/repertoire.ts
  import type { LocalOptions } from "@/utils/db";

  // src/components/panels/database/DatabasePanel.tsx
  import { getDatabases, type LocalOptions, type Opening, searchPosition } from "@/utils/db";
  ```

  `src/utils/db.ts` uses its locally declared exported type and therefore needs no `LocalOptions` import. This removes the state/utilities-to-React-component dependency before adding the new state module.

### 2.2 Make the persisted atoms explicitly defaults

- [ ] In `src/state/atoms.ts`, rename the exports while preserving their storage keys and schemas:

  ```ts
  export const lichessOptionsDefaultsAtom = atomWithStorage<LichessGamesOptions>(
    "lichess-all-options",
    {
      ratings: [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500],
      speeds: ["bullet", "blitz", "rapid", "classical", "correspondence"],
      color: "white",
    },
    createZodStorage(lichessGamesOptionsSchema, localStorage),
    { getOnInit: true },
  );

  export const masterOptionsDefaultsAtom = atomWithStorage<MasterGamesOptions>(
    "lichess-master-options",
    {},
    createZodStorage(masterOptionsSchema, localStorage),
    { getOnInit: true },
  );
  ```

- [ ] For this intermediate commit only, keep source-compatible aliases so existing panels continue to build:

  ```ts
  export const lichessOptionsAtom = lichessOptionsDefaultsAtom;
  export const masterOptionsAtom = masterOptionsDefaultsAtom;
  ```

  Task 3 removes these aliases after every explorer consumer uses tab-scoped state.

### 2.3 Write failing independent-state tests

- [ ] Create the test directory:

  ```bash
  mkdir -p src/state/tests
  ```

  Expected: `src/state/tests` exists and no application source file changes.

- [ ] Create `src/state/tests/databaseExplorer.test.ts` with this complete initial suite:

  ```ts
  import { createStore } from "jotai/vanilla";
  import { beforeEach, describe, expect, it } from "vitest";
  import {
    activeTabAtom,
    lichessOptionsDefaultsAtom,
    masterOptionsDefaultsAtom,
    referenceDbAtom,
  } from "@/state/atoms";
  import {
    currentDbTabAtom,
    currentDbTypeAtom,
    currentLichessOptionsAtom,
    currentLocalOptionsAtom,
    currentMasterOptionsAtom,
    initializeDatabaseExplorerStateAtom,
    setCurrentLocalDatabaseAtom,
    syncCurrentLocalFenAtom,
  } from "@/state/databaseExplorer";

  type TestStore = ReturnType<typeof createStore>;

  const selectTab = (store: TestStore, tabId: string) => {
    store.set(activeTabAtom, tabId);
  };

  const initializeTab = (store: TestStore, tabId: string) => {
    store.set(initializeDatabaseExplorerStateAtom, tabId);
  };

  describe("database explorer tab state", () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it("keeps initialized analysis tabs independent", () => {
      const store = createStore();
      const mastersSince = new Date("2000-01-01T00:00:00.000Z");
      const mastersUntil = new Date("2020-01-01T00:00:00.000Z");

      store.set(referenceDbAtom, "/db/reference.db3");
      store.set(lichessOptionsDefaultsAtom, {
        ratings: [1000],
        speeds: ["blitz"],
        color: "white",
      });
      store.set(masterOptionsDefaultsAtom, { since: mastersSince });
      initializeTab(store, "tab-a");
      initializeTab(store, "tab-b");

      selectTab(store, "tab-a");
      store.set(setCurrentLocalDatabaseAtom, "/db/a.db3");
      store.set(currentLocalOptionsAtom, (current) => ({
        ...current,
        player: 11,
        color: "black",
      }));
      store.set(currentDbTypeAtom, "lch_all");
      store.set(currentDbTabAtom, "options");
      store.set(currentLichessOptionsAtom, {
        ratings: [2500],
        speeds: ["classical"],
        color: "black",
      });
      store.set(currentMasterOptionsAtom, (current) => ({
        ...current,
        until: mastersUntil,
      }));

      selectTab(store, "tab-b");
      expect(store.get(currentLocalOptionsAtom)).toMatchObject({
        path: "/db/reference.db3",
        player: null,
        color: "white",
      });
      expect(store.get(currentDbTypeAtom)).toBe("local");
      expect(store.get(currentDbTabAtom)).toBe("stats");
      expect(store.get(currentLichessOptionsAtom)).toEqual({
        ratings: [1000],
        speeds: ["blitz"],
        color: "white",
      });
      expect(store.get(currentMasterOptionsAtom)).toEqual({ since: mastersSince });
      expect(store.get(referenceDbAtom)).toBe("/db/reference.db3");
      expect(store.get(lichessOptionsDefaultsAtom)).toEqual({
        ratings: [2500],
        speeds: ["classical"],
        color: "black",
      });
      expect(store.get(masterOptionsDefaultsAtom)).toEqual({
        since: mastersSince,
        until: mastersUntil,
      });
    });

    it("uses changed defaults only for tabs initialized later", () => {
      const store = createStore();
      const originalSince = new Date("2001-01-01T00:00:00.000Z");
      const futureSince = new Date("2015-01-01T00:00:00.000Z");

      store.set(referenceDbAtom, "/db/a.db3");
      store.set(lichessOptionsDefaultsAtom, { ratings: [1400], color: "white" });
      store.set(masterOptionsDefaultsAtom, { since: originalSince });
      initializeTab(store, "tab-a");

      store.set(referenceDbAtom, "/db/b.db3");
      store.set(lichessOptionsDefaultsAtom, { ratings: [2200], color: "black" });
      store.set(masterOptionsDefaultsAtom, { since: futureSince });
      initializeTab(store, "tab-c");

      selectTab(store, "tab-a");
      expect(store.get(currentLocalOptionsAtom).path).toBe("/db/a.db3");
      expect(store.get(currentLichessOptionsAtom)).toEqual({
        ratings: [1400],
        color: "white",
      });
      expect(store.get(currentMasterOptionsAtom)).toEqual({ since: originalSince });

      selectTab(store, "tab-c");
      expect(store.get(currentLocalOptionsAtom).path).toBe("/db/b.db3");
      expect(store.get(currentLichessOptionsAtom)).toEqual({
        ratings: [2200],
        color: "black",
      });
      expect(store.get(currentMasterOptionsAtom)).toEqual({ since: futureSince });
    });

    it("resets only the active tab player when its database changes", () => {
      const store = createStore();
      initializeTab(store, "tab-a");
      initializeTab(store, "tab-b");

      selectTab(store, "tab-a");
      store.set(setCurrentLocalDatabaseAtom, "/db/a.db3");
      store.set(currentLocalOptionsAtom, (current) => ({ ...current, player: 11 }));

      selectTab(store, "tab-b");
      store.set(setCurrentLocalDatabaseAtom, "/db/b.db3");
      store.set(currentLocalOptionsAtom, (current) => ({ ...current, player: 22 }));

      selectTab(store, "tab-a");
      store.set(setCurrentLocalDatabaseAtom, "/db/a.db3");
      expect(store.get(currentLocalOptionsAtom).player).toBe(11);
      store.set(setCurrentLocalDatabaseAtom, "/db/a-2.db3");
      expect(store.get(currentLocalOptionsAtom).player).toBeNull();

      selectTab(store, "tab-b");
      expect(store.get(currentLocalOptionsAtom)).toMatchObject({
        path: "/db/b.db3",
        player: 22,
      });
    });

    it("syncs board FEN only for exact local queries", () => {
      const store = createStore();
      initializeTab(store, "tab-a");
      selectTab(store, "tab-a");

      store.set(syncCurrentLocalFenAtom, "exact-board-fen");
      expect(store.get(currentLocalOptionsAtom).fen).toBe("exact-board-fen");

      store.set(currentLocalOptionsAtom, (current) => ({
        ...current,
        type: "partial",
        fen: "partial-custom-fen",
      }));
      store.set(syncCurrentLocalFenAtom, "later-board-fen");
      expect(store.get(currentLocalOptionsAtom).fen).toBe("partial-custom-fen");
    });
  });
  ```

- [ ] Run:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  ```

  Expected: the test file fails to resolve `@/state/databaseExplorer` because the module does not exist.

### 2.4 Implement the focused state module

- [ ] Create `src/state/databaseExplorer.ts` with this complete Task 2 implementation. Keep the families private; Task 4 extends this same file with lifecycle actions.

  ```ts
  import { atom, type Getter, type PrimitiveAtom, type SetStateAction } from "jotai";
  import { atomFamily } from "jotai/utils";
  import type { AtomFamily } from "jotai/vanilla/utils/atomFamily";
  import type { LocalOptions } from "@/utils/db";
  import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
  import {
    activeTabAtom,
    lichessOptionsDefaultsAtom,
    masterOptionsDefaultsAtom,
    referenceDbAtom,
  } from "./atoms";

  export type DatabaseSource = "local" | "lch_all" | "lch_master";
  export type DatabasePanelTab = "stats" | "games" | "options";

  const defaultLocalOptions: LocalOptions = {
    path: null,
    type: "exact",
    fen: "",
    player: null,
    color: "white",
    result: "any",
  };

  const localOptionsFamily = atomFamily((_tabId: string) =>
    atom<LocalOptions>({ ...defaultLocalOptions }),
  );
  const lichessOptionsFamily = atomFamily((_tabId: string) =>
    atom<LichessGamesOptions>({ color: "white" }),
  );
  const masterOptionsFamily = atomFamily((_tabId: string) => atom<MasterGamesOptions>({}));
  const dbTypeFamily = atomFamily((_tabId: string) => atom<DatabaseSource>("local"));
  const dbTabFamily = atomFamily((_tabId: string) => atom<DatabasePanelTab>("stats"));
  const initializedFamily = atomFamily((_tabId: string) => atom(false));

  function cloneLichessOptions(options: LichessGamesOptions): LichessGamesOptions {
    return {
      ...options,
      ratings: options.ratings ? [...options.ratings] : undefined,
      speeds: options.speeds ? [...options.speeds] : undefined,
      since: options.since ? new Date(options.since.getTime()) : undefined,
      until: options.until ? new Date(options.until.getTime()) : undefined,
    };
  }

  function cloneMasterOptions(options: MasterGamesOptions): MasterGamesOptions {
    return {
      ...options,
      since: options.since ? new Date(options.since.getTime()) : undefined,
      until: options.until ? new Date(options.until.getTime()) : undefined,
    };
  }

  function requireActiveTabId(get: Getter): string {
    const tabId = get(activeTabAtom);
    if (!tabId) throw new Error("No tab selected");
    return tabId;
  }

  function resolveUpdate<Value>(
    update: SetStateAction<Value>,
    current: Value,
  ): Value {
    return typeof update === "function"
      ? (update as (value: Value) => Value)(current)
      : update;
  }

  function currentFamilyValue<Value>(
    family: AtomFamily<string, PrimitiveAtom<Value>>,
  ) {
    return atom(
      (get) => get(family(requireActiveTabId(get))),
      (get, set, update: SetStateAction<Value>) => {
        const valueAtom = family(requireActiveTabId(get));
        set(valueAtom, resolveUpdate(update, get(valueAtom)));
      },
    );
  }

  export const currentLocalOptionsAtom = currentFamilyValue(localOptionsFamily);
  export const currentDbTypeAtom = currentFamilyValue(dbTypeFamily);
  export const currentDbTabAtom = currentFamilyValue(dbTabFamily);
  export const currentDatabaseExplorerInitializedAtom = currentFamilyValue(initializedFamily);

  export const currentLichessOptionsAtom = atom(
    (get) => get(lichessOptionsFamily(requireActiveTabId(get))),
    (get, set, update: SetStateAction<LichessGamesOptions>) => {
      const valueAtom = lichessOptionsFamily(requireActiveTabId(get));
      const next = resolveUpdate(update, get(valueAtom));
      set(valueAtom, cloneLichessOptions(next));
      set(lichessOptionsDefaultsAtom, cloneLichessOptions(next));
    },
  );

  export const currentMasterOptionsAtom = atom(
    (get) => get(masterOptionsFamily(requireActiveTabId(get))),
    (get, set, update: SetStateAction<MasterGamesOptions>) => {
      const valueAtom = masterOptionsFamily(requireActiveTabId(get));
      const next = resolveUpdate(update, get(valueAtom));
      set(valueAtom, cloneMasterOptions(next));
      set(masterOptionsDefaultsAtom, cloneMasterOptions(next));
    },
  );

  export const initializeDatabaseExplorerStateAtom = atom(
    null,
    (get, set, tabId: string) => {
      if (get(initializedFamily(tabId))) return;

      const local = get(localOptionsFamily(tabId));
      set(localOptionsFamily(tabId), {
        ...local,
        path: local.path ?? get(referenceDbAtom),
      });
      set(
        lichessOptionsFamily(tabId),
        cloneLichessOptions(get(lichessOptionsDefaultsAtom)),
      );
      set(
        masterOptionsFamily(tabId),
        cloneMasterOptions(get(masterOptionsDefaultsAtom)),
      );
      set(initializedFamily(tabId), true);
    },
  );

  export const setCurrentLocalDatabaseAtom = atom(
    null,
    (get, set, path: string | null) => {
      const optionsAtom = localOptionsFamily(requireActiveTabId(get));
      const current = get(optionsAtom);
      if (current.path === path) return;
      set(optionsAtom, { ...current, path, player: null });
    },
  );

  export const syncCurrentLocalFenAtom = atom(null, (get, set, fen: string) => {
    const optionsAtom = localOptionsFamily(requireActiveTabId(get));
    const current = get(optionsAtom);
    if (current.type === "exact" && current.fen !== fen) {
      set(optionsAtom, { ...current, fen });
    }
  });
  ```

### 2.5 Make the state tests green

- [ ] Run:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  pnpm lint
  ```

  Expected: all four new state tests pass and type checking/linting pass while the UI still uses the temporary aliases.

### 2.6 Commit

- [ ] Stage only the state/type/test changes and commit:

  ```bash
  git add src/state/databaseExplorer.ts src/state/tests/databaseExplorer.test.ts src/state/atoms.ts src/utils/db.ts src/utils/repertoire.ts src/components/panels/database/DatabasePanel.tsx
  git commit -m "feat: add tab-scoped database explorer state"
  ```

---

## Task 3: Cut the database panel and option panels over to tab state

**Files:**

- Modify: `src/components/panels/database/DatabasePanel.tsx`
- Modify: `src/components/panels/database/NoDatabaseWarning.tsx`
- Modify: `src/components/panels/database/options/LocalOptionsPanel.tsx`
- Modify: `src/components/panels/database/options/LichessOptionsPanel.tsx`
- Modify: `src/components/panels/database/options/MastersOptionsPanel.tsx`
- Modify: `src/state/atoms.ts`
- Modify: `src/translation/en-US.json`
- Modify through extraction: `src/translation/*.json`

**Interfaces:**

- Consumes: all current working atoms and initialize/mutation actions produced by Task 2; the path-aware Local search behavior produced by Task 1.
- Produces: `canQueryDatabaseExplorer(...) -> boolean`; a `DatabasePanel` whose SWR key and controls are derived only from the active tab; three tab-scoped option panels; exact-only board-FEN synchronization; and current-tab empty-state copy.

### 3.1 Add a failing UI query-gate test

- [ ] Add `canQueryDatabaseExplorer` and `currentDatabaseExplorerInitializedAtom` to the existing database-explorer test imports and append these complete tests inside the existing `describe` block:

  ```ts
  it("queries only an initialized, visible, usable explorer", () => {
    expect(
      canQueryDatabaseExplorer({
        initialized: false,
        panel: "stats",
        source: "local",
        localPath: "/db/a.db3",
        missingExplorerToken: false,
      }),
    ).toBe(false);
    expect(
      canQueryDatabaseExplorer({
        initialized: true,
        panel: "options",
        source: "local",
        localPath: "/db/a.db3",
        missingExplorerToken: false,
      }),
    ).toBe(false);
    expect(
      canQueryDatabaseExplorer({
        initialized: true,
        panel: "stats",
        source: "local",
        localPath: null,
        missingExplorerToken: false,
      }),
    ).toBe(false);
    expect(
      canQueryDatabaseExplorer({
        initialized: true,
        panel: "games",
        source: "lch_all",
        localPath: null,
        missingExplorerToken: true,
      }),
    ).toBe(false);
    expect(
      canQueryDatabaseExplorer({
        initialized: true,
        panel: "games",
        source: "lch_master",
        localPath: null,
        missingExplorerToken: false,
      }),
    ).toBe(true);
  });

  it("marks initialization only after every default is copied", () => {
    const store = createStore();
    const since = new Date("2012-01-01T00:00:00.000Z");
    selectTab(store, "tab-a");
    store.set(referenceDbAtom, "/db/default.db3");
    store.set(lichessOptionsDefaultsAtom, { ratings: [1800], color: "black" });
    store.set(masterOptionsDefaultsAtom, { since });

    expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(false);
    initializeTab(store, "tab-a");

    expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(true);
    expect(store.get(currentLocalOptionsAtom).path).toBe("/db/default.db3");
    expect(store.get(currentLichessOptionsAtom)).toEqual({
      ratings: [1800],
      color: "black",
    });
    expect(store.get(currentMasterOptionsAtom)).toEqual({ since });
  });
  ```

  This locks the atomic initialization contract that `DatabasePanel` uses to suppress its SWR request.

- [ ] Run:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  ```

  Expected: FAIL because `canQueryDatabaseExplorer` is not exported. The initialization-order assertion should already pass; if it fails, reorder Task 2's default writes before the initialized marker.

- [ ] Add this pure helper to `src/state/databaseExplorer.ts` after the two exported string-union types:

  ```ts
  export function canQueryDatabaseExplorer(input: {
    initialized: boolean;
    panel: DatabasePanelTab;
    source: DatabaseSource;
    localPath: string | null;
    missingExplorerToken: boolean;
  }): boolean {
    return (
      input.initialized &&
      input.panel !== "options" &&
      !input.missingExplorerToken &&
      (input.source !== "local" || Boolean(input.localPath))
    );
  }
  ```

- [ ] Run the focused test again:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  ```

  Expected: all six tests present through Task 3 pass, including every query-gate assertion.

### 3.2 Initialize once per Database-panel tab

- [ ] In `DatabasePanel.tsx`, replace the Jotai and state imports with these complete imports. Remove `import { commands } from "@/bindings";` entirely because the selector was its only consumer.

  ```ts
  import { useAtom, useAtomValue, useSetAtom } from "jotai";
  import { currentTabAtom, sessionsAtom } from "@/state/atoms";
  import {
    canQueryDatabaseExplorer,
    type DatabaseSource,
    currentDatabaseExplorerInitializedAtom,
    currentDbTabAtom,
    currentDbTypeAtom,
    currentLichessOptionsAtom,
    currentLocalOptionsAtom,
    currentMasterOptionsAtom,
    initializeDatabaseExplorerStateAtom,
    setCurrentLocalDatabaseAtom,
    syncCurrentLocalFenAtom,
  } from "@/state/databaseExplorer";
  ```

- [ ] Replace the existing DatabasePanel state declarations and both synchronization effects with this block immediately after `const { t } = useTranslation();`:

  ```ts
  const treeStore = useContext(TreeStateContext)!;
  const fen = useStore(treeStore, (state) => state.currentNode().fen);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const sessions = useAtomValue(sessionsAtom);
  const tab = useAtomValue(currentTabAtom);
  const tabId = tab?.value ?? null;

  const initialized = useAtomValue(currentDatabaseExplorerInitializedAtom);
  const lichessOptions = useAtomValue(currentLichessOptionsAtom);
  const masterOptions = useAtomValue(currentMasterOptionsAtom);
  const localOptions = useAtomValue(currentLocalOptionsAtom);
  const [db, setDb] = useAtom(currentDbTypeAtom);
  const [tabType, setTabType] = useAtom(currentDbTabAtom);

  const initializeExplorer = useSetAtom(initializeDatabaseExplorerStateAtom);
  const setLocalDatabase = useSetAtom(setCurrentLocalDatabaseAtom);
  const syncLocalFen = useSetAtom(syncCurrentLocalFenAtom);

  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const missingExplorerToken = db !== "local" && !explorerToken;

  const { data: databases } = useSWR(db === "local" ? "databases" : null, () =>
    getDatabases(),
  );

  const dbSelectData = (databases ?? [])
    .filter((database) => database.type === "success")
    .map((database) => ({
      value: database.file,
      label: database.title || database.filename,
    }));

  useEffect(() => {
    if (tabId && !initialized) initializeExplorer(tabId);
  }, [tabId, initialized, initializeExplorer]);

  useEffect(() => {
    if (db === "local") syncLocalFen(debouncedFen);
  }, [db, debouncedFen, syncLocalFen]);
  ```

  Delete the old duplicated declarations and the effects that wrote `fen` unconditionally and copied `referenceDbAtom` into Local options. The action's exact-mode guard is the fix for the partial-position reset described in upstream issue #185.

### 3.3 Bind the selector and requests to current-tab values

- [ ] Use `currentLichessOptionsAtom`, `currentMasterOptionsAtom`, `currentLocalOptionsAtom`, `currentDbTypeAtom`, and `currentDbTabAtom` for all reads and writes.

- [ ] Bind the Local selector to the working path and remove cache clearing/global writes:

  ```tsx
  <Select
    data={dbSelectData}
    value={localOptions.path}
    onChange={setLocalDatabase}
    placeholder={t("Board.Database.SelectDatabase")}
    size="sm"
    flex={1}
    maw={200}
    allowDeselect={false}
  />
  ```

  `setLocalDatabase` is the value returned by `useSetAtom(setCurrentLocalDatabaseAtom)`. There must be no `commands.clearGames()` call and no `setReferenceDatabase()` call in this component.

- [ ] Gate SWR so Local never queries a missing path and no source queries before initialization:

  ```ts
  const canQuery = canQueryDatabaseExplorer({
    initialized,
    panel: tabType,
    source: db,
    localPath: localOptions.path,
    missingExplorerToken,
  });

  const {
    data: openingData,
    isLoading,
    error,
  } = useSWR(canQuery ? dbType : null, async (currentDbType: DBType) => {
    return fetchOpening(currentDbType, tabId ?? "");
  });
  ```

  Keep `dbType` in the key so SWR caching remains value-based and includes Local path or online filters. Do not add background fetches or per-tab persistence.

### 3.4 Update error and empty-state behavior

- [ ] Add this prop to each of the three `PanelWithError` calls (`stats`, `games`, and `options`):

  ```ts
  missingLocalDatabase={dbType.type === "local" && !dbType.options.path}
  ```

- [ ] Replace the complete `PanelWithError` function with:

  ```tsx
  function PanelWithError(props: {
    value: string;
    error: unknown;
    type: DatabaseSource;
    header: React.ReactNode;
    children: React.ReactNode;
    missingExplorerToken: boolean;
    missingLocalDatabase: boolean;
  }) {
    const { t } = useTranslation();
    let children = props.children;

    if (props.missingLocalDatabase) {
      children = <NoDatabaseWarning />;
    } else if (props.missingExplorerToken && props.type !== "local") {
      children = (
        <Alert color="yellow">
          {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
          {t("Board.Database.ExplorerAuthRequired2")}
        </Alert>
      );
    } else if (props.error) {
      children = <Alert color="red">{String(props.error)}</Alert>;
    }

    return (
      <Tabs.Panel
        py="xs"
        px="sm"
        value={props.value}
        flex={1}
        style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        {props.header}
        {children}
      </Tabs.Panel>
    );
  }
  ```

  Import `DatabaseSource` as a type from `@/state/databaseExplorer`. The `else if` ordering prevents a missing-path panel from being overwritten by a stale request error and makes Local query errors visible when a path exists.

- [ ] Replace `NoDatabaseWarning.tsx` with this complete file:

  ```tsx
  import { Text } from "@mantine/core";
  import { Link } from "@tanstack/react-router";
  import { useTranslation } from "react-i18next";

  function NoDatabaseWarning() {
    const { t } = useTranslation();

    return (
      <>
        <Text>{t("Board.Database.NoSelection")}</Text>
        <Text>
          <Link to="/databases">{t("Board.Database.AddDatabase")}</Link>
        </Text>
      </>
    );
  }

  export default NoDatabaseWarning;
  ```

- [ ] Add these English strings:

  ```json
  "Board.Database.AddDatabase": "Add a database",
  "Board.Database.NoSelection": "No database selected for this tab.",
  "Board.Database.SelectDatabase": "Select a database"
  ```

- [ ] Run extraction rather than hand-editing the other locales:

  ```bash
  pnpm i18n:extract
  ```

  Expected: the three obsolete `NoReference*` keys and `SelectReference` disappear because their two consumers were replaced. The three new keys retain the exact English values above in `en-US` and are added to every configured locale for later translation. Do not run `pnpm i18n:types`: current `upstream/master` does not track its configured output files, and adding them would broaden this fix.

### 3.5 Cut the option panels over and remove legacy state

- [ ] Replace the explorer-state import in each option panel with its exact tab-scoped import:

  ```ts
  // LocalOptionsPanel.tsx
  import { currentLocalOptionsAtom } from "@/state/databaseExplorer";

  // LichessOptionsPanel.tsx
  import { currentLichessOptionsAtom } from "@/state/databaseExplorer";

  // MastersOptionsPanel.tsx
  import { currentMasterOptionsAtom } from "@/state/databaseExplorer";
  ```

- [ ] In `src/state/atoms.ts`, delete the old `localOptionsFamily`, `currentLocalOptionsAtom`, `dbTypeFamily`, `currentDbTypeAtom`, `dbTabFamily`, `currentDbTabAtom`, the two temporary aliases, and the now-unused `LocalOptions` import. The database-explorer portion left in this file must be exactly the two persisted defaults:

  ```ts
  export const lichessOptionsDefaultsAtom = atomWithStorage<LichessGamesOptions>(
    "lichess-all-options",
    {
      ratings: [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500],
      speeds: ["bullet", "blitz", "rapid", "classical", "correspondence"],
      color: "white",
    },
    createZodStorage(lichessGamesOptionsSchema, localStorage),
    { getOnInit: true },
  );

  export const masterOptionsDefaultsAtom = atomWithStorage<MasterGamesOptions>(
    "lichess-master-options",
    {},
    createZodStorage(masterOptionsSchema, localStorage),
    { getOnInit: true },
  );
  ```

- [ ] Confirm global consumers remain global:

  ```bash
  rg -n "referenceDbAtom" src/App.tsx src/components/databases src/components/panels/analysis src/components/panels/practice
  rg -n "lichessOptionsAtom|masterOptionsAtom|currentLocalOptionsAtom|currentDbTypeAtom|currentDbTabAtom" src
  ```

  Expected: reports, repertoire, Databases page, and startup still use `referenceDbAtom`; all old explorer atom names are absent from `src/state/atoms.ts` and consumers import current working atoms only from `databaseExplorer.ts`.

### 3.6 Verify and commit

- [ ] Run:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  pnpm lint
  pnpm i18n:extract --ci
  ```

  Expected: state tests pass, TypeScript/lint pass, and translations are fully extracted.

- [ ] Stage only Task 3 files and commit:

  ```bash
  git add src/components/panels/database/DatabasePanel.tsx src/components/panels/database/NoDatabaseWarning.tsx src/components/panels/database/options/LocalOptionsPanel.tsx src/components/panels/database/options/LichessOptionsPanel.tsx src/components/panels/database/options/MastersOptionsPanel.tsx src/state/atoms.ts src/state/tests/databaseExplorer.test.ts src/translation/*.json
  git commit -m "fix: isolate database explorer options by tab"
  ```

---

## Task 4: Copy explorer state on duplicate and release it on close

**Files:**

- Modify: `src/state/databaseExplorer.ts`
- Modify: `src/state/tests/databaseExplorer.test.ts`
- Modify: `src/components/tabs/BoardsPage.tsx:1-135`

**Interfaces:**

- Consumes: the six private atom families and cloning functions created in Task 2; explicit source/target tab IDs from `BoardsPage`.
- Produces: `copyDatabaseExplorerStateAtom` with `{ sourceTabId: string; targetTabId: string }` input and `removeDatabaseExplorerStateAtom` with `string` input.

### 4.1 Write failing lifecycle tests

- [ ] Add `copyDatabaseExplorerStateAtom` and `removeDatabaseExplorerStateAtom` to the existing imports from `@/state/databaseExplorer`, then append these complete tests inside the existing `describe` block:

  ```ts
  it("copies an initialized explorer into an independently mutable duplicate", () => {
    const store = createStore();
    const lichessSince = new Date("2010-01-01T00:00:00.000Z");
    const mastersSince = new Date("1990-01-01T00:00:00.000Z");
    initializeTab(store, "source");
    selectTab(store, "source");
    store.set(setCurrentLocalDatabaseAtom, "/db/source.db3");
    store.set(currentLocalOptionsAtom, (current) => ({ ...current, player: 44 }));
    store.set(currentDbTypeAtom, "lch_all");
    store.set(currentDbTabAtom, "games");
    store.set(currentLichessOptionsAtom, {
      ratings: [2000, 2200],
      speeds: ["rapid"],
      color: "black",
      since: lichessSince,
    });
    store.set(currentMasterOptionsAtom, { since: mastersSince });

    const sourceLichess = store.get(currentLichessOptionsAtom);
    const sourceMaster = store.get(currentMasterOptionsAtom);
    store.set(copyDatabaseExplorerStateAtom, {
      sourceTabId: "source",
      targetTabId: "duplicate",
    });

    selectTab(store, "duplicate");
    const duplicateLichess = store.get(currentLichessOptionsAtom);
    const duplicateMaster = store.get(currentMasterOptionsAtom);
    expect(store.get(currentLocalOptionsAtom)).toMatchObject({
      path: "/db/source.db3",
      player: 44,
    });
    expect(store.get(currentDbTypeAtom)).toBe("lch_all");
    expect(store.get(currentDbTabAtom)).toBe("games");
    expect(duplicateLichess).toEqual(sourceLichess);
    expect(duplicateLichess.ratings).not.toBe(sourceLichess.ratings);
    expect(duplicateLichess.since).not.toBe(sourceLichess.since);
    expect(duplicateMaster).toEqual(sourceMaster);
    expect(duplicateMaster.since).not.toBe(sourceMaster.since);

    store.set(setCurrentLocalDatabaseAtom, "/db/duplicate.db3");
    store.set(currentDbTypeAtom, "lch_master");
    store.set(currentDbTabAtom, "options");
    store.set(currentLichessOptionsAtom, {
      ratings: [2500],
      speeds: ["classical"],
      color: "white",
    });
    store.set(currentMasterOptionsAtom, {
      since: new Date("2000-01-01T00:00:00.000Z"),
    });

    selectTab(store, "source");
    expect(store.get(currentLocalOptionsAtom)).toMatchObject({
      path: "/db/source.db3",
      player: 44,
    });
    expect(store.get(currentDbTypeAtom)).toBe("lch_all");
    expect(store.get(currentDbTabAtom)).toBe("games");
    expect(store.get(currentLichessOptionsAtom)).toEqual(sourceLichess);
    expect(store.get(currentMasterOptionsAtom)).toEqual(sourceMaster);
  });

  it("leaves a duplicate uninitialized when the source explorer was never opened", () => {
    const store = createStore();
    store.set(copyDatabaseExplorerStateAtom, {
      sourceTabId: "source",
      targetTabId: "duplicate",
    });
    selectTab(store, "duplicate");
    expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(false);
  });

  it("removes closed-tab explorer state", () => {
    const store = createStore();
    initializeTab(store, "tab-a");
    selectTab(store, "tab-a");
    store.set(setCurrentLocalDatabaseAtom, "/db/stale.db3");
    store.set(currentDbTypeAtom, "lch_master");
    store.set(currentDbTabAtom, "options");
    store.set(currentLichessOptionsAtom, { ratings: [1000], color: "white" });
    store.set(removeDatabaseExplorerStateAtom, "tab-a");

    store.set(referenceDbAtom, "/db/fresh.db3");
    store.set(lichessOptionsDefaultsAtom, { ratings: [2500], color: "black" });
    store.set(masterOptionsDefaultsAtom, {
      since: new Date("2018-01-01T00:00:00.000Z"),
    });
    initializeTab(store, "tab-a");

    expect(store.get(currentLocalOptionsAtom)).toMatchObject({
      path: "/db/fresh.db3",
      player: null,
      type: "exact",
    });
    expect(store.get(currentDbTypeAtom)).toBe("local");
    expect(store.get(currentDbTabAtom)).toBe("stats");
    expect(store.get(currentLichessOptionsAtom)).toEqual({
      ratings: [2500],
      color: "black",
    });
  });
  ```

- [ ] Run:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  ```

  Expected: tests fail because copy/remove actions are not exported.

### 4.2 Implement copy and cleanup actions

- [ ] Append this complete lifecycle implementation to `databaseExplorer.ts` after `syncCurrentLocalFenAtom`:

  ```ts
  function removeDatabaseExplorerState(tabId: string) {
    localOptionsFamily.remove(tabId);
    lichessOptionsFamily.remove(tabId);
    masterOptionsFamily.remove(tabId);
    dbTypeFamily.remove(tabId);
    dbTabFamily.remove(tabId);
    initializedFamily.remove(tabId);
  }

  export const removeDatabaseExplorerStateAtom = atom(
    null,
    (_get, _set, tabId: string) => {
      removeDatabaseExplorerState(tabId);
    },
  );

  export const copyDatabaseExplorerStateAtom = atom(
    null,
    (get, set, ids: { sourceTabId: string; targetTabId: string }) => {
      removeDatabaseExplorerState(ids.targetTabId);
      if (!get(initializedFamily(ids.sourceTabId))) return;

      set(
        localOptionsFamily(ids.targetTabId),
        { ...get(localOptionsFamily(ids.sourceTabId)) },
      );
      set(
        lichessOptionsFamily(ids.targetTabId),
        cloneLichessOptions(get(lichessOptionsFamily(ids.sourceTabId))),
      );
      set(
        masterOptionsFamily(ids.targetTabId),
        cloneMasterOptions(get(masterOptionsFamily(ids.sourceTabId))),
      );
      set(dbTypeFamily(ids.targetTabId), get(dbTypeFamily(ids.sourceTabId)));
      set(dbTabFamily(ids.targetTabId), get(dbTabFamily(ids.sourceTabId)));
      set(initializedFamily(ids.targetTabId), true);
    },
  );
  ```

  Do not write the persisted default atoms during copy. Duplicating a tab copies working state only.

### 4.3 Wire lifecycle operations into BoardsPage

- [ ] Replace the Jotai import and add the explorer lifecycle import:

  ```ts
  import { useAtom, useAtomValue, useSetAtom } from "jotai";
  import {
    copyDatabaseExplorerStateAtom,
    removeDatabaseExplorerStateAtom,
  } from "@/state/databaseExplorer";
  ```

- [ ] Create stable setters near the existing tab atoms:

  ```ts
  const copyDatabaseExplorerState = useSetAtom(copyDatabaseExplorerStateAtom);
  const removeDatabaseExplorerState = useSetAtom(removeDatabaseExplorerStateAtom);
  ```

- [ ] Replace `duplicateTab` with this complete callback:

  ```ts
  const duplicateTab = useCallback(
    (value: string) => {
      const tab = tabs.find((candidate) => candidate.value === value);
      if (!tab) return;

      const id = genID();
      const serializedState = sessionStorage.getItem(value);
      if (serializedState) sessionStorage.setItem(id, serializedState);

      copyDatabaseExplorerState({ sourceTabId: value, targetTabId: id });
      setTabs((currentTabs) => [
        ...currentTabs,
        {
          name: tab.name,
          value: id,
          type: tab.type,
          gameOrigin: tab.gameOrigin,
        },
      ]);
      startTransition(() => setActiveTab(id));
    },
    [tabs, copyDatabaseExplorerState, setTabs, setActiveTab],
  );
  ```

- [ ] Replace `closeTab` with this complete callback so cleanup happens only after the dirty-state guard allows the close:

  ```ts
  const closeTab = useCallback(
    async (value: string | null, forced?: boolean) => {
      if (value !== null) {
        const closedTab = tabs.find((tab) => tab.value === value);
        const tabState = JSON.parse(sessionStorage.getItem(value) || "{}");
        if (tabState && isPersistentGameOrigin(closedTab) && tabState.state.dirty && !forced) {
          toggleSaveModal();
          return;
        }
        if (value === activeTab) {
          const index = tabs.findIndex((tab) => tab.value === value);
          if (tabs.length > 1) {
            if (index === tabs.length - 1) {
              startTransition(() => setActiveTab(tabs[index - 1].value));
            } else {
              startTransition(() => setActiveTab(tabs[index + 1].value));
            }
          } else {
            startTransition(() => setActiveTab(null));
          }
        }
        setTabs((currentTabs) => currentTabs.filter((tab) => tab.value !== value));
        removeDatabaseExplorerState(value);
        unwrap(await commands.killEngines(value));
        await commands.abortGame(`${value}-game`);
      }
    },
    [
      tabs,
      activeTab,
      setTabs,
      toggleSaveModal,
      setActiveTab,
      removeDatabaseExplorerState,
    ],
  );
  ```

  Do not remove any other atom families or session-storage keys in this task.

### 4.4 Verify and commit

- [ ] Run:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  pnpm lint
  ```

  Expected: all independence, default, partial-FEN, duplicate, and cleanup tests pass; type checking/linting pass.

- [ ] Stage and commit:

  ```bash
  git add src/state/databaseExplorer.ts src/state/tests/databaseExplorer.test.ts src/components/tabs/BoardsPage.tsx
  git commit -m "fix: manage database explorer state with tab lifecycle"
  ```

---

## Task 5: Full regression, performance, and upstream-readiness verification

**Files:**

- Modify only if verification exposes a defect in the files already listed above.
- Do not create an upstream issue or pull request as part of this plan unless the user separately authorizes publishing.

**Interfaces:**

- Consumes: the four focused implementation commits from Tasks 1-4 and the acceptance criteria in the approved design.
- Produces: reproducible automated results, a completed two-tab manual checklist, bounded-cache observations, and a clean code-only branch suitable for an upstream proposal.

### 5.1 Run automated verification

- [ ] Run the focused suites first:

  ```bash
  pnpm test -- src/state/tests/databaseExplorer.test.ts
  cargo test --manifest-path src-tauri/Cargo.toml mmap_cache_reloads_when_the_index_path_changes
  ```

- [ ] Run the complete repository checks required by `AGENTS.md`:

  ```bash
  pnpm test
  cargo test --manifest-path src-tauri/Cargo.toml
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  pnpm i18n:extract --ci
  pnpm format
  pnpm lint:fix
  pnpm lint
  pnpm build
  ```

  Expected: every command exits 0. Because `pnpm format` and `pnpm lint:fix` may change files, inspect and rerun the affected test/lint command afterward. Do not claim completion from a stale pre-format result.

### 5.2 Inspect scope and cache invariants

- [ ] Run:

  ```bash
  git diff --check upstream/master...HEAD
  git status --short
  git diff --stat upstream/master...HEAD
  rg -n "commands\.clearGames|setReferenceDatabase|referenceDbAtom" src/components/panels/database
  rg -n "Mutex<Option<\(PathBuf, MmapSearchIndex\)>>" src-tauri/src/main.rs
  ```

  Expected:

  - no whitespace errors;
  - no unrelated files;
  - no selector-triggered `clearGames`, reference-database write, or reference atom read in the database panel;
  - exactly one path-tagged mmap cache field;
  - existing Databases-page invalidation remains available for database mutation/reference flows.

### 5.3 Perform two-tab manual QA

- [ ] Start the application with `pnpm dev` and verify:

  1. Open analysis tabs A and B.
  2. In Local mode select different databases and different players.
  3. Switch tabs repeatedly; selector, player, filters, results, source, and Stats/Games/Options sub-tab remain independent.
  4. Give A and B different Lichess All ratings/speeds/colors and different Masters years; each tab retains its values.
  5. Open a third tab after changing an online option; it receives the latest persisted defaults while A and B remain unchanged.
  6. Duplicate A; the duplicate starts equal, then can be changed without affecting A.
  7. Close the duplicate and open/use a new tab; stale duplicate values do not reappear.
  8. Build a partial-position query in A, switch away/back, and move the analysis board; the partial FEN remains. Return to exact mode and confirm board FEN synchronization resumes.
  9. Alternate rapidly between two large Local databases while searches are running. Results always belong to the selected path; observe expected remapping/page-fault latency and confirm application state retains only the most recently selected mmap after both requests finish.
  10. Generate a report or use repertoire database features and confirm they still use the global reference database, not an analysis tab's selection.

- [ ] If practical, observe the process resident set during step 9. A temporary increase while A and B searches overlap is expected because in-flight `Arc` clones keep both mappings valid. Do not require RSS to drop immediately: file-backed pages and the existing path-aware `line_cache` may remain resident. Repeating the same two queries should stabilize after their result-cache entries exist; continuing monotonic growth across identical cycles requires investigation before upstream submission.

- [ ] Confirm through the browser/network inspector that identical online options in two tabs reuse the same SWR key/request, while distinct filter combinations request distinct results. Closing a tab is not expected to evict an SWR response; unexpected growth caused by including tab IDs in keys is a blocker.

### 5.4 Prepare a clean upstream branch

- [ ] Re-check PR #795 immediately before proposing upstream work:

  ```bash
  gh pr view 795 --repo franciscoBSalgueiro/en-croissant --json state,isDraft,mergedAt,url
  ```

- [ ] Create the eventual upstream branch from current `upstream/master` and cherry-pick only the four code commits from Tasks 1-4. Do not include local documentation commits `53e762ae`, `66fd2510`, or this plan commit.

- [ ] Re-run the full verification commands on that clean branch. Only then use the pull-request example below, marking as complete only checks actually run.

---

## Appendix A: Copy-paste upstream issue example

**Suggested title**

```text
Database explorer options are shared between analysis tabs
```

**Suggested body**

```markdown
## Description

The Database panel behaves as application-global even when multiple analysis tabs are open. Changing the Local database selection or explorer filters in one analysis tab also changes what is shown in another tab.

I expected each analysis tab to behave as an independent explorer workspace, in the same way that its board/game state is independent.

## Steps to reproduce

1. Open analysis tab A and go to **Database → Local**.
2. Select one local database and, optionally, a player/filter.
3. Open analysis tab B and select a different local database or player/filter.
4. Return to tab A.

## Actual behavior

Tab A now shows the selection made in tab B. Lichess All and Lichess Masters options are also shared between initialized analysis tabs.

## Expected behavior

Each initialized analysis tab retains its own:

- Local/Lichess All/Lichess Masters source;
- selected Local database and Local filters;
- Lichess All and Masters filters;
- Stats/Games/Options sub-tab.

The global reference database can still be the default for a newly initialized analysis tab and can remain the database used by reports/repertoire features.

## Root cause found

`DatabasePanel` binds the Local selector to the persisted global `referenceDbAtom`, then copies that value into otherwise tab-scoped Local options. The Lichess All and Masters option atoms are also persisted globals.

There is a backend constraint as well: current `master` stores a single unkeyed `MmapSearchIndex`. Making the selector tab-local only on the frontend could reuse the wrong database's search index unless that cache is keyed by the requested path.

## Proposed direction

- keep tab-keyed working copies for the complete explorer state;
- use the global reference/online settings only as defaults for newly initialized tabs;
- reset the tab's player when its Local database changes;
- tag the one-entry mmap cache with its index path, instead of retaining multiple indexes;
- copy explorer state when duplicating an initialized tab and remove it when closing a tab;
- only synchronize board FEN automatically for exact queries, so partial queries survive tab switches.

This keeps the retained mmap count comparable to current `master`. Concurrent searches against different databases may temporarily keep two mappings alive through existing `Arc` clones, and rapid tab switching may remap/page-fault; an LRU is not proposed without profiling. The existing Rust result cache remains keyed by query and database path, so more distinct per-tab queries can increase its cardinality. Explorer response keys remain value-based, so identical queries across tabs still deduplicate. Closing a tab does not add new Rust-result or SWR-response eviction policies.

## Related work

- #185 appears related to the partial-position reset on tab switches.
- Draft PR #795 changes the database implementation, so the backend part may need rebasing or omission if that PR lands first.

Would you consider per-analysis-tab explorer state the intended behavior? If so, should a fix target current `master`, or wait for the database work in #795?
```

## Appendix B: Copy-paste upstream pull request example

Use this only after implementation and replace unchecked boxes with checked boxes only for commands and manual cases actually completed.

**Suggested title**

```text
fix: isolate database explorer state by analysis tab
```

**Suggested body**

```markdown
## Summary

This makes the Database panel an independent workspace per analysis tab.

- scopes Local database selection, Local filters, explorer source, online filters, and the database sub-tab by analysis-tab ID;
- keeps the global reference database and persisted Lichess/Masters options as defaults for newly initialized tabs;
- resets only the active tab's player when its Local database changes;
- copies initialized explorer state on tab duplication and removes it on tab close;
- preserves partial-position FEN while continuing to synchronize exact queries with the board;
- keys the existing one-entry mmap search cache by index path so different tabs cannot reuse the wrong database index.

## Behavior and compatibility

Reports, repertoire tools, startup preload, sessions, and authentication remain global. Per-tab explorer filters remain transient across application restarts; restored tabs initialize from the current persisted defaults.

The persisted storage keys are unchanged, so existing Lichess All and Masters preferences continue to load.

## Review structure

The path-aware backend cache change is kept in its own commit and can be reviewed independently. The frontend commit depends on that invariant: merging tab-local database selection while leaving the unkeyed mmap cache would allow a tab to receive results from the wrong database. I kept both sides in this PR so the user-visible behavior cannot land in that unsafe intermediate state.

## Memory and performance

The backend still retains only one mmap index in application state. Replacing the cache does not invalidate an in-flight search because `MmapSearchIndex` clones share the mapping through `Arc`.

Two concurrent searches against different databases can temporarily keep two mappings alive until both finish. Rapidly alternating large databases can also incur remapping/page-fault cost. This PR deliberately avoids an unbounded or speculative LRU cache; that can be considered later if profiling shows a real bottleneck.

The existing Rust `line_cache` remains keyed by query and database path. Independent tabs can make more distinct queries and therefore increase that existing cache's cardinality; this PR does not introduce a separate result-cache eviction policy.

Frontend tab state consists of small option objects and is explicitly removed when a tab closes. Independent Lichess filters can create more distinct requests and more distinct value-keyed SWR cache entries, but no tab ID is added to the key, identical queries still deduplicate, and no background requests were added. This PR does not change SWR's existing response-eviction policy.

## Automated testing

- [ ] `pnpm test -- src/state/tests/databaseExplorer.test.ts`
- [ ] `pnpm test`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `pnpm i18n:extract --ci`
- [ ] `pnpm lint`
- [ ] `pnpm build`

## Manual testing

- [ ] Two tabs retain different Local databases, players, filters, result sets, sources, and database sub-tabs.
- [ ] Two tabs retain different Lichess All and Masters filters.
- [ ] A new tab uses current persisted defaults without changing initialized tabs.
- [ ] A duplicated tab copies explorer state and then diverges independently.
- [ ] Closing a tab releases its explorer state.
- [ ] A partial-position query survives tab switches; exact FEN still follows the board.
- [ ] Alternating between two Local databases always returns results from the selected path.
- [ ] Reports/repertoire features still use the global reference database.

## Related

- Related to #185 (partial-position state is currently overwritten on tab switches).
- Draft #795 may supersede the mmap-specific part if it lands before this PR.
```
