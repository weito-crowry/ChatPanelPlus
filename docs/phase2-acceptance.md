# Phase 2 — Main panel UI acceptance

## Current result

- Status: **PENDING / NOT_RUN** for Chrome acceptance. Phase 2 has not been deployed or reloaded in Chrome.
- Automated baseline from Phase 1: 496 passed, 0 failed. Phase 2 isolated full suite: 501 passed, 0 failed (five added UI contract tests).
- `pnpm typecheck`: PASS. `pnpm lint`: PASS, including the 500-line / 32 KiB source-size check.
- The full suite built and ran in a source-only temporary copy with the repository `dist/` excluded and `node_modules` linked. The live `dist/` SHA-256 file manifest matched before and after (11 files).
- No Phase 2 build was run against the repository `dist/`; no deployment or Chrome reload was performed.
- Phase 2 keeps the existing shared settings and current tab/minimize persistence unchanged. Bridge detail expansion is local component state and is not written to the shared view-state repository.
- The normal view shows only the planned Bridge summary categories. Their values are explicit placeholders until Phase 4 connects conversation-owned counts; no `0` count is presented as real data.
- Until Phase 4 owner filtering is implemented, the expanded existing watch/event list remains shared. The UI identifies this so it is not presented as conversation-specific.
- The registered Chrome load source is the repository's `dist/`. All build-backed tests must use a source-only temporary copy with `dist/` excluded and compare the live `dist/` SHA-256 manifest before and after.
- Do not use `pnpm deploy:chrome` for this checkout while `scripts/deploy-chrome.mjs` still targets the sibling `ChatPanelPlus-Content-Probe-20261021`. Phase 2 does not change that script or build into the live `dist/`.

## Manual checks after an authorized Chrome reload

Record each item as PASS, FAIL, or NOT_RUN. The Phase 2 code change itself does not reload Chrome.

- [ ] Normal view keeps the existing header, Codex Work Mode toggle, sound/statistics control, resolved always-visible buttons, and resolved tab/prompt buttons.
- [ ] Configured button labels, order, group, visibility, and text remain controlled by Options; the four default insertion prompts are not duplicated or forced visible.
- [ ] The Bridge summary contains only “監視中” and “監視スレッドが終了した未確認”; both indicate Phase 4 connection pending and show no fabricated count.
- [ ] Bridge detail toggle works by pointer and keyboard, updates `aria-expanded`, and exposes/hides the controlled region.
- [ ] Expanded Bridge flow remains thread discovery → existing watch start/stop → terminal event list, with the shared-list scope note visible.
- [ ] Existing Bridge connection, discovery, monitor, event, and final-answer controls remain available with their current runtime-message behavior.
- [ ] Minimize/restore hides and restores the body while preserving the existing header/work-mode and minimize control behavior.
- [ ] At the initial 900px maximum width and below the 640px container breakpoint, summary cards remain readable and do not overflow.
- [ ] Existing beginning/caret insertion, paste/manual paste, clear, custom buttons, Options opening, sound control, and conversation statistics remain usable without automatic send.
- [ ] SPA navigation and page reload do not leave duplicate panels or stale handlers.

## Phase 2 gate

**PENDING** — automated checks and live-`dist` protection PASS; user-run Chrome checklist remains NOT_RUN. Phase 3 must not start while this gate is pending.
