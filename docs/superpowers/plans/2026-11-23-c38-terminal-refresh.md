# C38 Terminal Refresh Implementation Plan

**Goal:** Refresh the selected target's running thread view after a newly observed, confirmed terminal event.

**Architecture:** Successful owner-filtered watch-list snapshots establish a per-conversation event-ID baseline and report only newly observed terminal events. A forwards identity-only signals to the current A view; running mode refreshes A threads and count from one running_only response, while normal mode refreshes only the summary. Existing MCP schema negotiation and requestTracker generation checks remain authoritative.

**Tech Stack:** React, TypeScript, Node test runner, Chrome extension messaging.

**Spec:** `docs/panel-main-v2-final-acceptance-checklist.md` C38 and `docs/panel-main-v2-phase-progress.md`.

## Global Constraints

- Preserve conversation ownership, selected-thread state, B watch selection, C event selection, and C37 final-answer authorization.
- Keep normal list pagination at 20 items and do not add a periodic A poll.
- Unsupported schema, errors, and unknown counts remain `—`; true zero remains `0`.
- Do not operate Chrome, deploy to its registered load path, or change CodexBridge.
- Keep hand-written source and tests under 500 lines and 32 KiB per file.

## Review Focus

- Initial successful snapshots containing old events establish a baseline and trigger no refresh.
- Repeated, reordered, acknowledged, cleared, or restored event IDs do not trigger duplicate refreshes.
- Target, mode, conversation, route, or connection changes invalidate queued or delayed work.
- A running refresh in flight is followed by at most one coalesced terminal refresh; normal pagination remains independent.
- Unsupported, malformed, failed, and empty running_only results preserve `—` versus true `0` semantics.

### Task 1: Detect newly observed terminal events

**Files:** Create `src/content/codexbridge-terminal-event-observer.ts`; test `tests/codexbridge-terminal-event-observer.test.ts`.

- [x] Write tests for initial baseline, a new terminal event, duplicate and reordered snapshots, ACK/clear/reappearance, and separate conversation owners.
- [x] Run the focused test and confirm it fails because the observer behavior is absent.
- [x] Implement a small observer keyed by owner conversation and event identity; only successful list snapshots are passed to it.
- [x] Run the focused test and confirm all observer cases pass.

### Task 2: Refresh A from terminal signals

**Files:** Create `src/content/codexbridge-terminal-refresh.ts`; modify `src/content/CodexBridgeWatchPanel.tsx`, `src/content/CodexBridgeList.tsx`; test the coordinator and extend tracker/UI regressions.

- [x] Test refresh selection for current target/mode, duplicate signals, active running requests, and invalidated target/mode work.
- [x] Add an identity-only callback from B/C after a successful owner-filtered snapshot.
- [x] In A, guard by route, conversation, connection, target, and current mode; coalesce a queued running refresh until the active list request completes.
- [x] Use `loadThreads(false)` for running mode so one response updates the rows and summary; use `loadRunningSummary(targetId)` for normal mode.
- [x] Run focused regressions, including `requestTracker` target/mode stale-response coverage and selection preservation.

### Task 3: Record C38 status and verify

**Files:** Modify C38 only in `docs/panel-main-v2-final-acceptance-checklist.md` and append implementation evidence to `docs/panel-main-v2-phase-progress.md`.

- [x] Record implementation and `自動テストPASS／Chrome実機NOT_RUN`; leave C37 and C44/C45 acceptance states unchanged.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; inspect source size and Git diff.
- [x] Commit only the reviewed ChatPanelPlus implementation, tests, and C38 documentation. Do not push, merge, deploy, or operate Chrome.
