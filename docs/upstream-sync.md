---
source:
  tool: claude-code
  session: d1b74de2-d993-417a-8cc0-ddc62bc3ee67
  cwd: /Users/jasoncarr/projects/RANDOM/chess/en-croissant
  title: Fork sync after upstream release (v0.16.1 merged into yason, PR 3)
  model: claude-fable-5-2
  effort: high
---

# Syncing the fork with upstream, and installing a build

How an upstream En Croissant release gets into this fork. Written after the first such sync (v0.16.1, PR 3, 2026-11-11).

## Branches

- `yason` holds the fork's work and is what gets built and installed.
- `master` mirrors `upstream/master` and is never worked on.

## Bringing in a release

1. `git fetch upstream --tags`, then fast-forward the mirror without switching to it: `git fetch upstream master:master`, and `git push --no-follow-tags origin master`.
2. Cut a branch from `origin/yason` (a worktree keeps uncommitted work in the main checkout out of the way) and merge the release tag into it: `git merge --no-ff <tag>`. Merge, never rebase: the fork has merge commits of its own.
3. Resolve conflicts with upstream's code as the base and the fork's behaviour re-applied on top. Where upstream rewrote a file wholesale (the database layer in v0.16.0), take upstream's file and check each fork change against the new code instead of merging hunks.
4. Check: `pnpm lint:ci`, `pnpm test`, and `git diff --stat <tag> -- src-tauri src/bindings` (empty when the fork carries no Rust changes).
5. Open the PR against `yason` in the fork. `gh pr create` defaults to the upstream repository, so pass `--repo jasoncarr95/en-croissant --base yason`.
6. Merge it as a merge commit, never a squash: a squash drops upstream's ancestry and the next sync conflicts on everything again.

Traps met the first time:

- `push.followTags` is on in this checkout, so a plain `git push` of the branch also pushes upstream's `v*` tags to the fork, and the fork's `release.yml` triggers on `v*` tags. Use `git push --no-follow-tags`.
- CI runs `oxfmt --check` over the whole repository, fork-only files included (`.claude/settings.json`, `docs/`).
- `pnpm exec i18next-cli extract --ci` rewrites the locale files when keys are missing; run it after resolving translation conflicts.

## Building and installing

- `pnpm dev` is a debug build: DuckDB is compiled without optimisation, so it says nothing about speed. `CARGO_PROFILE_DEV_DEBUG=0 pnpm dev` keeps the build folder smaller.
- `pnpm build` is `tauri build --no-bundle`: it produces the program at `src-tauri/target/release/en-croissant`, not an app.
- An installable app: `pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`. The `--config` part skips updater signing, which needs upstream's private key. The app lands in `src-tauri/target/release/bundle/macos/`.
- Installing: quit the app, move `/Applications/en-croissant.app` aside as a backup (`~/Documents/EnCroissant-backups/` holds the earlier ones), then `ditto` the built bundle to `/Applications/en-croissant.app`. A locally built app is ad-hoc signed and opens without a Gatekeeper prompt.
- Dev and release builds share the app identifier `org.encroissant.app`, so both use the real data folder. A dev build keeps its own settings (its pages load from `localhost`); a release build opens the installed app's settings.
- Testing by hand writes to real files: a move played in a tab that is backed by a file (a repertoire, a saved game) is saved into that file. Test on a copy, or compare with `~/Documents/EnCroissant-backups/` afterwards.
- The app's updater points at upstream's update server. Accepting an in-app update replaces the fork build with the official one; sync through a PR instead.

## Databases after v0.16.0

Upstream replaced SQLite `.db3` databases with DuckDB `.duckdb` files. Databases → Convert writes a new file beside the original and keeps the original. The `.ecsi` search-index files belong to the old format.
