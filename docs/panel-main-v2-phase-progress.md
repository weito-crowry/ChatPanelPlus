# メインパネル再設計 v2 — Phase進捗

## 完了記録

| Phase | 状態 | 実装／記録コミット | 自動検証・配備 |
|---|---|---|---|
| 0 調査・計画 | COMPLETE | `63a48805601460a5d8e5a07d7cf3b66e8c28bf7e` | 計画・監査docs。typecheck/lint PASS、全テストは未実施。 |
| 1 UIとコアの分離 | ACCEPTED | `efe5b26aa3a37cab7db94c7c6d2fe0969f099e1b` | 496/496、typecheck/lint PASS。ユーザーのChrome動作確認報告でPhase全体PASS。項目別の結果は未報告。 |
| 2 3画面構成 | AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED | 実装 `4eb037a3fa04ddcb47afb1bc724b81d296fa19ec`、受入記録 `5d5cfce054c3f14b19eed456311b3bddded1874c` | 501/501、typecheck/lint PASS。登録済み `dist/` へ `pnpm build` 済み。Chrome実機項目はPhase 5へ延期。 |
| 3 会話別UI状態・タブ別ミュート | AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED | 実装 `132218761d66a566c1e91d2831a5d292ffa6aa74` | 518/518、typecheck/lint PASS。登録済み `dist/` を `pnpm build` exit 0で更新。Chrome操作は未実施。 |
| 4 Bridge owner・会話別通知・認可 | PARTIAL / AUTO_TESTS_AND_DEPLOY_PASS / CHROME_SMOKE_DEFERRED | 実装 `f321cf50f6f81a2fd38975dda79a8e5d1a0cff26`、詳細 `docs/phase4-acceptance.md` | 527/527、focused 39/39、typecheck/lint PASS。登録済み `dist/` を `pnpm build` exit 0で更新。未確認event保護・確認済み履歴128件は実装。総保持上限の方針判断は保留。 |
| 5 最終統合・受入準備 | AUTO_REVIEW_COMPLETE / CHROME_ACCEPTANCE_NOT_RUN | `docs/panel-main-v2-final-acceptance-checklist.md` | Phase 4の527/527、typecheck/lint PASS記録を最終コードの自動結果として参照。Phase 5は文書のみのため追加build・配備なし。実機項目を一括チェックリストに集約。 |

## 最終受入の保留

- Chrome実機受入はユーザー実施待ちで、Phase 2〜5の未確認項目は`docs/panel-main-v2-final-acceptance-checklist.md`に`NOT_RUN`として集約した。Phase 1のユーザー報告によるPASSは別記録で維持する。
- Phase 4は総保持上限の判断が残るためPARTIAL。実装済みの未確認event保護と確認済み最新128件保持を変えずに、その判断を保留する。

## 残る仕様判断

- conversation ID不明時の通常回答完了音の再生可否。
- Optionsの「既定値に戻す」が会話別パネル表示状態へ及ぼす範囲。
- Bridge event保持方針。確認済み履歴は最新128件、未確認eventは件数保護のため保持する。総保持件数上限は未決定で、Phase 4をPARTIALとする。
- Bridgeから取得できる最終回答本文の完全性。
