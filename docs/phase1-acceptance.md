# Phase 1 — Chrome acceptance checklist

## Current result

- Status: **NEEDS_HUMAN_SMOKE**. The refactor has not been deployed to or reloaded in Chrome.
- Automated baseline: isolated pnpm test on the pre-change source copy — 495 passed, 0 failed.
- Changed-source automated suite: isolated pnpm test — 496 passed, 0 failed.
- Static checks: pnpm typecheck PASS; pnpm lint PASS (including the 500-line / 32 KiB source-size check).
- The initial 8 changed-source failures were source-structure assertions still reading Panel.tsx. Their assertions now inspect PanelView.tsx and usePanelController.ts while retaining DOM, ARIA, event, and state-flow checks.
- Live repo-root dist/ SHA-256 file manifest was identical before and after the isolated build/test run.
- The repo-root dist/ is the live Chrome load source. Phase 1 tests must build only in the isolated source copy and verify the live dist/ manifest before and after.

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

**PENDING** until the required Chrome checks have recorded their outcomes. Phase 2 must not start while this gate is pending.
