# C46 owner tab identity Implementation Plan

> **For agentic workers:** Implement natively in the current session with `superpowers:executing-plans`; subagents and worktrees are prohibited by the task instructions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm the owner tab's current conversation without reading the restricted tab URL and report stale ownership accurately.

**Architecture:** The background sends a nonce-bearing message to the specified tab's main-frame content script and accepts only an exact response for the saved conversation. Auto-watch status includes the trusted caller tab; an explicit ON action may replace a stale same-conversation owner record only after the old tab returns a valid different route identity or its tab ID is confirmed closed.

**Tech Stack:** Chrome Manifest V3, TypeScript, Node test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-23-c46-owner-identity-design.md`

## Global Constraints

- Do not add `tabs` or any host permission.
- Preserve exact completed-answer thread-ID matching and live Bridge evidence.
- Do not re-enable periodic discovery or mutate existing watch/event records during owner repair.
- Keep unknown, mismatched, closed, and timed-out owner identities fail-closed for owner validation; permit rebind only for a confirmed different route or closed tab.
- Use the existing checkout and commit locally; do not push, merge, or operate real Chrome/Bridge.

## Review Focus

- URL-less or unavailable `tabs.get` must not prevent an authenticated exact-route ping from confirming the owner; exercise in the identity tests.
- A wrong origin, credential-bearing URL, different conversation, malformed reply, or wrong nonce must fail closed; exercise the content responder and owner matcher tests.
- Closed tabs and a content script that never responds must fail within the timeout; exercise rejected and pending sendMessage mocks.
- A stale owner ID must not display ON; explicit ON can rebind only the same conversation after a confirmed different route or closed tab; an open nonresponsive old tab remains a conflict.
- Completion registration, watch/event data, mute guards, and manual/periodic behavior must retain their existing contracts; run the targeted and full regression suites.

---

### Task 1: Replace tab URL read with content identity ping

**Files:**
- Create: `src/shared/codexbridge-owner-identity.ts`
- Modify: `src/content/main.tsx`
- Modify: `src/background/codexbridge-thread-monitor.ts`
- Test: `tests/codexbridge-owner-identity.test.ts`
- Test: `tests/codexbridge-thread-monitor-handler.test.ts`

**Interfaces:**
- Consumes: existing `conversationIdFromPath()` and `isConversationId()`.
- Produces: strict identity ping/pong constants and validators; `ownerTabMatchesConversation(tabs, tabId, conversationId, timeoutMs?)` using `tabs.sendMessage(..., { frameId: 0 })`.

- [x] Write tests for URL-less tab details, exact-route success, wrong route, malformed/unknown response, nonce mismatch, closed tab, timeout, and content responder origin/sender checks.
- [x] Run the focused identity tests and observe failures caused by the missing ping implementation.
- [x] Implement the protocol, exact content-script responder in `main.tsx`, and bounded background request. Do not change manifest permissions.
- [x] Run identity and thread-monitor-handler tests and confirm the fail-closed cases pass.

### Task 2: Bind status to the current owner tab and recover stale same-conversation entries

**Files:**
- Modify: `src/background/thread-monitor-auto-registration.ts`
- Modify: `src/background/codexbridge-thread-monitor.ts`
- Modify: `src/content/CodexBridgeAutoWatchControl.tsx`
- Test: `tests/codexbridge-auto-watch-registration.test.ts`
- Test: `tests/codexbridge-auto-watch-owner-rebind.test.ts`
- Test: `tests/codexbridge-watch-current-count.test.mjs`

**Interfaces:**
- `getStatus(targetId, conversationId, ownerTabId)` receives the tab ID from the trusted message sender.
- The existing ON action may replace a same-conversation owner entry only when the previous owner tab returns a valid different route identity or `tabs.get` confirms its ID is closed.

- [x] Add tests proving a stale/mismatched owner is not reported ON, an open nonresponsive owner remains a conflict, and a user-triggered ON can rebind a closed same-conversation entry while preserving watch/event records.
- [x] Run focused tests and observe the current conversation-only status and conflict behavior fail the new expectations.
- [x] Implement tab-scoped status, the bounded same-conversation rebind, and accurate owner-tab error text. Keep unknown, different-conversation, and live-owner conflicts rejected.
- [x] Run auto-registration, handler, owner-transfer, and status presentation tests.

### Task 3: Verify regressions and commit

**Files:** all changed files from Tasks 1 and 2.

- [x] Run `pnpm test` and confirm the full result and exit code.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm check:size`, and `pnpm build`.
- [x] Review `git diff`, `git diff --check`, and manifest permissions.
- [x] Commit the verified changes locally; do not push or merge.
- [x] Report the code-supported cause separately from unobserved historical runtime values and mark real Chrome acceptance `NOT_RUN`.
