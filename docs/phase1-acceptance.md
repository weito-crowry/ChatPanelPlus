# Phase 1 — Chrome acceptance checklist

## Current result

- Phase 1 overall acceptance: **PASS**, based on the user's Chrome acceptance report on 2026-11-21.
- Automated baseline: isolated pnpm test on the pre-change source copy — 495 passed, 0 failed.
- Changed-source automated suite: isolated pnpm test — 496 passed, 0 failed.
- Static checks: pnpm typecheck PASS; pnpm lint PASS (including the 500-line / 32 KiB source-size check).
- Phase 1 implementation commit: `efe5b26aa3a37cab7db94c7c6d2fe0969f099e1b`.
- The initial 8 changed-source failures were source-structure assertions still reading Panel.tsx. Their assertions now inspect PanelView.tsx and usePanelController.ts while retaining DOM, ARIA, event, and state-flow checks.
- The user confirmed the registered Chrome extension load source is the repository's `dist/`. An earlier `pnpm deploy:chrome` copied to the sibling `ChatPanelPlus-Content-Probe-20261021`; this was the wrong folder for the registered extension. The repository `dist/` was then backed up and rebuilt directly with `pnpm build`; its post-build files and hashes were verified before the user's Chrome reload.
- On 2026-11-21, the user reported reloading the extension from `dist/`, completing Phase 1 checks, and that it worked. This supports the overall PASS. The report did not provide item-by-item observations, so no individual manual checklist item below is marked PASS.
- The fixed destination in `scripts/deploy-chrome.mjs` still names the sibling Probe folder; that mismatch is recorded for follow-up and was not changed as part of Phase 1 acceptance.
- Phase 1's isolated test run kept the live repo-root `dist/` unchanged by comparing its SHA-256 file manifest before and after.

## Manual checks after an approved Chrome reload

Record each result as PASS, FAIL, or NOT_RUN. Do not treat an unrun browser check as a test pass.

- [ ] Panel root, header, title, Bridge list, utility buttons, tab list, tab panel, error status, settings entry, manual-paste dialog, and minimize control appear in the existing order.
- [ ] Existing CSS classes, tab IDs, ARIA roles/labels/selection, hidden states, and minimize aria-expanded behavior remain unchanged.
- [ ] Beginning and caret insertion use the same button behavior; caret insertion retains the original selection/caret location.
- [ ] Clipboard paste and fallback/manual paste preserve the selected editor, return focus after submit/cancel, and do not duplicate text.
- [ ] Clear still clears the current composer; custom buttons and custom tabs still render and dispatch their configured actions.
- [ ] Tab selection and minimize/restore still persist through the existing shared view-state repository.
- [ ] Settings entry opens Options; sound ON/OFF and conversation statistics still behave as before.
- [ ] CodexBridge connection/list/monitor controls remain available and retain their existing runtime-message contract.
- [ ] SPA navigation and page reload do not leave duplicate panel UI or stale event listeners.

## Phase 1 gate

**PASS** for Phase 1 overall, based on the user's 2026-11-21 Chrome acceptance report. The unchecked manual items remain unverified individually because the report was not itemized.
