# ChatPanelPlus Phase 3 Conversation History Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add bounded, user-started conversation history scanning and passive collection of turns revealed by ordinary user scrolling, while preserving cumulative per-conversation statistics.

**Architecture:** Keep storage keyed by Conversation ID and Turn Key. Add a content-side history scanner that starts from the current DOM, finds a verified scrollable ancestor shared by conversation turns (including ancestors outside `main`), visits the older edge, then traverses to the newer edge, and reports bounded outcomes to the existing controller; route checks and explicit cancellation stop it. Add a separate debounced mutation and visible-range path for history turns revealed after user scroll intent. Keep the popup and its controls inside the statistics popover, anchored above the panel when space permits.

**Tech Stack:** TypeScript, React, Chrome extension content script, existing repository/session APIs, Node test runner and current project scripts.

**Spec:** User-provided “ChatPanelPlus Phase 3 — 会話履歴の自動走査と統計UI改善” in the implementation request. Existing baseline: `docs/design/12-conversation-statistics.md`.

## Global Constraints

- Keep Conversation ID and Turn Key scoped cumulative storage; do not remove stored keys or reduce a saved Turns count.
- Do not use private APIs, ChatGPT's private React state, or internal ChatGPT network calls; scroll only a verified scrollable ancestor of conversation turns inside `main`.
- Do not auto-scroll on page open, change Composer text, intercept send behavior, or alter copy/paste behavior.
- Keep persisted storage schema version 1 and do not persist message bodies.
- Do not perform Git operations or Chrome deployment.
- Keep hand-written source, styles, and tests at or below 500 physical lines and 32 KiB per file.

## Review Focus

- A route change during a wait must stop the scanner before observations can be written to the next conversation.
- A scroll event caused by the statistics panel or an active scan must not trigger the passive collection path.
- A missing or non-scrollable conversation ancestor must return without scrolling another page element.
- In-progress or unknown Assistant output must remain uncounted until existing completion rules permit it.
- Mutation bursts from virtualized history must be debounced and processed from candidate turns without repeatedly scanning the full transcript.

---

### Task 1: Non-destructive session updates and bounded history scanning

**Files:**
- Create: `src/content/conversation-statistics-history.ts`
- Modify: `src/content/conversation-statistics-session.ts`
- Modify: `src/content/conversation-statistics-controller.ts`
- Test: `tests/conversation-statistics-history.test.ts`
- Test: `tests/conversation-statistics-controller.test.ts`
- Test: `tests/conversation-statistics-session.test.ts`
- Test utility: `tests/conversation-statistics-controller-fixture.ts`

**Interfaces:**
- `ConversationStatisticsSession.observeHistory(observations: readonly StatisticsObservation[]): readonly string[]` merges observations in manual cumulative mode, retains all prior Turn Keys, updates identities, and returns newly INPUT-measured Turn Keys.
- `ConversationStatisticsHistoryScanner.start(): Promise<HistoryScanResult>` begins one scan; `cancel(): void` requests cancellation; `dispose(): void` removes listeners and stops active work.
- The scanner reports each settled DOM snapshot and progress to the controller. The controller verifies the captured Conversation ID and `main` before applying it.

- [x] **Step 1: Write failing storage and scanner tests**
  - Verify 131 saved Turns remain 131 for a partial snapshot and become 151 after 20 new INPUT-measured Turn Keys.
  - Verify scanning the same Turn Keys again remains at 151 and updates the same Turn Key’s output rather than adding a turn.
  - Verify the scanner reaches the top, then visits downward to the bottom, and accumulates keys from every settled snapshot even when virtualized turns disappear.
  - Verify it discovers a scrollable conversation ancestor outside `main`, while missing or unsafe targets cause zero scroll changes.
  - Verify the scanner visits both directions in bounded increments, stops at each edge only after stable snapshots, and returns a partial result when execution limits are reached.
  - Verify explicit cancellation preserves observations already delivered and route change prevents later observations from reaching the session.
- [x] **Step 2: Run the new focused tests and confirm they fail for missing behavior**
  - Run: `node --experimental-strip-types --test tests/conversation-statistics-history.test.ts tests/conversation-statistics-session.test.ts tests/conversation-statistics-controller.test.ts`
  - Expected: scanner imports/API or cumulative session behavior is missing.
- [x] **Step 3: Implement cumulative session observation and scanner lifecycle**
  - Add a session method using the existing manual merge semantics without replacing `turnOrder` or clearing prior identities and rows.
  - Detect candidates by walking ancestors of conversation turns from inside `main` outward; require a real vertical scroll range and conversation-turn containment, and reject the document/body, the Composer itself, and targets that cannot be safely identified.
  - Preserve the initial `scrollTop` and focus reference; restore only while the same conversation/container remains valid.
  - Visit the top and then the bottom using split viewport steps, DOM-settle waits, a maximum of 240 steps and 90 seconds, and repeated stable observations at each edge. Treat all outcomes as partial statistics because DOM traversal cannot prove that ChatGPT exposed every stored turn.
  - Provide cancellation, route/disposal checks, scroll-interference handling, and `completed`, `partial`, `cancelled`, and `error` results.
  - Keep the existing send-detection path independent and retain its completion/re-generation behavior.
- [x] **Step 4: Run focused tests and confirm they pass**
  - Run: `node --experimental-strip-types --test tests/conversation-statistics-history.test.ts tests/conversation-statistics-session.test.ts tests/conversation-statistics-controller.test.ts`
  - Expected: cumulative, route, cancellation, limit, and missing-container cases pass.

### Task 2: Debounced collection from ordinary history scrolling

**Files:**
- Modify: `src/content/conversation-statistics-history.ts`
- Modify: `src/content/conversation-statistics-controller.ts`
- Test: `tests/conversation-statistics-history.test.ts`
- Test: `tests/conversation-statistics-controller.test.ts`

**Interfaces:**
- `handleMutations(records)` queues newly introduced candidates after a recent user scroll gesture. A throttled visible-range pass also checks already-present turns as they enter view; both paths deduplicate by Turn Key and observe candidates after one debounce interval.
- Passive observations use `observeHistory`; scan activity and send intent do not create passive scroll intent.

- [x] **Step 1: Add failing passive-collection tests**
  - Verify manually revealed turns are added once after a debounced mutation burst.
  - Verify an already-present, previously offscreen, unmeasured turn is collected when it enters the visible range.
  - Verify scroll events are throttled and inspect visible candidates without launching a full-history scan or rescanning all turn content.
  - Verify ordinary page initialization and non-scroll mutations do not collect old turns.
  - Verify a scan’s own DOM/scroll changes do not start the passive path.
  - Verify in-progress output does not become complete and Enter/button send tests continue to collect new submissions.
- [x] **Step 2: Run focused tests and confirm the passive path is absent**
  - Run: `node --experimental-strip-types --test tests/conversation-statistics-history.test.ts tests/conversation-statistics-controller.test.ts tests/conversation-statistics-send-intent.test.ts`
  - Expected: passive-history assertions fail before the implementation is added.
- [x] **Step 3: Implement debounced candidate-only collection**
  - Track recent wheel/touch/keyboard scroll intent inside the conversation area; ignore panel controls and Composer interactions.
  - Throttle visible-range checks and inspect only visible candidates, including candidates that were already in the DOM; debounce mutation handling for newly introduced turns. Ordinary scrolling never starts the full scanner.
  - Dispose timers and listeners on route change or controller stop.
- [x] **Step 4: Run the focused collection and send-intent tests**
  - Run: `node --experimental-strip-types --test tests/conversation-statistics-history.test.ts tests/conversation-statistics-controller.test.ts tests/conversation-statistics-send-intent.test.ts`
  - Expected: passive collection is incremental and all existing send-intent cases pass.

### Task 3: Statistics popover controls, progress, and viewport placement

**Files:**
- Modify: `src/content/ConversationStatistics.tsx`
- Modify: `src/content/panel.css`
- Test: `tests/conversation-statistics-ui.test.mjs`

**Interfaces:**
- The controller view state exposes scan phase, newly measured Turn count, and final outcome; the UI calls `scanAllHistory()` or `cancelHistoryScan()`.

- [x] **Step 1: Add failing UI behavior checks**
  - Verify both `再集計` and `全履歴を集計` render inside the popover, horizontally together, and the latter changes to `中止` during scanning.
  - Verify progress shows the current cumulative Turns and no guessed percentage.
  - Verify the compact partial-measurement explanation, scan end states, Escape close behavior, and minimum button hit area.
  - Verify popover placement prefers above the trigger, clamps to viewport space, and keeps the action row visible while explanatory content can scroll.
- [x] **Step 2: Run the UI test and confirm the new controls and placement are missing**
  - Run: `node --test tests/conversation-statistics-ui.test.mjs`
  - Expected: new UI assertions fail against the single lower-opening recount button.
- [x] **Step 3: Implement the two-button footer and measured placement**
  - Keep the main panel’s Turns trigger unchanged.
  - Add the two controls side-by-side at the bottom of the popover; disable conflicting actions while recounting/scanning.
  - Position the popover using the trigger and viewport measurements, preferring above and reducing available height when needed; make only the explanatory area scrollable.
  - Preserve light/dark styling, minimization behavior, and Escape handling.
- [x] **Step 4: Run the UI test**
  - Run: `node --test tests/conversation-statistics-ui.test.mjs`
  - Expected: both controls remain reachable in desktop and narrow viewport layouts.

### Task 4: Align the design record and run the requested verification suite

**Files:**
- Modify: `docs/design/12-conversation-statistics.md`
- Verify: project scripts from `package.json`

- [x] **Step 1: Update the design record**
  - Replace Phase 2 statements that prohibit automatic history collection with the Phase 3 behavior and limitations: explicit bounded top-to-bottom scan, scroll-triggered visible-range collection, partial status, cancellation, and user-facing controls.
- [x] **Step 2: Run all requested commands and check file-size limits**
  - Run each to completion: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`, and `pnpm check:size`.
  - `pnpm check` is explicitly requested but currently has no package script; record its actual result and run `pnpm check:size`, which is the configured size guard.
  - Expected: configured project commands exit 0; any remaining real ChatGPT DOM uncertainty is documented rather than represented as verified.

## Self-Review

- Coverage: cumulative merge and regeneration are covered in Task 1; automatic collection and non-interference with send detection are covered in Task 2; all requested UI behavior is covered in Task 3; specification consistency and the full command list are covered in Task 4.
- Boundaries: no persisted schema change, no message text persistence, no ChatGPT private API, no automatic page-open scroll, no Git operation, and no Chrome deployment.
- Review focus cases map to Tasks 1 and 2 tests; UI narrow-screen behavior maps to Task 3.
- Controller is currently 500 lines, so implementation must keep it within the documented 500-line limit by putting scan coordination in the new focused history module and extracting only history-specific logic where needed.
