# C46 Auto Watch Completion Diagnostic Implementation Plan

> **For agentic workers:** Implement natively in the current session. Subagents and worktrees are prohibited. Steps use checkbox syntax.

**Goal:** Prevent unrelated main DOM mutations from rejecting C46 answer matching and expose a privacy-safe, event-driven trace of the latest completion attempt.

**Architecture:** Reuse the current answer-completion and Bridge candidate flow. Apply one relevance predicate to both delivered and pending mutation records, retain strict turn/root checks, and keep diagnostic reason codes, counts, and timestamps in the mounted control's memory only.

**Tech Stack:** Chrome MV3, TypeScript/React, Node test runner, pnpm.

**Spec:** Existing owner identity design at `docs/superpowers/specs/2026-11-23-c46-owner-identity-design.md`; incident evidence and next acceptance procedure will be recorded in `docs/c46-auto-watch-completion-diagnostic.md`.

## Global Constraints

- Keep the exact flow: completed answer -> Bridge running IDs -> exact answer-body match -> register matching IDs only.
- Do not persist or log answer text, thread IDs, turn IDs, DOM, or conversation text.
- Do not add polling, permissions, Chrome automation, Bridge operations, worktrees, or subagents.
- Preserve existing manual watches, completion notifications, owner/mute checks, and stored watch/event data.
- Build only to this checkout's `dist`; real Chrome acceptance remains user-run.

## Review Focus

- Pending unrelated main attribute/child/text mutations remain eligible; test all three while candidates are unresolved.
- Turn edits, detach/move, same-key replacement, root replacement, route and owner changes remain rejected; exercise focused DOM and existing isolation tests.
- Only a completed answer's exact live candidate ID is registered, including IDs inside code spans; exercise the text matcher and registration integration.
- Completion diagnostics remain independent of sound settings and contain only stage, safe reason, counts, and time; exercise tracker/check events, UI source, and existing sound variants.
- A conversation/target change hides the previous diagnostic; verify scope handling and route reset.

---

### Task 1: Reproduce and fix pending DOM false positives

**Files:**
- Modify: `tests/conversation-statistics-controller-fixture.ts`
- Test: `tests/codexbridge-auto-watch-bridge-first.test.ts`
- Modify: `src/content/codexbridge-auto-watch-completion.ts`

- [x] Add queued pending-record support and a failing test for unrelated main attribute, child-list, and text mutations during Bridge lookup.
- [x] Run the focused test and confirm `dom-changed` is the failure.
- [x] Apply the same turn relevance check to callback records and `takeRecords()`, retaining connectivity, uniqueness, root, and turn mutation checks.
- [x] Verify matching turn mutations/removal/replacement still reject.

### Task 2: Expose an ephemeral completion trace

**Files:**
- Modify: `src/content/answer-completion-sound.ts`
- Modify: `src/content/conversation-statistics-controller.ts`
- Modify: `src/content/ConversationStatistics.tsx`
- Modify: `src/content/codexbridge-auto-watch-completion.ts`
- Modify: `src/content/CodexBridgeAutoWatchControl.tsx`
- Test: focused completion, Bridge-first, registration, and UI contract tests.

- [x] Report the checker's completed-cycle event result without including turn/message IDs.
- [x] Report candidate success/failure/count, body match result/reason/count, and registration result/reason/count to an in-memory, route-scoped details row.
- [x] Clear or hide prior-conversation state on route/target change; keep the flow answer-event driven and sound-independent.
- [x] Cover code-span extraction, two live candidate IDs with one matching, owner/route rejection, and registration count.

### Task 3: Document, verify, and commit

**Files:**
- Create: `docs/c46-auto-watch-completion-diagnostic.md`
- Update: this plan.

- [x] Record observed C46 evidence, confirmed code behavior, unproven causes, diagnostic fields, and manual next acceptance steps.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm check:size`, `pnpm build`, and `git diff --check`; record results and test count.
- [x] Review the diff and commit locally; do not push or merge.
- [x] Report Chrome acceptance as `NOT_RUN`.
