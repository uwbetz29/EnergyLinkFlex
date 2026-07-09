# Backlog Burn-Down — Plan + Execution Record (Session 10)

> Hardened plan (3-lens adversarial review applied) + subagent-driven execution log.
> NOTE: the original untracked copy of this file was deleted mid-session by a subagent's
> `git clean -fd` (run for a pristine lint-baseline tree). `git clean` removes UNTRACKED
> files only and leaves no reflog trace (first mis-attributed to Google-Drive sync — wrong).
> This file is now COMMITTED (tracked files are immune to clean). Commit session artifacts
> immediately; keep subagent lint-hygiene off untracked files.

## BLUF

Four open backlog items were planned, hardened by an adversarial review, and executed
subagent-driven with a Watchdog + QA on every task. **Phases 0–2 shipped** (5 commits on
`wip`, live-verified, not yet deployed). **WS3 (#8 per-sheet edit tracking) deferred** by
decision (it is NOT a live bug — zero multi-sheet projects exist — and is blocked on a real
2-sheet fixture; its full design is preserved below).

## What shipped (branch `wip/dwg-ai-stretch-checkpoint`, +5 ahead of origin)

| Commit | Workstream | Live-verified |
|---|---|---|
| `565fe18` | WS4-A: text-draft dismiss → Pan (fixes the stuck-on-Select edit-origin path) | edit existing text → blank → Esc → tool = Pan |
| `a085711` | WS4-B: aria-labels on inline + sidebar dim inputs | accessible names read live: Width/Height, Feet/Inches/Fraction |
| `d72c7db` | WS1: before/after demo toggle | viewBox round-trip exact; B5 markup tracked ±12 (stretch delta) and round-tripped; auto-exit on edit; disabled at 0 changes |
| `f885be6` | WS2 engine: `change-summary.ts` (**Fable-built**, Opus RED harness, 16 cases incl. held-out verbs) | 16/16 unit |
| `25ff33e` | WS2 wiring: route `summary` passthrough + `cascadeSummary` store + capture-old-values + sky banner | AI path live (model `summary` rendered); fallback path live (fetch-patched → deterministic sentence rendered) |

Gates at each step: vitest 230/230, tsc 0, no NEW eslint findings (repo has a ~37-error pre-existing baseline — see memory `lint_baseline`).

## Model-farming (as executed)

- **Opus 4.8**: all contracts, RED harnesses, wiring, effect coordination, live QA, coordination.
- **Fable 5**: ONE durable pure algorithm — `buildDeterministicSummary` (the prod-visible fallback prose engine). Anti-cheat held: Fable touched no test; Watchdog confirmed a general (non-overfit) implementation; 3 held-out verb cases (Lowered/Lengthened/Reduced) added by Opus AFTER delivery all passed.
- **Sonnet**: mechanical implementers (WS4-A/B, WS1, WS2 wiring) + Watchdog reviews.

Corrected Fable rule: Fable is for *hard/durable/deterministic algorithms whose correctness is expensive to get right and rich to test* — not any pure one-liner.

## Execution discipline (per Mike's ask)

Every task ran: **Implementer** (TDD → gates → commit) → **Watchdog** (spec + code-quality + anti-cheat, static) → **QA** (evidence, not "looks right"). Per phase: mini-retrospective + check-in before the next. Watchdog caught 2 real bugs that were fixed + pinned:
- WS1: `quickAdjust` cleared `showDiff` on no-op adjusts → moved the clear onto the real-edit paths + no-op regression test.
- WS2: `applied` recorded phantom/no-op cascade changes (updateDim silently no-ops on hallucinated id / bad dimKey / unchanged value) → `updateDim` now returns boolean; summary records only truly-applied changes.

## Adversarial review findings that reshaped the plan (all confirmed against code)

1. **WS3 flat-map design was invalid** — `parse-multi` parses each sheet as a separate DWG, so `dwg-${handle}` compIds collide across sheets. Correct design = sheet-INDEX-keyed storage.
2. **WS3 is not a live bug** — single-sheet projects never enter the multi-sheet path (`editor-shell.tsx:180`), and the DB has zero ≥2-sheet projects. Re-sequenced WS3 to last, gated on a fixture.
3. **Fable mis-farmed** in the draft (trivial record-merge) — dropped; the real durable candidate was the WS2 prose engine.
4. **Verification honesty** — vitest is `node`-env (no component tests), so every DOM change requires captured `preview_*` evidence; the WS2 "unset the API key" idea was wrong (module-load const) → proven via model-`summary`-present (AI live) + fetch-patch (fallback).

## WS3 (#8) — DEFERRED, design preserved

Per-sheet dim-edit tracking. NOT a live bug (no multi-sheet project exists). Do only once a real
≥2-sheet fixture (two DISTINCT DWGs with **disjoint** component-ID sets) is provisioned; do not
claim done on unit tests alone.

Design (sheet-INDEX-keyed, back-compat):
1. DB `dwg_dim_edits` → `Record<sheetIndex, Record<compId, Record<dimKey,string>>>` (jsonb, no migration) with a `normalizeDimEditsBlob(raw)` read shim mapping the legacy flat map to `{ "0": raw }`.
2. Store per-sheet slices (`originalsBySheet`, `historyBySheet`, `changeCountBySheet`, `historyIndexBySheet`); flat fields remain the active slice.
3. Re-apply persisted edits on sheet entry (`switchSheet`, after `setComponents`) — the edited VALUES live in `components.dims`, which the switch rebuilds pristine.
4. Atomic slice-swap inside `switchSheet` (not `setActiveSheet`); derive `ownedCompIds` synchronously from `sheets[idx].components`; a `switchInProgress` HARD guard on the save (debounce is not correctness).
5. Hydrate `dimEditsAllSheets` FIRST in `loadProject` (before `setSheets`/`dimHydratedFor`).
6. RED harness must cover overwrite-existing, immutability, collision-safety, mid-switch-guard.
Live verify must include the post-RELOAD switch-to-other-sheet path (the case a naive impl corrupts).

## Open follow-ups (non-blocking)

- WS1 UX (your call): Undo/Redo in "Before" view update the ledger but don't move the drawing (they don't force-exit Before).
- No component/RTL tests exist; WS4/WS1/WS2 DOM wiring is covered by captured live evidence + store/pure unit tests only.
- Session-poll noise: the editor fires a very high volume of `GET /api/auth/session` (observed in QA) — worth a separate look.
- Deferred WS3 as above.

## Deploy protocol (unchanged; ask before first prod deploy)

Revert dev-only `auth.ts` + `launch.json` → `next build` → commit on `wip` → push `wip` → FF `main` → `vercel --prod --yes` → smoke via `node -e "fetch(...)"`. No DB migration for Phases 0–2.
