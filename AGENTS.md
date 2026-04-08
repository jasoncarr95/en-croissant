# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Is

**En-Croissant** is a cross-platform desktop chess GUI built with Tauri 2 (Rust backend + React frontend). It supports multi-engine analysis, repertoire training with spaced repetition, and game imports from Lichess/Chess.com.

This is a personal fork (upstream: `franciscoBSalguworeiro/en-croissant`). The upstream repo has slow development, so this fork may diverge with independent changes. Use `upstream/master` to track upstream and `origin/master` for fork changes.

## Related Repos

- **Docs site**: `/Users/jasoncarr/projects/RANDOM/chess/encroisssant-site/docs` — the cloned en-croissant documentation repo (guides, reference). Accessible as an additional working directory in Codex settings.

## Commands

```bash
pnpm dev          # Start full Tauri dev server (Rust + React, hot reload)
pnpm start-vite   # Start frontend only (port 1420, no Rust)
pnpm build        # Full production build
pnpm test         # Run Vitest tests
pnpm lint         # Type check (tsgo) + oxlint
pnpm lint:fix     # Auto-fix linting issues
pnpm format       # Format with oxfmt
```

**i18n:**

```bash
pnpm i18n:extract   # Extract translatable strings from source
pnpm i18n:types     # Regenerate TypeScript types for translations
pnpm i18n:sync      # Sync translations across locales
```

**Before submitting a PR:** run `pnpm build`, `pnpm format`, `pnpm lint:fix`.

## Architecture

### Frontend (`/src`)

- **Framework**: React 19 + TypeScript, Vite 8, TanStack Router (file-based routing in `src/routes/`)
- **UI**: Mantine v8 component library, CSS Modules (recently migrated from vanilla-extract)
- **Chess board**: `@lichess-org/chessground`, chess logic via `chessops`
- **State**: Hybrid — Jotai atoms (`src/state/atoms.ts`) for UI state + Zustand stores (`src/state/store/`) for heavier game tree and database state
- **IPC**: Auto-generated TypeScript bindings in `src/bindings/` (via tauri-specta — do not edit manually)
- **i18n**: i18next with 15+ locale JSON files in `src/translation/`

Key frontend directories:

- `src/components/` — domain-organized React components (boards, engines, databases, puzzles, panels, etc.)
- `src/utils/` — domain helpers (chess, db, engines, lichess/, chess.com/, chessdb/)
- `src/hooks/` — custom React hooks
- `src/state/` — Jotai atoms, Zustand stores, keybinds

### Backend (`/src-tauri/src`)

- **Runtime**: Tauri 2 + Tokio async
- **Database**: SQLite via Diesel ORM; position search uses an in-memory mmap index (`db/search_index.rs`)
- **Chess engines**: UCI protocol via vampirc-uci custom fork; engine process management in `engine/`
- **Type generation**: tauri-specta auto-generates `src/bindings/` from Rust command signatures — run after changing Tauri commands

Key backend files:

- `main.rs` — Tauri setup, all IPC command registration
- `db/mod.rs` — Main database operations (large file, ~69KB)
- `db/search.rs` — Position search logic
- `game.rs` — Move tree / game state (~48KB)
- `chess.rs` — Engine analysis orchestration
- `pgn.rs` — PGN parsing/writing
- `engine/process.rs` — UCI engine subprocess management

### Frontend ↔ Backend Communication

- Tauri commands (invoke from frontend) are defined in `main.rs` and `src-tauri/src/`
- Long-running operations emit Tauri events with progress updates (see `progress.rs`)
- Never edit `src/bindings/` manually — regenerate via tauri-specta after Rust changes

## Key Patterns

- **CSS Modules** for component styling (`.module.css` files co-located with components)
- **Jotai atoms** for cross-component UI state; **Zustand** for the game move tree (complex, mutable)
- **Zod** for validating external data (API responses, file formats)
- **Specta** derives TypeScript types from Rust structs/enums automatically
- Parallel processing in Rust uses Rayon; async I/O uses Tokio
