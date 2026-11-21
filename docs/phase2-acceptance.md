# Phase 2 — Main panel UI acceptance

## Current result

- Status: **AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED**. Per the user's 2026-11-21 instruction, automated acceptance and registered-`dist` deployment are sufficient for the Phase 2 gate; Chrome interaction is deferred until the combined final checklist.
- Automated baseline from Phase 1: 496 passed, 0 failed. Phase 2 isolated full suite: 501 passed, 0 failed (five added UI contract tests).
- `pnpm typecheck`: PASS. `pnpm lint`: PASS, including the 500-line / 32 KiB source-size check.
- The full suite built and ran in a source-only temporary copy with repository `dist/` excluded and `node_modules` linked. The live `dist/` SHA-256 file manifest matched before and after (11 files).
- Phase 2 implementation commit: `4eb037a3fa04ddcb47afb1bc724b81d296fa19ec`.
- The registered repository `dist/` was deployed with `pnpm build` (exit 0) after a full verified sibling backup named `ChatPanelPlus-dist-phase2-predeploy-backup-20261121-110332-602`. The post-build tree had 11 files; manifest V3/version `0.1.5`, six required files, and referenced assets were verified. Only `content.js` differed from the pre-build Phase 1 live contents.
- The user has not reloaded Chrome or reported a Phase 2 screen check. The checklist items below remain **NOT_RUN**, not individual PASS results.
- Phase 2 keeps existing shared settings and current tab/minimize persistence unchanged. Bridge detail expansion is local component state and is not written to the shared view-state repository.
- The normal view shows only the planned Bridge summary categories. Their values are placeholders until Phase 4 connects conversation-owned counts; no `0` count is presented as real data.
- Until Phase 4 owner filtering is implemented, the expanded existing watch/event list remains shared. The UI identifies this so it is not presented as conversation-specific.
- The registered Chrome load source is the repository's `dist/`. Build-backed tests use a source-only temporary copy with `dist/` excluded and compare the live `dist/` SHA-256 manifest before and after.
- `pnpm deploy:chrome` remains unsuitable for this checkout while `scripts/deploy-chrome.mjs` targets the sibling `ChatPanelPlus-Content-Probe-20261021`. It was not used for the registered-`dist` deployment.

## Deferred implementation and observation items

- The four default insertion prompts (“全文／要約／翻訳／調べて”) remain in their configured prompt tab; Phase 2 did not move them into a new always-visible area.
- Background watch/event processing while Bridge details are collapsed has not been observed in Chrome.
- Layout width, the 640px breakpoint, and readability have not been measured in a live Chrome panel.

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

**AUTO_ACCEPTED** — automated checks and registered-`dist` deployment PASS. **CHROME_SMOKE_DEFERRED** — the user will perform the unchecked screen checks after all phases; no individual browser item is marked PASS here.
