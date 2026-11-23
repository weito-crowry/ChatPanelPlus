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
| 6 パネル外観・Bridge表示 | CPP_AUTO_TESTS_AND_DEPLOY_PASS / C37_FAIL / C31_C36_NOT_RUN / BRIDGE_SCHEMA_UNVERIFIED / C38_IMPROVEMENT_OBSERVED / C38_ACCEPTANCE_NOT_RUN | 仕様docs `fcafcca4bf17be62f34b15220be2879e966722bf`、UI `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`、running_only CPP `4cee26e980e2bfaf32e0f2a299c86a0c4082073d` | UI 552/552、Phase6 focused 34/34、running_only連携前回全suite 563/563・focused 50/50、typecheck/lint・サイズ検査PASS。今回`pnpm typecheck`/`pnpm lint` PASS、`pnpm build` exit 0。登録済みlive `dist/`の新規backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-runningonly-predeploy-backup-20261122-072227-7ce881baefb7451d8d5438a8d5f9e510`とbuild前に11/11 path/size/SHA-256一致。配備後11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML参照2件、marker 8/8。Bridge再起動はユーザー報告済みだがlive app `tools/list` schemaは未確認。配備時点ではChrome reload・C31–C36/C38実機受入はNOT_RUN。2026-11-23のC38要改善観測は後段に記録。C37 final-answer不一致はFAIL・原因未特定のまま。 |

## B監視一覧の読み込み停止修正（2026-11-22）

- ユーザー報告の2回目はreload・接続更新・30秒待機・A更新でもB一覧が読み込み中のまま、開始不可。A一覧/Bridge接続表示は正常で監視中/通知は0/0だった。先行観測から変わった理由や保存データの消失は確認されておらず、原ログも未収集。
- ソースで確認したgeneration競合に対し、B一覧要求の優先度調停、単一flightの自動更新、25秒bounded timeout、失敗原因表示/再試行、route tokenによる遅延応答破棄を追加。失敗を0件にせず`—`とし、B開始は一覧の成功・current connection・current route等が有効な時だけ許可する。owner filter、sender URL/tab URL検証、保存済みwatch/eventは変更しない。
- 実機の症状がこの競合だったかは未確定。欠落/不正なwatch/event配列を成功0件扱いしない検査も追加。隔離全suite 636/636、focused 38/38、`pnpm typecheck`・`pnpm lint`・`pnpm check:size` PASS。source-only suite前後はlive `dist/`11/11 hash一致。2026-11-22 source commit `39a38f5cd423576294fbd744b41b595a7a0a0578`を登録済みrepo直下`dist/`へ`pnpm build` exit 0で配備。backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-predeploy-20261122-225802-220-e09b3e603f0a489b98ea9bc8ef2c6edb`はbuild前11/11 relative path/size/SHA-256一致、reparseなし。prebuild manifest `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-predeploy-20261122-225802-220.manifest.csv`、postbuild manifest `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-postbuild-20261122-225802-220.manifest.csv`は生成後11/11 hashを現物照合、bundle変更は`content.js`のみ。静的検証11 files、Manifest V3/0.1.5、必須6/6、HTML refs 5/5、CSS URL refs 0、C44/C37 markers PASS。Chrome reloadとC44はNOT_RUN、手動確認手順は最終チェックリストC44に記録。

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

## 監視周期短縮・終端後のワンショット解除（2026-11-23）

- 前面foreground pollingを5秒へ短縮し、Chrome alarmsの30秒周期とbackoff/同時要求制限は維持する。確実な新規`completed`/`failed`/`interrupted`遷移では、owner snapshot付きeventの保存と同じstorage mutation内で対象watchIdの1件だけを解除する。
- event保存失敗時はwatchを残し、成功状態をMCP読取失敗へ混同せず次のpollで再判定する。通知再生結果にかかわらずeventを保管し、最終watch解除時はalarm同期を試みる。既終端baselineと不確実状態は自動解除しない。
- コード・テストcommit `b2158dd`。focused monitor/terminal/coordinator tests 49/49 PASS、隔離source-only `pnpm test` 639/639 PASS、`pnpm typecheck`・`pnpm lint`・`pnpm check:size` PASS。隔離suite前後で正式live `dist/`は11/11 relative path・byte size・SHA-256一致（manifestはCodexData Tempの`cpp-one-shot-*\live-dist-before.csv`と`live-dist-after.csv`）。
- 2026-11-23正式配備: コードcommit `b2158ddcbfee1be23b7e54e6394950368141411e`の後、登録済みrepo直下`dist/`をbuild前に`D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-monitor-autounwatch-20261123-mwsco6ri-0gomks7`へ退避。reparse pointなし、11/11ファイルの相対path・byte size・SHA-256が一致した後に`pnpm build`を1回実行しexit 0。prebuild manifestは同backup名の`.prebuild.manifest.csv`。
- 配備後は11 files、Manifest V3/version 0.1.5、必須6/6、HTML参照3/3、CSS参照検査PASS。前面5秒/背景30秒、completed/failed/interrupted、C44の再試行表示、C37の`agentMessage`+`final_answer`厳密判定と`latest_agent_message` fallbackなしをbundleで確認。postbuild SHA-256 manifest: `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-monitor-autounwatch-20261123-mwsco6ri-0gomks7.postbuild.manifest.csv`。配備時点ではChrome拡張reload・実機受入は未実施。後続のユーザー報告を以下に記録する。
- 2026-11-22 follow-up（追加4要望、watch owner後勝ち移管、B監視エラー調査）: projectId別folder pattern、viewport内panel scroll、owner限定通知clear、C37の`latest_agent_message`意味の記録、atomic owner transferと旧event owner維持、Bエラー/disabled理由の整理を実装。commit `97ee87a2dc55af88b0bbb6a3a05ba8cfdae2d5cd`、隔離全suite 601/601、関連focused 93/93、typecheck/lint/size PASS。backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08` はbuild前11/11 path/size/SHA-256一致、reparse pointなし。登録済みrepo直下`dist/`へ`pnpm build` exit 0で配備。配備後11 files、Manifest V3/version 0.1.5、必須6/6、HTML refs 5/5、CSS URL refs 0、feature markers 12/12、C37 strict-parser checks 4/4。post-build hash manifestは`D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08.postbuild.manifest.json`。今回の配備先はユーザー確認済みのrepo直下`dist/`。`AGENTS.md`/`README.md`/`pnpm deploy:chrome`は兄弟Probeを指す既存不整合があるため同コマンドは不使用。Chrome未reload、C39–C43 NOT_RUN。Bridge再起動後の実行中0表示はユーザー報告の部分観測で、このbuildのC38はNOT_RUN。C37はFAIL／原因未特定。スクリーンショットの直接原因も未確定。

## Chrome実機の部分観測（2026-11-23）

- ユーザー報告：Chrome拡張とChatGPT画面を再読み込みして確認。終了した監視対象がB監視一覧から自動的に消え、Cの通知履歴に終了eventが残ることを明示確認した。これはC45主要正常系の部分観測で、C45全体のPASSを意味しない。
- C44：B監視一覧が表示でき、監視が実際に機能したとの正常系観測あり。25秒timeout、再試行、route race、保存失敗の試験は未実施。判定は`NOT_RUN（異常系）、正常系PASS（部分観測）`。
- C45：foreground約5秒周期の実測、failed/interrupted、baseline既終端、未知状態、event保存失敗、alarm、他watchへの影響は未実施。判定は`NOT_RUN（周期・異常系等）、正常系PASS（部分観測）`。
- C38要改善観測：対象thread終了後もAの「実行中」一覧と上部件数が自動更新されなかった。既存設計ではrunning_only取得を定期更新しない。C38全体のChrome受入とlive app schema確認は未完了のため`NOT_RUN`を維持する。
- 未実装の改善案：監視の確実な終了event後に同一targetのrunning_onlyを再取得し、A一覧と件数を同期する。件数を単純減算しない。設計案の記録であり、実装済みとは扱わない。
- C37の`FAIL`（原因未特定）は維持する。

## C38 terminal event後のA実行中一覧更新（2026-11-23）

- 原因：Aのrunning_only一覧と件数は初期表示・A操作時だけ取得しており、C45でBの監視解除とCの終了event保管が成功してもAへ更新通知する経路がなかった。
- 実装：B/Cの成功したowner-filtered一覧snapshotを会話・connection別に比較し、新規terminal event IDだけをidentity-only callbackでAへ通知する。初回snapshotの過去event、ACK、clear後の再表示、event順変更、watch開始/解除だけのrefreshは通知しない。connection IDが変わった最初のsnapshotは履歴基準にする。
- Aは現在の会話route・接続状態・target・modeを確認する。running modeでは既存requestTrackerを通す`running_only=true`要求を1回行い、その同じ応答から一覧とsummary件数を更新する。更新中に届いたterminal eventは現在requestの完了後に1回だけ続ける。normal modeではrunning summaryだけを再取得し、20件cursor・一覧・選択を変更しない。失敗・unsupportedは`—`、空配列は`0`を既存処理で維持する。
- 2026-11-23 17:22:57 JSTの追加実機観測：C46が新規threadをBへ自動登録した時点で、Aは「Bridgeが返した実行中threadはありません」・上部0のまま。C46の新規watch登録成功だけをstorage/snapshot差分で拾い、同owner・connection・targetのAを更新する経路を追加した。B一覧取得中に来たstorage変更は後続snapshot 1回へ集約する。初回snapshot、既存watch更新、重複、他owner/connection/target、watch解除だけではAのrunning_onlyを再取得しない。A polling intervalは追加していない。
- 初回watch baseline欠落の同日C46原因：Bridge `codex_threads(running_only=true)`の`current_execution`は`in_progress/live/managed_turn`だが`turn_id`がなく、同じ応答の`last_turn`に`01a2077d-c0fa-77b2-95fe-1265f5b4ee21`・`in_progress/live`があった。CPP parserは欠落IDをnull化し、自動登録側がnull baselineを許していたため`baselineTurnKind=unknown`になり得た。厳格なlink helperで、この同時観測のactive/live/in_progressだけを同一Turnとして結び、欠落ID時のcompleted/inferred/unknownはlinkせず登録を遅らせる。`current_execution`に明示IDがある場合は異なる`last_turn` IDで置き換えない。解除skipも正規化後の同一Turn IDで比較する。
- 実機17:22:57 JST時点でBへ自動登録されたthread `01a2077d-bb7d-7ac3-a190-b36c4c29b8ea`と`01a2077f-848b-72a0-a44a-19359a395311`は両方「不明」、監視中2・通知0。先のTurnは17:21:24 JSTにBridgeで`completed/live`を確認したがC終了eventがなく、もう一方は`in_progress/live`だったとのユーザー報告。修正後自動テストではmissing execution turn IDから正しいbaselineを作り、completed event保存後に対象watchを解除することを確認。Chrome修正後受入はNOT_RUN。
- `mcp-client.ts`のboolean schema確認・session復旧時の再確認・unsupported応答は既存契約を再確認し、変更していない。local/remote schema未対応時の実機挙動は未確認。Service Worker復旧、SPA、同一会話複数tabはChrome実機未確認。
- 自動テストPASS：`pnpm test` 668/668、`pnpm typecheck`、`pnpm lint`、`pnpm build` exit 0。Chrome実機NOT_RUN。distはbuildで更新したが、Chrome登録先`D:\weito\Documents\src\codexapp\ChatPanelPlus-Content-Probe-20261021`へは未反映。C38全体受入は`NOT_RUN`を維持。C37とC44/C45の既存判定を維持し、C45の後続観測は下段に追記。

## C37実機再受入と正式ロード元の確認（2026-11-23）

- 時系列：上記の2026-11-22記録時点では、CPPのfinal-answer取得失敗と当時raw MCP応答が未収集だったため原因未特定としていた。履歴はその時点の観測として保持し、後続調査で判明した原因と修正を本節に追記する。
- Bridgeの永続化API `codex_final_answer(thread_id,turn_id,target_id)`を本番応答で直接確認。返却は`status=retrieved`、`source=app_server.item/completed.agentMessage.phase=final_answer`で、本文が対象回答と完全一致した。応答には`target_id`、`thread_id`、`turn_id`、`status`、`item_id`、`source`、`text`に加えて`native_thread_id`が含まれていた。
- 根本原因とCPP修正：この正当な追加identity fieldをCPP `parseCodexBridgeFinalAnswerResponse`の`hasExactKeys`が拒否していた。CPP commit `c40dea06814b46257342243fca91dbe5241a6ee0`で`native_thread_id`だけを契約上の任意追加キーとして許容し、存在時は既知のnative identityとの一致を検証するよう修正。ID不一致と未知fieldは拒否し、fallback禁止と`confirmed`の意味を維持した。Bridgeコードは変更していない。
- 登録済みロード元の記録補正：過去の各配備記録にある「repo直下`dist/`」はその配備時点の記録として保持する。2026-11-23の読み取り確認で、Chromeの実登録ロード元は兄弟フォルダー`D:\weito\Documents\src\codexapp\ChatPanelPlus-Content-Probe-20261021`と確認した。今回のC37受入前にrepo `dist/`の完全版をこの固定ロード元へ全件反映し、11/11ファイルのSHA-256一致とManifest v0.1.5を確認。反映前バックアップ`D:\weito\Documents\src\codexapp\ChatPanelPlus-Content-Probe-20261021-backup-C37-20261123-132015-522`も11/11照合済み。
- ユーザー実機受入：2026-11-23、Chrome拡張とChatGPTページをユーザーが再読み込み。CPPパネルCで完了eventを開き最終回答を取得、UIに「完了済みturnの確定した最終回答を取得しました。」と本文が表示された。以前の「Bridgeの応答形式を確認できません。」は再発せず。ユーザー追加報告でcopyとChatGPT入力欄への挿入も成功。Bridge API直読でも対応Turnのcompleted/retrievedと本文一致を確認した。C37は「主要正常系PASS／詳細異常系NOT_RUN」とする。
- 関連項目の範囲：C20は最終回答の取得・表示・copy・入力欄挿入までの部分観測。別会話/別接続先のowner越境、同一会話別tab、挿入後の下書き保持、自動送信しないことの独立試験は報告されておらずNOT_RUN。C34のA/B/C全体も未確認。B監視0件でCに完了eventが残るスクリーンショットはC45主要正常系の部分観測として記録し、5秒周期、failed/interrupted、異常・競合系、event保存失敗、他watch/alarm影響はNOT_RUNのまま。

## C45 終端認識と自動解除の不一致調査（2026-11-23）

- 14:34 JSTのユーザー実機報告では、パネルAはBridgeの実行中threadなし／0、Bは対象threadをwatch 1件のまま保持し「新しいturnの完了を観測」と表示。ユーザー確認では14:33 JSTにTurn完了。Bridge `codex_status`読取結果はcompleted、last_turn completed/live、current_execution unknown/inferred/`execution_unconfirmed`・turn_id nullだったとの報告。Cには新しい終了eventが見えなかったが、「現在の会話の終了通知1件を削除」の表示があるため、手動clearの対象が旧eventか新eventかは未確定。Aの一覧未更新はC38の別問題。
- 実機時点のmonitor storage/前回snapshotにはアクセスしていない。前回`fetchOutcome`、`lastSuccessAt`、`turnChange`、baseline値は未観測であり、当該watchがどのdetector gateに拒否されたかは確定できない。
- コード上の再現経路：watch baselineがlive `in_progress`、その後のstatus取得が失敗し、続くpollが同じturnのlive terminal statusを返す。detectorは`previous.fetchOutcome !== 'ok'`のため初回terminalを拒否するが、`saveSuccess`はterminal snapshotを保存する。次pollは同一turn/terminalで`turnChange=same`となり、`observedTransition`に必要なprevious `in_progress`が失われるため、以後のterminal pollでもevent作成・watch解除に到達しない。一度でもfetch errorや90秒gap等で遷移証拠を失う可能性があるが、これが実機の発生経路だったとは断定しない。
- 再現テストは修正前、watchを保持したままBが「新しいturnの完了を観測」と誤表示することを確認。修正後はイベントを作らずwatch/alarmを維持し、「完了状態を観測しました。通知判定保留（前回の状態取得に失敗）。監視継続中。」と表示し、保留理由をstorage snapshotと技術情報に残す。既終端baseline、unknown/gap/inferred-only、別turn current_execution、event保存失敗、duplicate/owner、同一watchの原子的解除、failed/interruptedの既存gateは変更していない。
- remote public thread IDの`targetId::native_thread_id`形式とtarget整合性検査`matchesTargetThread`、connection/target/threadを含むwatch/event keyは変更していない。既存handler testは他target prefixのthreadを拒否する。remote targetからのライブ終端eventは実機未確認で、status証拠gateはremote/local間で緩和していない。
- 最終自動検証：`pnpm test` 671/671、`pnpm typecheck` PASS、`pnpm lint` PASS（`check:size` 244 files、500行/32768 bytes上限）、`pnpm build` exit 0。Focused terminal/owner/event/表示回帰64/64 PASS。これはsource-only検証で、Chrome実機ではない。
- 実機watch/eventを含むChrome storageは読まず・変更せず、Chrome/Bridge操作とProbe反映も行っていない。
- C38変更commit `52767e06cac283ed3e924097a25109678cff327a`は現Chrome登録ロード元`ChatPanelPlus-Content-Probe-20261021`へ未配備・未検証のまま維持し、C38受入は`NOT_RUN`。今回の変更を含むsourceもProbe未反映で、C45 Chrome再受入は今後の配備と手動reload後に必要。
- 17:22:57 JSTのC46実機ではcompleted/live後もwatchが残りCにeventなしとの報告があり、C45終了追跡もFAIL。上記missing-turn-ID baseline linkでsource経路を修正したが、C45の既存FAIL判定は維持し、修正後Chrome実機はNOT_RUN。
- 修正後source検証は同じcheckoutで`pnpm test` 713/713、typecheck/lint/size/buildがすべてPASS。これはC45実機再受入の代替ではなく、Chrome実機はNOT_RUNのまま。

## C46 新規実行スレッドの自動監視登録（2026-11-23）

- B欄にtarget単位の明示ON/OFFを追加。初期OFFで、ONは現在のtrusted ChatGPT会話・tab・routeからのみ受付ける。保存先は`chatPanelPlus.codexBridgeAutoWatch.v1`の独立keyで、connection ID、target ID、owner会話/tab、mute snapshotを厳密検証する。tokenは保存しない。
- 探索は表示A欄、通常一覧、手動refresh、running modeに依存せず、既存MCP clientのschema/capability確認済み`codex_threads(running_only=true)`を使用。既知target、完全なsingle page、正確なtarget/thread ID、`current_execution`の`in_progress`/`running`かつ`evidence=live`だけを候補にする。execution ID欠落時は同時応答の`last_turn`が非null ID・`in_progress/live`の場合だけ結び付ける。終了済み・estimated/inferred・unknown・last_turnだけの項目は候補外。ON時点ですでにliveなthreadも同じ探索で登録する。探索時のconnection IDをwatch開始時にも照合し、接続変更競合の誤登録を拒否する。
- 登録は既存watch state machine、storage mutation、32件上限、alarm、C45 terminal event/解除、C38 foreground更新へ接続。自動経路はowner移管を禁止し、他会話owner/ownerless watchと衝突したthreadは変更せず理由を保存する。manual watchの既存後勝ち登録動作は維持。手動解除したexecutionは永続skipし、unknown turn IDは同じthreadがrunning_onlyから消えるまで抑止する。OFFは新規登録だけを止め、既存watchと通知履歴を残す。
- 前面5秒/背景alarm約30秒、targetごとの重複flight、既存watch pollと共有するtarget queue/request slot、周期上限12target、古い期限から処理する公平性、指数backoffを実装。未対応schema/通信異常は0件扱いせずerrorとし再試行を遅らせる。5秒/30秒の間に開始・終了する短命Turnは見落とし得て、全件捕捉は保証しない。
- owner tabが閉じた／別route／mute取得不能の場合はmuteをnullにし、通知音を鳴らさずevent履歴を保持する。通知時にもowner tab URLと会話routeを再検証。SPA遷移後に別会話へ設定やwatchを移さない。
- 初期化/削除の扱いを確認：Options設定保存・既定値復元はconfig/view-state keyだけを更新し、自動watch keyと既存`chatPanelPlus.codexBridgeThreadMonitor.v1` watch/event keyを消さない。自動設定データのschema異常時は上書きせずerrorで停止する。
- 自動検証PASS：`pnpm test` 694/694、`pnpm typecheck` PASS、`pnpm lint` PASS、source size 248 files（各500行/32768 bytes以下）、独立した`pnpm build` exit 0。
- Chrome登録ロード元への反映・Chrome自動操作・実機受入・Bridge停止/再起動/変更は行っていない。C46 Chrome受入はNOT_RUN。C37主要正常系PASSを維持、C38 Chrome受入NOT_RUNとC45既存FAIL/再受入待ちは既存判定のまま。
- 追加実機観測（17:22:57 JST）：自動登録自体はPASSだが、新規2件のB状態は「不明」、監視中2・通知0。うち一件は17:21:24 JSTにBridgeでcompleted/liveだったがC終了eventがなく、別件はin_progress/liveだった。実機ではA一覧同期FAILも同時に観測。source回帰で実Bridge形状（`current_execution.turn_id`欠落、同一応答の`last_turn`がin_progress/live）を入力し、同Turn baseline→completed event→watch自動解除を確認。修正後Chrome NOT_RUN。
- 同checkoutの最終source検証：`pnpm test` 713/713、`pnpm typecheck` PASS、`pnpm lint` PASS、`pnpm check:size` PASS（258 files、各500行/32768 bytes以下）、`pnpm build` exit 0。固定Chromeロード元と実機storageには触れず、修正後Chrome実機受入はNOT_RUN。
