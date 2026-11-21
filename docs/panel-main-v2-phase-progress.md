# メインパネル再設計 v2 — Phase進捗

## 完了記録

| Phase | 状態 | 実装／記録コミット | 自動検証・配備 |
|---|---|---|---|
| 0 調査・計画 | COMPLETE | `63a48805601460a5d8e5a07d7cf3b66e8c28bf7e` | 計画・監査docs。typecheck/lint PASS、全テストは未実施。 |
| 1 UIとコアの分離 | ACCEPTED | `efe5b26aa3a37cab7db94c7c6d2fe0969f099e1b` | 496/496、typecheck/lint PASS。ユーザーのChrome動作確認報告でPhase全体PASS。項目別の結果は未報告。 |
| 2 3画面構成 | AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED | 実装 `4eb037a3fa04ddcb47afb1bc724b81d296fa19ec`、受入記録 `5d5cfce054c3f14b19eed456311b3bddded1874c` | 501/501、typecheck/lint PASS。登録済み `dist/` へ `pnpm build` 済み。Chrome実機項目はPhase 5へ延期。 |
| 3 会話別UI状態・タブ別ミュート | AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED | 初回 `132218761d66a566c1e91d2831a5d292ffa6aa74`、B/C選択補正 `048953c3bd44298a9261048209c433eb9acc2d40` | 初回518/518、最終レビュー後の累積回帰539/539とtypecheck/lint PASS。B watch identity/C event IDの保存不足は補正commitで修正し、後続の登録済み`dist/`配備に含む。Chrome操作は未実施。 |
| 4 Bridge owner・会話別通知・認可 | PARTIAL / AUTO_TESTS_AND_DEPLOY_PASS / CHROME_SMOKE_DEFERRED | 初回 `f321cf50f6f81a2fd38975dda79a8e5d1a0cff26`、レビュー修正 `048953c3bd44298a9261048209c433eb9acc2d40`、C12 follow-up `c528acd37e9b0d907175f4e19019c6913f027eca` | C12 follow-up後548/548、typecheck/lint PASS。隔離テスト中live `dist/` 11/11 hash一致。バックアップ `ChatPanelPlus-dist-c12-predeploy-backup-20261121-215034-e7f2d76cca0346e5a440171dffb49bda` 11/11照合後、登録済み`dist/`に`pnpm build` exit 0。Chrome C12再確認NOT_RUN。総保持上限の判断保留でPhase 4 PARTIAL。 |
| 5 最終統合・受入準備 | AUTO_REVIEW_COMPLETE / PARTIAL_USER_REPORTED | C30実装 `82c0dd7fc131dec320a47c4cd16b9c8a22e6b454`、受入 `docs/panel-main-v2-final-acceptance-checklist.md` | スピーカー操作を1個に統合。全体音声ON/OFFはOptionsへ残し、パネルは会話別muteだけを操作。全548/548、typecheck/lint PASS、隔離中live `dist/` 11/11 hash一致。バックアップ `ChatPanelPlus-dist-c30-predeploy-backup-20261121-220527-c5308142b8dd48208b4c600962dee589` 11/11照合後`pnpm build` exit 0で配備。Chrome C30確認はNOT_RUN。 |
| 6 パネル外観・Bridge表示 | UI_AUTO_TESTS_AND_DEPLOY_PASS / C37_FAIL / C31_C36_NOT_RUN / RUNNING_ONLY_CPP_COMMITTED_NOT_DEPLOYED / C38_NOT_RUN | 仕様docs `fcafcca4bf17be62f34b15220be2879e966722bf`、UI `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70` | 552/552、Phase6 focused 34/34、typecheck/lint・サイズ検査PASS。隔離テスト前後の登録済みlive `dist/` 11/11 path/size/SHA-256一致。新規バックアップ `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-predeploy-backup-20261122-012236-b904e2364297495daf438482a97522f8` 11/11照合後、`pnpm build` exit 0で登録済みrepo直下`dist/`へ配備。配備後11ファイル・Manifest V3/version 0.1.5・必須6ファイル・HTML/CSS参照5件・Phase6 marker10/10、変更は`content.js`のみ。C31–C36の画面受入はNOT_RUN。C37では終了event/回答完了音の成功とCPP final-answer取得失敗がユーザー報告され、native include_historyの別経路照会にはfinal_answer itemあり。失敗時のCPP応答不明で原因未特定。追加CPP commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`: 全563/563・focused 50/50、typecheck/lint/サイズ検査PASS。未配備のため現在のChrome distでは実行中件数は`—`。 |

## 最終受入の保留

- Chrome実機受入はユーザー実施待ちで、Phase 2〜5の未確認項目は`docs/panel-main-v2-final-acceptance-checklist.md`に`NOT_RUN`として集約した。Phase 1のユーザー報告によるPASSは別記録で維持する。
- Phase 4は総保持上限の判断が残るためPARTIAL。実装済みの未確認event保護と確認済み最新128件保持を変えずに、その判断を保留する。
- 最終レビューで未確認event 129件以上のACKを128件以下の直列batchへ分割し、途中失敗の件数表示・一覧再取得・route変更時停止を追加した。B watch identityとC event IDの選択も会話別stateに保存し、owner一致の一覧で再検証する。詳細は`docs/phase4-acceptance.md`と最終ChromeチェックリストC27–C28。
- C12 thread一覧は`c528acd37e9b0d907175f4e19019c6913f027eca`で読み込み済み候補の実行中優先・「実行中のみ」filterを追加し、自動テスト548/548と正式`dist/`配備を完了。Chrome修正後確認はNOT_RUN。チェックリストC12/C29に記録。
- 2026-11-21のユーザー実機報告: C02通常画面、C03 Options表示、C05 A→B→Cと最小化・復帰をPASS。C17は当該会話のwatch/eventが0/0で他会話情報の混入兆候なしだがownerless legacyを実際に用意した確認は未実施のためNOT_RUN。C30スピーカー重複は修正前FAIL、修正後確認はNOT_RUN。
- C30はスピーカー1個の`aria-pressed`を会話別muteだけに結び、iconは全体OFFまたは会話別mute中に消音表示する。ARIA/titleは両状態を別々に説明し、全体OFF時も会話ID・読込・保存待ち条件を満たせば会話別muteを操作できる。全体設定はOptionsに集約し、パネルから`answerCompletionSoundEnabled`を書き換える経路を削除した。実機でのON/OFF・tab別確認はNOT_RUN。

## 残る仕様判断

- conversation ID不明時の通常回答完了音の再生可否。
- Optionsの「既定値に戻す」が会話別パネル表示状態へ及ぼす範囲。
- Bridge event保持方針。確認済み履歴は最新128件、未確認eventは件数保護のため保持する。総保持件数上限は未決定で、Phase 4をPARTIALとする。
- Bridge final-answer本文の完全性と取得時点差。CPPがno-final-answerを返した場面のraw応答は未取得だが、native include_historyの別経路では同じTurnのfinal_answer itemが存在。原因特定とC37の再検証が必要。
- CodexBridge側の`codex_threads(running_only=true)`はlocal commit `41faae1`に実装済みとのユーザー報告だが、稼働サービスへの反映は待ち。CPPは`tools/list` schemaでboolean能力を確認してから実行中要求を送り、remote targetが拒否した場合は実行中値を`—`にして通常一覧を維持する。
- Phase 6 UIはユーザー提示の画像構成に沿ってReact/CSSに実装し、自動回帰を通して登録済みdistへ配備した。UIコードcommitは`3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`。Chrome表示は未確認でC31–C36は実機受入NOT_RUN。
- 2026-11-22 01:40 JSTのユーザー報告: CPP監視からTurn完了と回答完了音は確認できたが、Cの最終回答取得はno-final-answerとなった。同じ対象Turnはnative `codex_threads(include_history=true)`の別経路応答に`agentMessage`/`final_answer` itemがあるとの確認がある。CPP失敗時のraw MCP応答はなく、時刻差・経路差・競合などの原因は未特定。最終ChromeチェックリストC37をFAIL（再検証待ち）として記録。C31–C36はNOT_RUN、Chrome reload状況も未確認。
- B表示名fallback/ID tooltipとUI仕様は`docs/panel-main-phase6-visual-spec.md`に記録。CPP running_only連携commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`は未配備であり、現在の登録済み`dist/`は先行Phase6 UIの状態。今回の変更ではBridgeサービスを更新していない。新しいCPP codeとサービス反映後にC38をChromeで確認する。
- 2026-11-22 running_only CPP follow-up: 既定「実行中」modeはserver-side `running_only=true`結果を直接表示し、通常一覧は`limit=20`・cursorを維持。schema未対応／不明、remote拒否、失敗、target切替時は古い件数を消し、通常一覧は利用可能。件数はBridge返却集合の数で、未把握threadまでの完全網羅は保証しない。通常／展開／最小化で同一targetのsummaryを使い、定期pollingは追加していない。配備・Chrome reloadは未実施。
