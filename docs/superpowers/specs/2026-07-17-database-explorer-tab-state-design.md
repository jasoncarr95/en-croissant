# Per-Tab Database Explorer State Design

**Status:** Approved

**Date:** 2026-07-17

## Problem

The analysis database panel mixes tab-scoped query state with application-wide persisted state.
The Local database selector reads and writes `referenceDbAtom`, so selecting a database in one
analysis tab changes the selector in every analysis tab. The panel then copies that global path
into each tab's otherwise tab-scoped `LocalOptions` value.

The same scope mismatch applies to the Lichess All and Lichess Masters filters: they are persisted
global atoms, while the database source, database sub-tab, and Local query filters are already
scoped by analysis-tab ID.

An adjacent problem is tracked upstream as issue #185: a custom partial-position query is replaced
with the board position after switching away from and back to an analysis tab. The synchronization
effect currently overwrites the query FEN regardless of whether the query is exact or partial.

## Desired Outcome

Each analysis tab behaves as an independent database-explorer workspace. Changing the selected
database, explorer source, or any query filter in one tab must not change an already-initialized
second tab.

Application-wide defaults remain available:

- `referenceDbAtom` remains the global reference database for report generation, repertoire tools,
  startup preloading, and the initial Local selection for an analysis tab.
- Persisted Lichess All and Lichess Masters options remain the defaults used when an analysis tab
  first initializes its explorer state.
- Changing Lichess or Masters filters updates the active tab and the persisted default for future
  tab initialization, but never mutates another initialized tab.

## Scope

The following state becomes independent per analysis tab:

- explorer source: Local, Lichess All, or Lichess Masters;
- selected Local database;
- Local player, color, date range, result, match type, and custom position;
- Lichess All ratings, speeds, and color;
- Lichess Masters date filters;
- Stats, Games, or Options database sub-tab.

The following state remains global:

- authenticated account sessions and the Lichess access token;
- the reference database used outside the database explorer;
- persisted defaults for newly initialized explorer tabs;
- database metadata and the list of available databases;
- SWR response caching.

## Non-Goals

- Persisting every open tab's explorer filters across application restarts.
- Keeping several database search indexes mapped indefinitely.
- Adding background database searches or refreshes.
- Redesigning the database panel layout.
- Refactoring all existing tab-scoped atom families or their lifecycle behavior.
- Depending on the unmerged Database v2 pull request.

## State Architecture

### Global defaults

`referenceDbAtom` remains unchanged and is no longer written by the analysis-panel database
selector. Selecting a database for a tab must not change the database used by reports or repertoire
features.

Rename the existing persisted `lichessOptionsAtom` and `masterOptionsAtom` exports to
`lichessOptionsDefaultsAtom` and `masterOptionsDefaultsAtom` so their ownership is explicit. Their
storage keys remain `lichess-all-options` and `lichess-master-options`, preserving existing user
preferences.

### Tab-scoped working state

The existing families remain responsible for Local options, explorer source, and the selected
database sub-tab. New tab-keyed families hold Lichess All options and Lichess Masters options.

A tab-scoped initialization marker prevents persisted defaults from being reapplied after another
tab changes them. A write-only initialization atom snapshots all defaults for a specific tab ID in
one operation:

1. retain the tab's existing default Local filters;
2. set its Local path from the current global reference database when its path is unset;
3. copy persisted Lichess All options into the tab family;
4. copy persisted Lichess Masters options into the tab family;
5. mark the explorer state initialized.

The database panel does not start a query until initialization has completed. This avoids a
first-render request with a missing Local path or fixed, pre-persistence Lichess defaults.

### Lifecycle operations

The state module exposes focused write operations rather than exporting every family:

- initialize explorer state for a tab;
- copy initialized explorer state from a source tab to a duplicated tab;
- remove explorer state for a closed tab.

Duplicating an initialized tab copies all explorer options. Duplicating a tab that has never
initialized its database explorer leaves the new tab uninitialized, so both tabs independently
snapshot the defaults when first used.

Closing a tab removes only the database-explorer family entries introduced or used by this design.
This prevents stale explorer objects from accumulating without expanding the work into a cleanup
of every existing atom family.

Tabs restored after restarting the application initialize from the current persisted defaults.
Their previous transient explorer filters are intentionally not restored.

## UI and Data Flow

When an analysis tab opens its database panel:

1. `DatabasePanel` resolves the active tab ID.
2. The initialization operation snapshots global defaults if that tab is not initialized.
3. The panel reads only tab-scoped working options when constructing its SWR key and `DBType`.
4. Local searches pass the tab's selected path and tab ID to `searchPosition`.
5. Lichess searches pass the tab's ratings, speeds, color, or date filters.

The Local selector binds to `localOptions.path`, not `referenceDbAtom`. Changing it:

- updates only the active tab;
- clears the Local player selection because numeric player IDs are database-specific;
- leaves other Local filters intact;
- does not call `clearGames` once the backend cache is path-aware.

The empty-state copy refers to a database selected for the current tab rather than claiming that a
global reference database is missing. The selector placeholder uses database-explorer wording, not
reference-database wording. The Databases page remains the place where users mark a database as the
global reference.

For exact Local queries, moving through the analysis game continues to synchronize the query FEN
with the board. For partial queries, board navigation and tab switching must not overwrite the
custom query position. Choosing the existing "Current Position" or "Similar Structure" actions
continues to update it explicitly.

## Persisted Lichess and Masters Defaults

Editing a Lichess All or Lichess Masters option performs two writes:

1. update the active tab's working options;
2. update the existing persisted default atom.

Already-initialized tabs retain their working copies. A tab that has not yet initialized the
database explorer snapshots the latest persisted defaults when it first opens the panel. This
preserves the current remember-my-settings behavior without reintroducing cross-tab mutation.

## Backend Search-Index Cache

Current master stores one unkeyed `MmapSearchIndex`. A search reuses any populated index without
checking whether it belongs to the requested database. The frontend currently compensates by
calling `clearGames` when the global reference database changes. That compensation is insufficient
once different tabs can select different paths.

The cache becomes a single path-tagged entry:

```rust
Mutex<Option<(PathBuf, MmapSearchIndex)>>
```

A shared helper used by `search_position`, `is_position_in_db`, and `preload_reference_db`:

1. derives the requested index path;
2. validates or generates that index;
3. returns the cached index when the cached path matches;
4. otherwise opens the requested index and replaces the cached entry.

Only one index remains retained by application state, keeping steady-state memory comparable to
current master. An in-flight search owns a cloned `MmapSearchIndex` backed by an `Arc`, so replacing
the cache does not invalidate that search. Two concurrent searches against different databases may
temporarily keep two mappings alive, bounded by the existing two-request semaphore.

The existing line-result cache already includes the database path in its key and remains unchanged.
Explicit cache invalidation remains available for database mutation flows that can make an index
stale; selector changes no longer use invalidation as a substitute for cache identity.

## Error Handling

- A Local tab with no selected path shows the revised select-a-database empty state and does not
  invoke `searchPosition`.
- A path that becomes unavailable after tab initialization surfaces the existing query error and
  remains replaceable through the selector.
- A missing or invalid search index follows the existing generate-and-retry behavior.
- Lichess authentication remains global. Tabs using an online explorer continue to show the
  existing authentication warning when no access token exists.
- Changing one tab's source or filters does not cancel, clear, or overwrite another tab's state.
  Existing per-tab progress IDs continue to distinguish Local searches.

## Performance and Memory

Frontend explorer state consists of small option objects. The meaningful frontend risk is retained
atom-family entries after tab closure, addressed by explicit explorer cleanup.

The one-entry backend cache avoids retaining every selected database. Rapidly alternating between
tabs backed by different large databases can remap indexes and incur page faults. This is accepted
in preference to an unbounded multi-index cache. An LRU cache is deferred unless profiling shows
that remapping is a practical bottleneck.

Independent online filters can produce more distinct Lichess requests. Existing debouncing and SWR
deduplication remain in place; the change adds no background traffic.

## Testing Strategy

### Frontend state tests

Use a Jotai vanilla store to verify:

- two initialized tab IDs receive independent explorer state;
- a Local database change in tab A does not affect tab B or `referenceDbAtom`;
- changing databases resets only tab A's player filter;
- Lichess and Masters changes update their persisted defaults but not tab B's working copies;
- changing the global reference database after initialization affects future initialization only;
- duplicate-state copying produces equal but independently mutable values;
- closing a tab removes its explorer entries;
- partial query FEN survives board-FEN synchronization while exact query FEN follows the board.

### Backend tests

Create two temporary search-index files with distinguishable contents and verify that the cache
helper loads A, replaces it with B, and correctly returns A again without an explicit clear. Add a
focused helper test proving that a cloned mapping remains readable after cache replacement.

### Component behavior

Exercise the database panel with two analysis tabs:

1. select different Local databases and players;
2. select different explorer sources and Lichess/Masters filters;
3. switch between tabs and verify every value and result set remains independent;
4. duplicate a tab and verify the copy starts with the source explorer state;
5. close tabs and open a new one to verify persisted defaults are applied;
6. construct a partial position, switch tabs, and verify it is retained.

### Repository verification

Run frontend unit tests, Rust tests covering the database cache, type checking/linting, formatting,
and the production build commands required by `AGENTS.md` before the implementation is considered
complete.

## Upstream and Database v2 Compatibility

Draft pull request #795 replaces much of the current SQLite/mmap search implementation. This design
targets current `master` and does not assume that pull request will merge. Before opening an
upstream pull request, re-check #795:

- if it remains unmerged, include the path-aware current-master cache fix;
- if it has merged and removed the mmap cache, omit the obsolete backend task and retain the
  frontend state-ownership behavior against the new database layer.

The upstream proposal should explicitly distinguish the tab-specific explorer database from the
global reference database and ask maintainers to confirm that analysis tabs are intended to be
independent workspaces.

## Acceptance Criteria

- Two analysis tabs can simultaneously display different Local databases and filter sets.
- Two analysis tabs can simultaneously retain different Lichess All and Masters filter sets.
- Changing one initialized tab never changes another initialized tab.
- Reports, repertoire features, and startup preloading continue to use the global reference
  database.
- New explorer tabs initialize from the current persisted defaults.
- Duplicated tabs copy initialized explorer state; closed tabs release that state.
- Local database searches always use the index belonging to the requested path without relying on
  selector-triggered cache clearing.
- A custom partial position survives analysis-tab switching.
- Existing exact-position synchronization, authentication warnings, SWR caching, and persisted
  defaults continue to work.
