# Issue 26 Live Turn Auto Watch Implementation Plan

> **For agentic workers:** Execute inline in the current checkout. Do not create a worktree or delegate to a subagent.

**Goal:** Allow answer-completion auto-watch to match either a canonical Bridge thread ID or that thread's current live execution turn ID.

**Architecture:** The background returns canonical `{ threadId, turnId }` pairs derived from a fresh `running_only` snapshot and the existing `linkLiveCodexBridgeExecutionTurn` helper. Content matching uses strict token boundaries, existing native/target-qualified thread aliases, and exact live turn IDs. A thread-ID match keeps existing thread-level semantics; a turn-only match carries its expected turn ID to a second fresh Bridge read immediately before registration.

**Tech Stack:** TypeScript, Chrome Extension MV3, Node test runner, pnpm.

**Spec:** GitHub Issue #26 and the user-approved implementation requirements in the task request.

## Approaches

- **Selected: carry live thread/turn pairs through the existing candidate flow.** This uses the already-fresh Bridge snapshot, preserves one canonical unit per thread, and makes turn-only registration recheck precise.
- **Rejected: search historical turns or query Turn IDs independently.** This can match non-live or ambiguous execution history and adds a second source of identity beyond the approved live snapshot.

## Global Constraints

- Preserve explicit skip, owner lease, conversation isolation, canonical thread exclusion, and #25 generation/freshness behavior.
- Preserve the existing Thread ID registration meaning when the answer explicitly names that thread.
- Reject ambiguous aliases, URL occurrences, partial matches, other targets, and non-live/historical/estimated/inferred turns.
- Do not add IDs or answer text to diagnostic logs; retain existing final-answer, notification, and auto-reflect behavior.
- Keep hand-written code and test files within 500 lines and 32 KiB.
- Do not create a worktree or subagent, use a temporary Chrome profile, push, merge, or close the issue.

## Review Focus

- Same canonical thread matched by both IDs or repeated text registers once; explicit thread match does not pin a turn.
- Turn-only candidate that changes before registration is rejected; exact current live turn on its original thread is accepted.
- Alias collision, URL, partial token, other target, and non-live linked turn never register.
- Candidate/registration validators and limits count canonical threads and bound the complete ID payload.
- Existing owner, skip, freshness, completion, notification, and C46-C55 behaviors remain intact.

## Tasks

### Task 1: Content-side matching and registration request

**Files:** `src/content/codexbridge-auto-watch-completion.ts`, `src/content/CodexBridgeAutoWatchControl.tsx`, `tests/codexbridge-auto-watch-completion.test.ts`, `tests/codexbridge-auto-watch-bridge-first.test.ts`, `tests/codexbridge-auto-watch-current-dom.test.ts`, `tests/codexbridge-auto-watch-live-turn.test.ts`.

- [x] Add failing tests for thread-only, turn-only, both IDs, duplicate occurrences, multiple threads, collisions, URL/partial matches, and target-qualified aliases.
- [x] Run focused tests and confirm failure on the missing live-turn behavior.
- [x] Implement canonical candidate-pair parsing and content matching. Omit the expected-turn pair for explicit thread-ID matches and include it for turn-only matches.
- [x] Add failing then passing tests for registration messages carrying per-thread expected turns without text or IDs in diagnostics.
- [x] Re-read the current answer before sending the registration request, using the same pairing rules.
- [x] Update the user-facing description to say Thread ID or live execution Turn ID.

### Task 2: Background candidate and registration protocol

**Files:** `src/shared/codexbridge-thread-monitor-protocol.ts`, `src/background/codexbridge-thread-monitor.ts`, `src/background/thread-monitor-auto-registration-candidates.ts`, `src/background/thread-monitor-auto-registration.ts`, `src/background/thread-monitor-auto-registration-completion.ts`, relevant `tests/codexbridge-auto-watch-*.test.ts` including `tests/codexbridge-auto-watch-live-turn.test.ts`, and `tests/codexbridge-thread-monitor-handler.test.ts`.

- [x] Add failing tests proving candidates include only linked live current turns and count/bound canonical thread pairs.
- [x] Add failing tests proving a turn-only request is accepted only when the fresh snapshot has the same live turn on the same thread; thread-ID-only requests retain current behavior.
- [x] Extend protocol types, validators, character/count bounds, and diagnostic counts around unique canonical thread units.
- [x] Preserve current generation, owner, skip, target, and connection checks; verify duplicate candidates cannot inflate registration counts.

### Task 3: Full verification and commit

- [x] Run the full `pnpm test` suite and read its final exit code and summary.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check`.
- [x] Review the final diff and commit the implementation and plan on the current branch.
- [x] Report Chrome reload/F5 steps; leave C56 or equivalent real-Chrome acceptance NOT_RUN and retain existing device records.
