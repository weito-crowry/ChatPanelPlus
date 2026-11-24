# Issue #25 共通CodexBridge read service 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** panel・watch・自動登録で共有するMCP read serviceを追加し、freshnessと接続世代を保ちながら実行中一覧を継続更新する。

**Architecture:** Service Worker singletonがclient、generation、running snapshot cache、single-flight、優先schedulerを所有する。monitorと自動登録は同じread serviceへ接続し、UIは鮮度を表示して5秒/30秒周期で一覧またはsummaryを更新する。

**Tech Stack:** Chrome MV3 Service Worker、TypeScript、Node built-in test runner、既存CodexBridge MCP client/storage。

**Spec:** `docs/superpowers/specs/2026-11-24-issue-25-shared-read-service-design.md`

## Global Constraints

- 設計specにない権限追加をしない。tokenをログ/保存/応答しない。
- 既存の`connectionId`、#23 owner lease、#24終端判定、watch/event/通知/final-answer契約を維持する。
- Chrome実機操作は行わずC55を`NOT_RUN`にする。C48〜C54記録を変更しない。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`を実行する。
- hand-written code/testは各500物理行かつ32 KiB以下。単一agent、現checkout利用。push/merge/Issue closeなし。

## Review Focus

- Auth/permission/endpoint切替後の遅延応答はsnapshot・status・client状態へ混ざらない。
- `running_only`の非対応/失敗/stale時も個別watchのstatus pollは続く。
- fresh complete snapshotから消えたthreadはstatus優先確認し、一覧不在だけで解除しない。
- 自動登録確定はfresh pageとowner/回答内の明示IDを再照合し、推定候補や別ownerを登録しない。
- 表示mode/target/SPA/minimize/worker再起動後にtimer、request、selection、paginationが破綻しない。

---

### Task 1: Service Worker shared read service

**Files:**
- Create: `src/background/codexbridge-read-service.ts`
- Create: `tests/codexbridge-read-service.test.ts`
- Modify: `src/shared/codexbridge-mcp-protocol.ts`

**Interfaces:**
- Produces: `CodexBridgeReadService`; `readTargets`, `readThreads`, `readStatus`, `readFinalAnswer`, `readRunningSnapshot`, `invalidate`, `scheduleRead`。
- Snapshot success contains `page`, `freshness`, `observedAt`, `ageMs`, `failureReason`。Options support TTL/force/priority.

- [x] Add RED tests for same-target running snapshot single-flight/cache TTL, separate target cache, manual force, queue priority/concurrency cap, failure backoff/stale metadata, credential generation invalidation and dropped old response.
- [x] Add `connection-changed` failure and extension response snapshot metadata to the shared MCP protocol types.
- [x] Implement one in-memory client per active endpoint/token context; generation checks before and after queued/network work.
- [x] Implement 5s/30s TTL, 2s candidate freshness, 5s→5m backoff, 3 active reads, 48 queued reads, priority/FIFO, and per-operation single-flight.
- [x] Run `node --experimental-strip-types --test tests/codexbridge-read-service.test.ts` and observe RED→GREEN.

### Task 2: Panel and individual watch integration

**Files:**
- Modify: `src/background.ts`
- Modify: `src/background/codexbridge-panel.ts`
- Modify: `src/background/codexbridge-thread-monitor.ts`
- Modify: `src/background/thread-monitor.ts`
- Create: `src/background/thread-monitor-running-snapshot.ts`
- Modify: `tests/codexbridge-panel.test.ts`
- Modify: `tests/codexbridge-thread-monitor.test.ts`
- Modify: `tests/codexbridge-thread-monitor-review-fixes.test.ts`

**Interfaces:**
- Consumes Task 1 service/snapshot contracts.
- Produces one background singleton shared by panel handler and monitor; monitor read access remains usable when running-only is unsupported.

- [x] Test simultaneous panel/watch refreshes share a snapshot; fresh absence raises matching status priority; presence continues status checks; running-only error/unsupported/stale does not stop watch polling.
- [x] Route panel targets/pages/status through the shared service and validate refresh mode/priority message fields.
- [x] Remove the monitor's second MCP client cache. Use common scheduler once per MCP read; keep storage, notifications and delivery outside its queue.
- [x] Add permission/token/endpoint listeners that invalidate only in-memory service state; preserve existing worker restore and watch alarm.
- [x] Run focused panel/monitor suites and confirm existing #24 terminal/gap, deduplication and notification tests pass.

### Task 3: Candidate and completion freshness

**Files:**
- Modify: `src/background/thread-monitor-auto-registration-candidates.ts`
- Modify: `src/background/thread-monitor-auto-registration.ts`
- Modify: `tests/codexbridge-auto-watch-registration.test.ts`
- Modify: `tests/codexbridge-auto-watch-bridge-first.test.ts`
- Modify: `tests/codexbridge-auto-watch-completion.test.ts`

**Interfaces:**
- Consumes Task 1 `readRunningSnapshot` and Task 2 shared `CodexBridgeMonitorAccess`.

- [x] Test candidate result refuses stale/incomplete/error page, accepts only live execution, and stays bound to the current owner/connection.
- [x] Test completion registration forces a fresh page and refuses old cached-only IDs after owner/connection change.
- [x] Use shared target read and snapshot methods; preserve exact answer-ID matching, skip/mute/lease, no blanket registration and watch ownership.
- [x] Run candidate, completion, owner rebind and terminal auto-unwatch suites.

### Task 4: Running list cadence and stale presentation

**Files:**
- Create: `src/content/codexbridge-running-refresh.ts`
- Modify: `src/content/CodexBridgeList.tsx`
- Modify: `src/content/codexbridge-running-summary.ts`
- Modify: `src/content/BridgeSummaryBar.tsx`
- Modify: `tests/codexbridge-running-summary.test.ts`
- Create: `tests/codexbridge-running-refresh.test.ts`

- [x] Test visible cadence 5s, background/minimized cadence 30s, and cleanup on disable/target/mode/route changes.
- [x] Test fresh count, stale count `—`, stale-list label, unknown initial state and unsupported/error display.
- [x] Refresh running A list periodically and only summary in normal mode; preserve cursor pagination, selection and existing hover/watch/event UI.
- [x] Pass manual `force` and foreground/background priority through the extension message; ignore stale responses after target/route/mode changes.
- [x] Run running-summary, request-tracker, thread-selection, terminal-refresh and UI-related test files.

### Task 5: C55 acceptance and final closure

**Files:**
- Create: `docs/c55-shared-running-snapshot-acceptance.md`
- Modify: `docs/panel-main-v2-final-acceptance-checklist.md`
- Modify: `docs/panel-main-v2-phase-progress.md`
- Modify: this plan ledger/result.

- [x] Add C55 Chrome steps for multi-tab coalescing, start/end without terminal event, stale/auth switch, missing-thread status, failure fallback, pagination/selection, worker restore and existing C48–C54 behavior; mark all live checks `NOT_RUN`.
- [x] Verify C48–C54 acceptance rows/results are unchanged.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`; read exit codes and outputs.
- [x] Review `git diff`, verify size caps and branch state, then commit implementation/docs. Do not push, merge or close the issue.

## 実測結果

- `pnpm test`: PASS、887/887。内包するOptions/Content/Service Worker/offscreen buildも成功。
- `pnpm typecheck`: PASS。`pnpm lint`: PASS。`pnpm check:size`: PASS、312ファイルが500行・32KiB以内。
- 独立した`pnpm build`: PASS。`git diff --check`: PASS（改行コード変換の警告のみ）。
- C55 Chrome実機受入: `NOT_RUN`。C48〜C54の受入記録は未変更。
- 実装を現在のbranchへlocal commitした（`55d4698`）。push/merge/Issue closeは行っていない。
