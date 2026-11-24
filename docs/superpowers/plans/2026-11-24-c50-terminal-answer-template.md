# C50 最終回答自動反映テンプレート Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Single-agent work in the existing checkout; do not create worktrees or delegate.

**Goal:** Issue #22の共通メッセージテンプレートをOptionsで編集し、C47の確定最終回答へ安全に適用する。

**Architecture:** `ExtensionSettings`へtemplate fieldを追加し、schema version 1の旧設定は既定値に正規化する。SettingsRepositoryのfield patch経路を拡張し、Optionsの新しい「自動反映」sectionから保存する。C47は回答取得後・append直前に現行設定を読み、tokenを一回だけ文字列置換して既存appendへ渡す。

**Tech Stack:** TypeScript, React, Chrome `storage.local`, Node built-in test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-11-24-c50-terminal-answer-template-design.md` (Issue #22)

## Global Constraints

- schema versionは1のまま。templateは最大8,192 UTF-16 code unitsで、`##Codex最終回答##`を1個以上含む。
- 既定値・旧設定fallbackはトークン単独。trim・改行変換・Unicode normalizationをしない。
- 最終回答はC37 `retrieved + confirmed`のみ。owner guard、queue、dedupe、既存draft保護を維持し、送信は行わない。
- C48/C49記録は保持。Chrome実機はユーザーが行うためC50をNOT_RUNで記録する。
- サブエージェント、追加worktree、Chrome profile、dependency追加、push/merge/Issue closeは禁止。

## Review Focus

1. 旧schema 1 / 旧JSONのfield欠落はdefault tokenへ正規化され、回答単独の従来動作を保つ。
2. tokenなし・型不正・上限超過は保存/importを拒否し、固定文のみ挿入しない。
3. 回答内の同名token、`$&`、`$1`、空白、Markdown、CR/LFは文字列を変えず一回置換する。
4. queue中にOptionsで保存した最新templateを、そのeventのappend直前に一回だけ読み込む。load失敗時は可視failureで下書きを変えない。
5. C47のowner、ON時刻、pending/confirmed、重複、下書き保護、順次処理、送信なしを維持する。

---

## File Map

- `src/shared/codexbridge-terminal-answer-template.ts`: token/default/limit、validation、one-pass render。
- `src/shared/settings.ts`, `settings-repository.ts`: default/legacy normalization、validation、conflict patch field。
- `options/src/options-v2-state.ts`, `OptionsNavigation.tsx`, `OptionsPage.tsx`: 自動反映 section navigationと標準draft保存接続。
- `options/src/TerminalAnswerTemplateSettings.tsx`, `options/src/options.css`: textarea、説明、preview、draft default restore。
- `src/content/codexbridge-terminal-answer-auto-reflect.ts`, `CodexBridgeTerminalAnswerAutoReflectControl.tsx`: append直前の正規設定snapshot・failure表示。
- `tests/settings.test.ts`, `settings-repository.test.ts`, `custom-button-options.test.ts`, `options-v2-state.test.ts`, `options-page.test.mjs`, `codexbridge-terminal-answer-auto-reflect.test.ts`, `editor-append-text.test.ts`: behavior regressions.
- `docs/c50-terminal-answer-template-acceptance.md`, `docs/panel-main-v2-final-acceptance-checklist.md`, `docs/panel-main-v2-phase-progress.md`: manual acceptance procedure/status; preserve C48/C49 rows.

## Task 1: Template value contract and settings persistence

**Interfaces:** Export token, default, max length, `isValidCodexBridgeTerminalAnswerTemplate(value: unknown): value is string`, and `renderCodexBridgeTerminalAnswerTemplate(template: string, answer: string): string` from the new shared helper.

- [x] Add failing tests for old setting normalization, token-only default, token absence/type/length refusal, serialize/parse, and one-pass replacement including multiple tokens, token text inside answer, `$&`/`$1`, whitespace, CR/LF, and Markdown.
- [x] Run `node --experimental-strip-types --test tests/settings.test.ts tests/codexbridge-terminal-answer-auto-reflect.test.ts`; confirm failures identify missing behavior.
- [x] Implement helper and extend `ExtensionSettings`, `DEFAULT_SETTINGS`, `validateExtensionSettings`, and `SettingsRepository.settingPaths`.
- [x] Add repository tests for template-only conflict detection and legacy JSON import/reset default behavior; run focused tests to green.

## Task 2: Options editing, preview, import/reset/save behavior

**Interfaces:** `TerminalAnswerTemplateSettings` receives `value`, `disabled`, `onChange`; its default button changes only the draft. The page continues to save via `SettingsRepository.saveSettings`.

- [x] Extend Options section-state tests and Options-page tests to require the new route, textarea, token explanation, sample preview, default restore, and existing standard save/import/reset flow.
- [x] Run focused Options tests and confirm missing UI/route fails.
- [x] Add `auto-reflect` to `OptionsSectionId`, hash navigation and `OptionsPage`; add the editor component with an 8,192-character limit and fixed sample-answer preview.
- [x] Map missing-token validation failures to explicit Japanese save/import messages. Verify import parsing rejects invalid token templates and that reset restores the token-only template through the normal save path.
- [x] Run focused Options/settings tests to green.

## Task 3: C47 insertion-time settings snapshot

**Interfaces:** Auto-reflector dependency `readTemplate(): Promise<unknown>` returns the latest settings-derived template; invalid/load failure maps to `template-unavailable` before append.

- [x] Add failing reflector tests for template expansion, insert-time setting change during queue, settings load failure/corrupt template, and visible no-insert result.
- [x] Run `node --experimental-strip-types --test tests/codexbridge-terminal-answer-auto-reflect.test.ts`; confirm failures occur on missing template handling.
- [x] Load/validate shared settings immediately before append, render once, recheck existing event eligibility, and pass the result through `appendTextAtEnd`; add the visible result label.
- [x] Re-run C47 focused tests. Existing tests must continue to prove owner/route guard, ON timestamp, no empty/unconfirmed/failed response, serial queue, dedupe, draft preservation, manual actions, and no send behavior.

## Task 4: C50 manual acceptance record and final verification

- [x] Add `docs/c50-terminal-answer-template-acceptance.md` and C50 checklist/progress rows covering template display/save/reset/import/export, placeholder semantics, live saved changes, queue, error, owner/draft/no-send and reload; all Chrome items start `NOT_RUN`.
- [x] Re-read the spec/plan and inspect the exact staged file list. Verify C48/C49 reports are unchanged.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`; record each exit/count. Do not run Chrome or Bridge acceptance.
- [x] Commit C50 implementation/docs separately from C49 doc-only commit; verify branch and clean worktree. Do not push or merge.
