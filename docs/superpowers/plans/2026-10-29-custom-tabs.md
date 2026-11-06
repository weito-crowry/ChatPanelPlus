# カスタムタブとグループ編集 実装計画

**Goal:** Options で既定・カスタムタブとボタン所属を編集し、schema v1・既存データ・JSON・パネル表示との互換性を保つ。

**Architecture:** `default-ui.ts` を ID と表示解決の基点にし、`settings.ts` が新フィールドを検証する。Repository はフィールド/ID/グループ単位で既存の base/draft/latest マージを拡張する。Options の純粋な状態遷移を分離し、UI はドラフトのみを更新して保存成功時に Repository が通知する。

**Tech Stack:** TypeScript, React, chrome.storage.local, Node test runner, pnpm.

**Spec:** Issue #14 requirements supplied in the user request.

## Global Constraints

- Keep schemaVersion 1 and all new fields optional.
- Preserve default IDs, 5 tabs, 20 buttons, and existing settings behavior.
- Keep hand-written code at or below 500 lines and 32 KiB.
- Do not automate Chrome, deploy, commit, push, or create a PR.

## Review Focus

- Old settings with omitted new fields resolve to the existing layout; covered by settings/default UI tests.
- Custom IDs referenced after deletion fail validation; covered by settings tests.
- Group movement updates owner and both orders atomically; covered by options-state and repository tests.
- Independent edits merge while same-tab/button/order edits conflict; covered by repository tests.
- Legacy JSON import preserves newly created tabs and group overrides; covered by options-state tests.

### Task 1: Shared model and resolver

Files: `src/shared/default-ui.ts`, `src/shared/settings.ts`, tests for settings/default UI. Add custom tab/group ID types, label and ownership overrides, validation, resolution, selected tab validation.

### Task 2: Draft state, imports and reset

Files: `options/src/options-state.ts`, tests for options state. Implement tab CRUD, group movement, custom-tab-preserving reset and legacy import preservation.

### Task 3: Repository diff and conflict handling

Files: `src/shared/settings-repository.ts`, repository tests. Diff default-tab fields/custom-tab IDs/default-button owners/custom-button records/tab order/group orders independently; classify integrity failures as conflicts.

### Task 4: Options editor and panel integration

Files: split tab editor component, `OptionsPage.tsx`, styles, `src/content/Panel.tsx`, `src/content/panel-view.ts`, UI tests. Add tab controls, delete destination, group selectors, view fallback; only saved settings feed the panel.

### Task 5: JSON behavior, reset, documentation and regression verification

Files: Options import UI and docs `04`, `05`, `06`, `15`; extend tests for import/reset and regression. Run required typecheck, lint, build, and full tests.
