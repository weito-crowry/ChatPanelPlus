# ChatPanelPlus Phase 3 History Scan Cancellation Plan

**Goal:** Prevent programmatic and browser-adjusted scroll events from interrupting full-history scans while retaining deliberate user cancellation and safe lifecycle stops.

**Architecture:** `scroll` events will no longer infer user intent from `scrollTop`. The scanner will track wheel, touch, scroll-key, and active scrollbar-drag input separately, and will return a typed stop reason for every non-completed run. Route and root disposal will pass their cause into the scanner; one gated diagnostic record will report the final reason.

**Tech Stack:** TypeScript, Node test runner, existing fake DOM fixtures.

**Spec:** User request in this ChatPanelPlus task, “ChatPanelPlus Phase 3 — 全履歴走査が自動中止される不具合修正”.

## Global Constraints

- 既存の累積統計と保存方式を変更しない。
- UIのボタン配置は変更しない。
- ChatGPTの送信処理に介入しない。
- 既存のコピー・貼り付け機能を変更しない。
- Git変更操作は禁止。
- Chromeデプロイは禁止。
- Windows上の既存checkoutのみを使い、worktree・branch・commitは作成しない。

## Review Focus

- Delayed scroll events from earlier programmatic moves arrive after a later move: the scan must continue.
- Scroll anchoring changes `scrollTop` without user input: the scan must continue.
- Wheel, touch, scroll keys, and a held scrollbar drag stop the scan; ordinary pointer movement does not.
- Route change and root disposal stop safely and report distinct reasons.
- Every stop preserves measured turns; non-user stops restore the original scroll position.

## Task 1: Classify history scan stops and separate input from scroll events

**Files:**
- Modify: `src/content/conversation-statistics-history.ts`
- Modify: `src/content/conversation-statistics-history-manager.ts`
- Modify: `src/content/conversation-statistics-controller.ts`
- Test: `tests/conversation-statistics-history.test.ts`

**Interfaces:**
- Produce `HistoryScanStopReason` and add `reason: HistoryScanStopReason | null` to `HistoryScanResult`.
- Preserve status mapping: explicit/user/route/root stops are `cancelled`, stalls and limits are `partial`, unexpected exceptions are `error`, and a completed edge traversal is `completed`.
- Route disposal receives `route-changed`; controller teardown and detached roots receive `root-disposed`.

- [x] Add failing regressions for delayed/multiple programmatic scroll events, anchoring correction, mouse movement, wheel input, scrollbar drag, explicit cancel, route/root disposal, stalled/duration limits, preserved turns, and scroll restoration.
- [x] Run the new tests before implementation; both delayed/multiple scroll and anchoring correction failed with `cancelled` as expected.
- [x] Implement typed stop reasons, event-based cancellation, guarded debug logging using the existing `cppDebugInteraction=1` opt-in, and lifecycle reason propagation.
- [x] Re-run the focused tests and all requested checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm check`.

**Verification record:** Final `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed; `pnpm test` reported 258/258. Standalone `pnpm build` passed. `pnpm check` was attempted and is unavailable because `package.json` has no `check` script.

**Execution constraints:** Complete in the current checkout as requested. Do not commit, switch branches, deploy, or automate Chrome. Perform a self-review because the task explicitly requires one agent and forbids delegation.
