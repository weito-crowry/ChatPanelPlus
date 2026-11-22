# Options V2 Data Management Implementation Plan

> **For agentic workers:** Use the inline `superpowers:executing-plans` workflow. The user authorized implementation, tests, documentation, and a local commit in the current checkout.

**Goal:** Reorganize Options into a navigable V2 editor and add read-only saved-data inspection with narrowly scoped, compare-and-swap deletion for approved record types.

**Architecture:** Keep the existing draft, base, save, import/export, and independent settings components mounted in the Options page. Hide inactive sections instead of unmounting them. Extract the selected-group panel editor and a dedicated data manager. Use explicit known storage keys for inspection; use the existing repository lock names and validated records for deletion.

**Tech Stack:** React, TypeScript, Chrome MV3 storage, Node test runner, pnpm.

**Spec:** This plan implements the user request in the 2026-11-22 Options V2 handoff.

## Global Constraints

- Do not build or deploy to the registered `dist/`; do not operate Chrome or mutate real Chrome storage.
- Do not expose MCP token contents or length, sound base64, full configuration JSON, or raw storage dumps.
- Do not delete unknown keys, config, view state, sound assets, session data, active watches, or terminal events.
- Safe deletion must compare the displayed record under the same per-key repository lock and preserve sibling records.
- Storage without a validated timestamp has update time `不明` and is never classified as old.
- Keep every hand-written code, test, CSS, and JSON file within 500 physical lines and 32768 UTF-8 bytes.
- Run the full `pnpm test` suite only in a source-only temporary copy with a `node_modules` link; prove the live dist's 11-file path/size/SHA-256 manifest is unchanged.

## Review Focus

- Stale deletion preview or concurrent write: repository compare-and-swap must reject without touching sibling records.
- Corrupt known storage: show an error and offer no deletion target for that key.
- Secret-bearing assets/session token: the view must contain only metadata or a presence boolean.
- Events without a valid `detectedAt`: never count as old candidates.
- Hidden Options sections: their editor drafts and local state remain mounted, but hidden controls cannot receive focus.

## Tasks

### Task 1: Options navigation and selected-group editor

**Files:** Create `options/src/options-v2-state.ts`, `options/src/OptionsPanelEditor.tsx`, `options/src/OptionsNavigation.tsx`; modify `OptionsPage.tsx`, `options.css`, and `main.tsx`; add navigation/editor tests and update `tests/options-page.test.mjs` to verify the new component boundaries.

- [x] Cover hash-to-section selection, unknown hash fallback, visible tab-group fallback, section mounting, and editor behavior.
- [x] Implement a five-item accessible table of contents with hash navigation and responsive layout.
- [x] Keep connection, project, sound, panel, and data sections mounted under `hidden`; preserve the shared sticky save/status controls.
- [x] Move preview and editor controls into `OptionsPanelEditor`; edit one selected group at a time while retaining tab visibility, drag/drop, up/down, button operations, and draft behavior.
- [x] Run focused Options UI tests.

### Task 2: Saved-data inventory and safe metadata view

**Files:** Create `options/src/saved-data-manager.ts` and `options/src/OptionsDataManager.tsx`; add focused inventory/UI tests.

- [x] Test explicit known-key reads, record summaries, approximate size labels, hidden token/device identifiers, omitted audio payload, storage-change staleness, and 90-day event candidates.
- [x] Read only known local keys and the specific session token key; convert token presence to a boolean immediately.
- [x] Show paged record summaries and trustworthy event `detectedAt`; do not render raw settings, base64, or unknown keys.
- [x] Keep bridge watches/events read-only in this view and show old event candidates without delete controls.

### Task 3: Compare-and-swap deletion for approved records

**Files:** Modify `ConversationPanelStateRepository`, `ConversationStatisticsRepository`, `ProjectFolderPatternsRepository`, and `ProjectNamesRepository`; add/extend FakeStorage tests.

- [x] Test stale snapshot rejection, malformed storage rejection, key-local sibling preservation, and explicit removal for conversation panel state/statistics and project pattern/name records.
- [x] Add deletion methods using each repository's existing lock name; compare the validated current record to the displayed expected snapshot before writing.
- [x] Integrate checkbox selection, impact preview, explicit confirmation, result reporting, and refresh after deletion.
- [x] Keep all other categories read-only and preserve terminal events through the existing owner-scoped panel action.

### Task 4: Documentation and full verification

**Files:** Create/update an Options V2 design/acceptance record and the phase progress record; update tests only where old source-location assertions no longer match the new components.

- [x] Run focused tests, `pnpm typecheck`, `pnpm lint`, and `pnpm check:size`.
- [x] Run all tests in a source-only copy; verify live `dist/` has identical 11-file relative paths, byte sizes, and SHA-256 before and after.
- [x] Run `git diff --check`, review staged paths, commit locally, and verify clean status.
- [x] Record Chrome visual/keyboard/data acceptance as `NOT_RUN`; do not build or deploy.

## Completion record

- 2026-11-22: focused suite 27/27 PASS; isolated full suite 620/620 PASS. `pnpm typecheck`, `pnpm lint`, and `pnpm check:size` PASS.
- The isolated test copy excluded the live `dist/` and linked only `node_modules`. The registered `dist/` stayed at 11 files with identical relative paths, sizes, and SHA-256 values before and after.
- This task did not build or deploy the formal extension, operate Chrome, or read/write the user's Chrome storage. Chrome UI acceptance remains `NOT_RUN`.
