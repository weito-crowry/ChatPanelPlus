# Phase 3 Cumulative Turn Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Turns and character totals cumulative for every measured Turn Key in each Conversation ID, including saved branch rows, while merging concurrent saves without losing measurements.

**Architecture:** Keep the v1 `chatPanelPlus.statistics` shape. Derive counts from all saved turn rows, counting only rows with measured INPUT. Before saving, read the latest store under the existing lock and perform a per-Turn-Key three-way merge against this repository instance's last loaded or successfully saved baseline. When two snapshots changed the same field from the same baseline, preserve the value already committed in Storage; a subsequent save based on that current value can apply a correction.

**Tech Stack:** TypeScript, Chrome `storage.local`, `navigator.locks`, Node test runner.

**Spec:** User request “ChatPanelPlus Phase 3 — 引き継ぎ判断のための累積ターン統計” in this task.

## Global Constraints

- Do not change existing copy/paste behavior or intercept ChatGPT send behavior.
- Do not change extension ID, deployment path, perform Git changes, or deploy to Chrome.
- Do not persist message bodies or body hashes.
- Keep the existing statistics storage format where possible.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm check:size`.

## Review Focus

- A stored row without measured INPUT stays excluded from Turns and character totals.
- A saved row outside `turnOrder` still contributes once to its Conversation ID's cumulative totals.
- A stale snapshot cannot remove rows or overwrite a value committed since its baseline.
- A fresh measurement based on current Storage can correct a same-key character count.
- A storage write failure leaves persisted data intact and reaches the existing UI error state.

---

### Task 1: Cumulative ledger aggregation

**Files:**
- Modify: `src/shared/conversation-statistics.ts`
- Test: `tests/conversation-statistics.test.ts`

**Interfaces:** Keep existing storage and aggregate interfaces. `aggregateConversationStatistics` reads all values in `conversation.turns`, independent of `turnOrder`.

- [x] **Step 1: Add failing ledger aggregation tests** for measured off-order rows, zero-character INPUT, ID-only rows, and totals across all saved rows.
- [x] **Step 2: Run** `node --experimental-strip-types --test tests/conversation-statistics.test.ts`; verify the new off-order test fails because aggregation currently filters by `turnOrder`.
- [x] **Step 3: Implement** totals over unique object keys in `turns`; count a turn only when `inputChars` is defined; preserve partial status for incomplete history or measurement.
- [x] **Step 4: Rerun** the focused test and verify the cumulative and existing regeneration/branch tests pass.

### Task 2: Latest-store per-key save merge

**Files:**
- Modify: `src/shared/conversation-statistics-repository.ts`
- Test: `tests/conversation-statistics-repository.test.ts`

**Interfaces:** Keep `saveConversation(conversationId, conversation)` and current result types. Track each repository instance's last loaded or successfully saved conversation as the three-way merge baseline.

- [x] **Step 1: Add failing race tests** for stale snapshots preserving a newly stored Turn Key, preserving a committed same-key update, applying a fresh same-key correction, and failed writes preserving old data.
- [x] **Step 2: Run** `node --experimental-strip-types --test tests/conversation-statistics-repository.test.ts`; verify the stale-snapshot cases expose whole-conversation replacement.
- [x] **Step 3: Implement** a union merge of baseline, incoming, and latest Storage rows under the existing lock; preserve latest values when incoming fields are unchanged from baseline or both sides changed; apply incoming-only changes. Merge order without dropping existing IDs.
- [x] **Step 4: Rerun** the focused repository test, including an interleaving where another writer adds a key while a save is pending.

### Task 3: Cumulative UI wording and regression coverage

**Files:**
- Modify if needed: `src/content/ConversationStatistics.tsx`
- Test: `tests/conversation-statistics-controller.test.ts`, `tests/conversation-statistics-ui.test.mjs`, and `tests/conversation-statistics-recount-rebase.test.ts`

**Interfaces:** Keep the controller and UI state APIs. Continue using existing `partial`, `saving`, `unsaved`, and storage error state.

- [x] **Step 1: Add failing recount/controller tests** for 20-to-5 visible rows, adding 10 new measured rows, repeated recount, empty DOM, different Conversation IDs, and ID-only rows.
- [x] **Step 2: Run** the focused controller and UI tests and confirm any failures correspond to changed aggregation or save semantics.
- [x] **Step 3: Make only the UI copy needed** to explain cumulative measured totals and partial history, without adding threshold warnings.
- [x] **Step 4: Run the full required checks:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm check:size`.

**Self-review:** All stated counting rules map to Task 1, save conflict rules to Task 2, and controller, UI, and lifecycle behavior to Task 3. Send handling is covered by the existing send-intent regression tests and the requested full suite. No schema version change or new storage metadata is planned.
