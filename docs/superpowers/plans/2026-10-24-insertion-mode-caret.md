# insertionMode Compatibility and Caret Insertion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve schema v1 custom button `insertionMode` values and implement beginning/caret insertion through the existing Composer editor path.

**Architecture:** Add the optional insertion mode to the shared button type, strict settings validator, and normalization output. Expose it in Options state/UI. Capture a Range before focus leaves the Composer and reuse `replaceCurrentSelection` through a caret-only pathname check; preserve the shared clipboard edit path.

**Tech Stack:** TypeScript, React, Node test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-24-insertion-mode-compat-design.md`

## Global Constraints

- Keep `schemaVersion: 1` and preserve absent `insertionMode` behavior.
- Accept only `beginning` and `caret`; reject unrelated unknown custom-button fields.
- Do not read or modify Chrome storage directly, reset configuration, or automate Chrome.
- Preserve custom button IDs, order, and the existing clipboard paste route.
- Keep each edited hand-written source/test/config file within 500 physical lines and 32 KiB.

## Review Focus

- Existing schema v1 config with two caret buttons and their order survives validation and JSON round trip; test in `tests/custom-buttons.test.ts`.
- Unknown insertion modes and unrelated fields remain rejected; test in `tests/custom-buttons.test.ts`.
- Editing an insert button preserves its mode while switching to action removes it; test in `tests/custom-button-options.test.ts`.
- A saved Range restores insertion after focus moves and replaces a selected range; test in editor adapter tests.
- A snapshot from another pathname is rejected and a missing range falls back to Composer end; test in editor adapter tests.
- A test `Document` without `location` still supports the existing injectable editor environment; test in editor adapter tests.

---

### Task 1: Shared schema compatibility

**Files:**
- Modify: `src/shared/default-ui.ts`
- Modify: `src/shared/settings.ts`
- Test: `tests/custom-buttons.test.ts`

- [x] Add failing cases for two caret buttons, beginning, absent mode, JSON round trip, unknown mode, and unknown extra field.
- [x] Run the focused test and confirm failure is caused by rejected/dropped `insertionMode`.
- [x] Add the optional insert-only type and strict validation while retaining the field in the normalized output.
- [x] Rerun the focused test and confirm passing.

### Task 2: Options editing

**Files:**
- Modify: `options/src/options-state.ts`
- Modify: `options/src/OptionsPage.tsx`
- Test: `tests/custom-button-options.test.ts`

- [x] Add failing cases for mode-preserving edits, insert-to-action cleanup, and JSON import/export retention.
- [x] Run the focused test and confirm failure.
- [x] Add the insert-only selector and update path; default absent mode to beginning in the UI.
- [x] Rerun the focused test and confirm passing.

### Task 3: Composer caret insertion

**Files:**
- Modify: `src/content/editor/adapter.ts`
- Modify: `src/content/Panel.tsx`
- Modify: `src/content/panel-button-actions.ts`
- Modify: `tests/editor-adapter-fixture.ts`
- Modify: `tests/editor-adapter.test.ts`
- Modify: `tests/panel-custom-button-dispatch.test.mjs`
- Test: `tests/panel-button-actions.test.ts`

- [x] Add failing cases for focus-loss Range restoration, selected-range replacement, pathname change rejection, and end fallback.
- [x] Run focused tests and confirm expected failures.
- [x] Route caret mode through `insertAtCaret`, which applies pathname validation then delegates to existing `replaceCurrentSelection`; capture snapshots before pointer focus; keep absent mode on `insertAtBeginning`.
- [x] Rerun focused tests and confirm passing without changing the shared clipboard text-edit path.

### Task 4: Full requested verification

**Files:** All files above.

- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` to completion.
- [x] Review `git diff --check`, diff scope, source size, and `dist` build output.
- [x] If all required commands pass, run `pnpm deploy:chrome` and verify destination files match `dist`.
- [x] Report Chrome interaction as unverified and ask the user to perform the listed manual checks.
