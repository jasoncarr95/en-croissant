---
created: 2026-11-12
project: /Users/jasoncarr/projects/RANDOM/chess/en-croissant
source:
  tool: claude-code
  session: d1b74de2-d993-417a-8cc0-ddc62bc3ee67
  cwd: /Users/jasoncarr/projects/RANDOM/chess/en-croissant
  title: Fork sync after upstream release (v0.16.1 merged into yason, PR 3)
  model: claude-fable-5-2
  effort: high
size: S
---

# Database explorer and repertoire coverage: what the v0.16.1 merge left open

## Jason's words

> "It's still a bit slow though, as is playing moves on that tab" — session `d1b74de2-d993-417a-8cc0-ddc62bc3ee67` · `/Users/jasoncarr/projects/RANDOM/chess/en-croissant` · 2026-11-11 (said of the debug build; the release build's speed was not reported back)

## Start this session

```text
Opus session, permission mode default (ask). cwd: /Users/jasoncarr/projects/RANDOM/chess/en-croissant.
You can run this while other sessions work in this repo (it only edits src/utils/repertoire.ts, src/components/panels/database/DatabasePanel.tsx, src/state/databaseExplorer.ts and their tests).
You at the keys: each item is optional, so Jason picks which ones are worth doing, and checks the result in the app.
Starts after: nothing

Verify first:
- `git status --short` — leave what isn't yours; if Jason started you in a worktree, work there.
- `git merge-base --is-ancestor 22cd0cda HEAD` — if not, stop and tell me: the coverage fixes this builds on are missing.

Read first:
- notes/research/2026-11-11-upstream-v0.16.1-merge/merge-review-2026-11-11.md §Findings 3, 4, 5
- notes/research/2026-11-11-upstream-v0.16.1-merge/coverage-fix-review-2026-11-11.md §Findings in detail 5 and §Q6
- notes/DECISIONS.md row 2
- docs/upstream-sync.md §Building and installing

Goal: decide with Jason which of the known limits below are worth fixing, fix those with a failing test first, and have him confirm each in the app. None of them is a regression from the merge.

Steps:
1. Ask Jason whether the installed release build of 0.16.1 feels fast enough in the Black Repertoire tab (Practice → Build) and in the Database panel. If not, measure before changing anything.
2. Database panel searches the previous position on its first render after it reopens (merge review finding 3, same in upstream v0.16.1). The review gives a `useMemo` fix; it also suits an upstream PR.
3. Coverage for a position reached only by a rarely played move order, when no common order in the repertoire reaches it: still an empty bar. Computing it means searching rare lines, which costs searches.
4. Your alternative replies (not the first reply at a position) get no coverage bar at all. Computing them is a product choice: more searches, and the parent's percentage would still ignore them.
5. A leaf that transposes takes its coverage from the first other line and its missing-games figure from the last (coverage review finding 5, with a proposed fix that was not run). It only affects which gap "biggest gap" ranks first.
6. Untested cases: the ones the coverage review lists under Q6 (the gap finders on a rare move leading straight into a searched position, an abort part-way through, a non-empty start path), and "Explore openings" for a player with no database of their own (merge review finding 6).
7. The write atoms in `src/state/databaseExplorer.ts` read the active tab from the store, not the tab the panel rendered (merge review finding 4). No realistic trigger was found; harden only if a bug shows up.

Finish:
- Created, renamed or changed what a skill, command, script or feature does?
  `rg` its name and any old term across the docs and fix every hit.
- Append one `## Outcome` footer (date and session, commits or PR, Jason's
  decisions in his words: what he typed, quoted; a button he clicked as
  `his pick: "<label>"`; what was dropped), then
  move this file to `notes/handoffs/done/`.
- If work remains, WRITE THE NEXT HANDOFF and name its path.
- End with done / open / whose move, naming the file that holds it.
```

## Notes

- The installed 0.16.1 app (built from `yason` at `0b67d8ba`, installed 2026-11-12) was verified by the session by version and signature only. The release build was opened at least once that morning (the repertoire file was saved at 07:38, after the dev build was gone), but how it behaved, and whether it is fast enough, was not reported back. Going back to 0.15.1 may not be clean, because the new version can rewrite the everyday settings.
- **Testing wrote into the real repertoire.** `~/Documents/EnCroissant/Black Repertoire.pgn` has two lines that the 2026-11-11 backup lacks, both from playing moves while testing: `1.c4 Nf6 2.Nf3 g6 3.d4 Bg7` and `1.d4 Nf6 2.d5`. Jason decides whether to delete them in the app or restore `~/Documents/EnCroissant-backups/EnCroissant-backup-2026-11-11/Black Repertoire.pgn`, which is identical apart from those two lines.
- The two scan scripts beside the reviews (`notes/research/2026-11-11-upstream-v0.16.1-merge/find-transpositions.ts` and `find-clock-transpositions.ts`) list the positions a repertoire PGN reaches by more than one move order; usage is in each header.
- The release build folder `src-tauri/target` is large and can be deleted for disk; the next build recreates it.
- Jason's own cleanup after the merge, none of it session work: convert the remaining databases in Databases → Convert (then the old `.db3` and `.ecsi` files can go); delete the merged remote branch `chore/upstream-v0.16.1`; decide whether the tags `v0.15.1`, `v0.16.0`, `v0.16.1` stay on the fork; delete the untracked `codex-session-2026-11-11-192858-01a1c6b5.md` (a broken export); the old app is kept at `~/Documents/EnCroissant-backups/en-croissant-0.15.1.app`.
- Jason's Black repertoire has 968 positions reached by more than one move order and 65 that differ only in the halfmove clock, so transposition handling matters for his data.
