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
| 6 パネル外観・Bridge表示 | CPP_AUTO_TESTS_AND_DEPLOY_PASS / C37_FAIL / C31_C36_NOT_RUN / BRIDGE_SCHEMA_UNVERIFIED / C38_NOT_RUN | 仕様docs `fcafcca4bf17be62f34b15220be2879e966722bf`、UI `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`、running_only CPP `4cee26e980e2bfaf32e0f2a299c86a0c4082073d` | UI 552/552、Phase6 focused 34/34、running_only連携前回全suite 563/563・focused 50/50、typecheck/lint・サイズ検査PASS。今回`pnpm typecheck`/`pnpm lint` PASS、`pnpm build` exit 0。登録済みlive `dist/`の新規backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-runningonly-predeploy-backup-20261122-072227-7ce881baefb7451d8d5438a8d5f9e510`とbuild前に11/11 path/size/SHA-256一致。配備後11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML参照2件、marker 8/8。Bridge再起動はユーザー報告済みだがlive app `tools/list` schemaは未確認。Chrome reload・C31–C36/C38実機受入はNOT_RUN。C37 final-answer不一致はFAIL・原因未特定のまま。 |

## B監視一覧の読み込み停止修正（2026-11-22）

- ユーザー報告の2回目はreload・接続更新・30秒待機・A更新でもB一覧が読み込み中のまま、開始不可。A一覧/Bridge接続表示は正常で監視中/通知は0/0だった。先行観測から変わった理由や保存データの消失は確認されておらず、原ログも未収集。
- ソースで確認したgeneration競合に対し、B一覧要求の優先度調停、単一flightの自動更新、25秒bounded timeout、失敗原因表示/再試行、route tokenによる遅延応答破棄を追加。失敗を0件にせず`—`とし、B開始は一覧の成功・current connection・current route等が有効な時だけ許可する。owner filter、sender URL/tab URL検証、保存済みwatch/eventは変更しない。
- 実機の症状がこの競合だったかは未確定。C44でChrome実機再確認をNOT_RUNとして管理する。欠落/不正なwatch/event配列を成功0件扱いしない検査も追加。自動テストはisolated source-only copyで636/636 PASS、focused 38/38 PASS。`pnpm typecheck`・`pnpm lint`・`pnpm check:size` PASS。隔離suite前後でライブ`dist/`の11/11 relative path/size/SHA-256一致。build・正式配備・Chrome操作は未実施。

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
- CodexBridge側の`codex_threads(running_only=true)`はlocal commit `41faae1`に実装済みとのユーザー報告があり、Bridge再起動もユーザー報告で完了。現在のCodexBridge connectorからlive app `tools/list` schemaは読めず、boolean能力の公開状態は未確認。CPPは実機でschema能力を確認してから実行中要求を送り、remote targetが拒否した場合は実行中値を`—`にして通常一覧を維持する。
- Phase 6 UIはユーザー提示の画像構成に沿ってReact/CSSに実装し、自動回帰を通して登録済みdistへ配備した。UIコードcommitは`3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`。Chrome表示は未確認でC31–C36は実機受入NOT_RUN。
- 2026-11-22 01:40 JSTのユーザー報告: CPP監視からTurn完了と回答完了音は確認できたが、Cの最終回答取得はno-final-answerとなった。同じ対象Turnはnative `codex_threads(include_history=true)`の別経路応答に`agentMessage`/`final_answer` itemがあるとの確認がある。CPP失敗時のraw MCP応答はなく、時刻差・経路差・競合などの原因は未特定。最終ChromeチェックリストC37をFAIL（再検証待ち）として記録。C31–C36はNOT_RUN、Chrome reload状況も未確認。
- 2026-11-22 04:00 JSTの再発報告: 03:41完了Turnで終了eventと回答完了音は成功したが、CPPのfinal_answer取得はno-final-answer。後刻native historyは41 itemsでphase=final_answerのagentMessageは0件。一方、`codex_status.latest_agent_message`には最終報告があったが、これはhistory itemとは別情報。前回01:29対象Turnでは後刻native historyにfinal_answer itemが存在した。失敗時のCPP raw responseは未取得で原因未特定。C37 FAILを維持、C31–C36とC38はNOT_RUN。
- B表示名fallback/ID tooltipとUI仕様は`docs/panel-main-phase6-visual-spec.md`に記録。CPP running_only連携commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`は2026-11-22に登録済みrepo直下`dist/`へ配備済み。Bridge再起動はユーザー報告済みだが、live schemaとChrome実行結果は未確認。C38はChrome統合試験までNOT_RUN。
- 2026-11-22 running_only CPP follow-up: 既定「実行中」modeはserver-side `running_only=true`結果を直接表示し、通常一覧は`limit=20`・cursorを維持。schema未対応／不明、remote拒否、失敗、target切替時は古い件数を消し、通常一覧は利用可能。件数はBridge返却集合の数で、未把握threadまでの完全網羅は保証しない。通常／展開／最小化で同一targetのsummaryを使い、定期pollingは追加していない。全563/563・focused 50/50 PASSは直前の隔離テスト記録、今回のtypecheck/lint PASSとbuild exit 0を追加記録。新規backup 11/11照合後に配備したがChrome reloadは未実施。
- running_only正式dist配備: `pnpm build` exit 0、対象`D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`。backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-runningonly-predeploy-backup-20261122-072227-7ce881baefb7451d8d5438a8d5f9e510`はbuild前11/11 path/size/SHA-256一致。配備後11 files、Manifest V3/version 0.1.5、必須6、HTML参照2件、marker 8/8。詳細hashは`docs/panel-main-phase6-visual-spec.md`。

## Options V2設定画面・保存データ管理（2026-11-22）

- 目次付き5セクション、選択グループ編集、保存データの既知キー限定閲覧、確認付きの個別CAS削除を実装。個別削除は会話別パネル状態・会話統計・project folder pattern・曖昧でないcanonical project nameだけ。Bridge watch/event、config、共有view state、音源、出力先、session、未知keyは対象外。
- focused 27/27・隔離全suite 620/620、typecheck/lint/check:size PASS。テストの前後でlive `dist/` 11/11ファイルhash一致。コミットを含む変更詳細は`docs/options-v2-data-management.md`。
- Options V2はsource commit `858f76cf8b73911e0527a3cfb7d3dff92cd87e5b`から登録済みrepo直下`dist/`へ`pnpm build`（exit 0）で配備済み。新規backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-options-v2-predeploy-20261122-f58ac4dae05649e6bf2b09f03cf18d24`はbuild前11/11 path/size/SHA-256一致。配備後11 files、Manifest V3/0.1.5、必須6/6、Options HTML refs 2、CSS local refs 0、Options UI marker 4/4、CSS marker 3/3、既存content marker 2/2。post-build hash manifestは同backup名の`.postbuild.manifest.json`。
- 配備時の`pnpm typecheck`・`pnpm lint` PASS。直近のOptions安全修正は隔離全suite 625/625、focused 12/12 PASS、check:size PASS。Chrome拡張/Options再読み込み、実storageの操作は`NOT_RUN`。C37既知`FAIL`を維持し、メインパネル/C37コードは変更していない。
- 2026-11-22 Options V2ユーザー実機受入報告: 目次切替、保存データ種別/件数、未保存ボタン名ドラフトのセクション往復保持、会話別パネル状態の選択、削除プレビュー（件数/ID/影響）と取消後の保持、project folder pattern登録、F5後の保存、通知/音声設定、完了音試聴と選択デバイス再生をPASS。いずれもユーザー報告による実機観測。
- 部分観測: データ管理チェックボックスは初回グレーアウト、保存データ更新後に選択可能。stale検出と整合するが原因未確定。stale理由/更新導線の表示、削除プレビューの確認/取消ボタン横並びを改善候補として記録（今回UI変更なし）。
- NOT_RUN: 実データ最終削除、初期化/JSON import/export個別確認、幅別responsive、ブラウザー戻る/進む、複数画面競合。C37は別管理で既知`FAIL`を維持し、今回のOptions受入に含めない。
- 2026-11-22 follow-up（追加4要望、watch owner後勝ち移管、B監視エラー調査）: projectId別folder pattern、viewport内panel scroll、owner限定通知clear、C37の`latest_agent_message`意味の記録、atomic owner transferと旧event owner維持、Bエラー/disabled理由の整理を実装。commit `97ee87a2dc55af88b0bbb6a3a05ba8cfdae2d5cd`、隔離全suite 601/601、関連focused 93/93、typecheck/lint/size PASS。backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08` はbuild前11/11 path/size/SHA-256一致、reparse pointなし。登録済みrepo直下`dist/`へ`pnpm build` exit 0で配備。配備後11 files、Manifest V3/version 0.1.5、必須6/6、HTML refs 5/5、CSS URL refs 0、feature markers 12/12、C37 strict-parser checks 4/4。post-build hash manifestは`D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08.postbuild.manifest.json`。今回の配備先はユーザー確認済みのrepo直下`dist/`。`AGENTS.md`/`README.md`/`pnpm deploy:chrome`は兄弟Probeを指す既存不整合があるため同コマンドは不使用。Chrome未reload、C39–C43 NOT_RUN。Bridge再起動後の実行中0表示はユーザー報告の部分観測で、このbuildのC38はNOT_RUN。C37はFAIL／原因未特定。スクリーンショットの直接原因も未確定。
