# メインパネル再設計 v2 — Phase進捗

## 現在地と残工程（2026-11-24）

- Chrome実ロード元はユーザー確認済みのrepo直下`dist/`。C46文書更新はcommit `99defc201541b160b9feb267fd8b18618ac11296`で完了。追加C47の実装commitは`12d1e6d861349663706bfe7f9a1e886740cd21c8`。terminal event保存後のowner限定identity通知、C37確定回答取得、選択範囲を使わない末尾追記、会話別既定OFF設定を実装した。実装時の`pnpm test` 784/784、typecheck/lint/size/build/diff check PASS。2026-11-24、ユーザー報告によるrepo直下`dist/` reload/F5後のC47主要正常系は部分PASS。詳細は下記。未受入項目は専用手順と最終チェックリストに記録する。
- 2026-11-24のC46ユーザー実機観測：10:00:42 JSTに回答完了検出、Bridge候補2件、コード装飾付き対象IDの本文照合1件、明示対象1件だけの監視登録。対照候補は未登録。対象終了後はA実行中0、B監視0、設定内監視0、C通知1。これはC46基本正常経路のPASSで、C46全項目やC38/C45全体のPASSではない。
- C38はC46前後でA件数2→0を表示した部分観測。Aの独立手動更新有無、live schema、mode・target・失敗時の表示等は未確認。C45は対象watchの終了後にB/設定が0、C通知1となった部分観測。技術情報内のnotification identityは直接照合しておらず、厳密poll周期、音声、異常系、worker復旧等は未確認。2026-11-23に記録したC45のFAILと修正経路は履歴として保持し、今回の限定観測を専用C45再受入へ拡張しない。
- C47主要正常系は部分PASSだが、OFF/過去event、watch起点、選択範囲、近接/同時完了、owner/SPA、音声/mute、IME/添付、取得失敗などは未受入。Issue #22/C50で最終回答templateを実装し、Chrome受入は別途NOT_RUNで記録する。現状を「メインパネルv2全体受入済み」やmerge-readyとは扱わず、残項目は`docs/panel-main-v2-final-acceptance-checklist.md`を参照する。

### 残工程の推奨順

1. **C47の未受入項目**：OFF・ON前event/reload、watch起点（手動/C46自動）、選択範囲、近接/同時完了、owner tab・別会話・SPA切替、音声OFF/mute、IME/添付/editor不可、pending/取得失敗と手動fallbackを専用手順どおり確認する。主要正常系の部分PASSと未確認項目は`docs/c47-terminal-answer-auto-reflect-acceptance.md`に記録。
2. **C45/C38の未完了受入**：C45はterminal event identity・自動解除・前面約5秒監視を専用ケースで確認。C38はA一覧/件数更新、live schema、実行中/通常mode、Bridge未対応・取得失敗を確認する。今回の限定表示を全体PASSへ広げない。
3. **その他の手動受入**：修正後未確認のC12/C29/C30、C31–C36、C44、C46の残ケース、C04、C06–C11、C13–C28、C39–C43をチェックリストの優先度に沿って実施。実測した個別ケースだけ更新し、未実施は`NOT_RUN`のままにする。
4. **C52複数出力実機受入**：実装・自動検証は完了したがChrome手動項目は未実施。`docs/c52-multiple-output-devices-acceptance.md`の手順に沿って確認する。
5. **merge準備**：行別実機結果と残制約をレビューし、既知FAILの修正後受入とPhase 4 event総保持上限等の判断を整理してmerge可否を決める。C47/C52のChrome受入前は全体merge-readyとしない。この依頼ではmergeしない。

## 完了記録

| Phase | 状態 | 実装／記録コミット | 自動検証・配備 |
|---|---|---|---|
| 0 調査・計画 | COMPLETE | `63a48805601460a5d8e5a07d7cf3b66e8c28bf7e` | 計画・監査docs。typecheck/lint PASS、全テストは未実施。 |
| 1 UIとコアの分離 | ACCEPTED | `efe5b26aa3a37cab7db94c7c6d2fe0969f099e1b` | 496/496、typecheck/lint PASS。ユーザーのChrome動作確認報告でPhase全体PASS。項目別の結果は未報告。 |
| 2 3画面構成 | AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED | 実装 `4eb037a3fa04ddcb47afb1bc724b81d296fa19ec`、受入記録 `5d5cfce054c3f14b19eed456311b3bddded1874c` | 501/501、typecheck/lint PASS。登録済み `dist/` へ `pnpm build` 済み。Chrome実機項目はPhase 5へ延期。 |
| 3 会話別UI状態・タブ別ミュート | AUTO_ACCEPTED / CHROME_SMOKE_DEFERRED | 初回 `132218761d66a566c1e91d2831a5d292ffa6aa74`、B/C選択補正 `048953c3bd44298a9261048209c433eb9acc2d40` | 初回518/518、最終レビュー後の累積回帰539/539とtypecheck/lint PASS。B watch identity/C event IDの保存不足は補正commitで修正し、後続の登録済み`dist/`配備に含む。Chrome操作は未実施。 |
| 4 Bridge owner・会話別通知・認可 | PARTIAL / AUTO_TESTS_AND_DEPLOY_PASS / CHROME_SMOKE_DEFERRED | 初回 `f321cf50f6f81a2fd38975dda79a8e5d1a0cff26`、レビュー修正 `048953c3bd44298a9261048209c433eb9acc2d40`、C12 follow-up `c528acd37e9b0d907175f4e19019c6913f027eca` | C12 follow-up後548/548、typecheck/lint PASS。隔離テスト中live `dist/` 11/11 hash一致。バックアップ `ChatPanelPlus-dist-c12-predeploy-backup-20261121-215034-e7f2d76cca0346e5a440171dffb49bda` 11/11照合後、登録済み`dist/`に`pnpm build` exit 0。Chrome C12再確認NOT_RUN。総保持上限の判断保留でPhase 4 PARTIAL。 |
| 5 最終統合・受入準備 | AUTO_REVIEW_COMPLETE / PARTIAL_USER_REPORTED | C30実装 `82c0dd7fc131dec320a47c4cd16b9c8a22e6b454`、受入 `docs/panel-main-v2-final-acceptance-checklist.md` | スピーカー操作を1個に統合。全体音声ON/OFFはOptionsへ残し、パネルは会話別muteだけを操作。全548/548、typecheck/lint PASS、隔離中live `dist/` 11/11 hash一致。バックアップ `ChatPanelPlus-dist-c30-predeploy-backup-20261121-220527-c5308142b8dd48208b4c600962dee589` 11/11照合後`pnpm build` exit 0で配備。Chrome C30確認はNOT_RUN。 |
| 6 パネル外観・Bridge表示 | CPP_AUTO_TESTS_AND_DEPLOY_PASS / C37_MAIN_NORMAL_PASS / C31_C36_NOT_RUN / BRIDGE_SCHEMA_UNVERIFIED / C38_PARTIAL / C45_REACCEPT_PARTIAL / C46_NORMAL_PATH_PASS | 仕様docs `fcafcca4bf17be62f34b15220be2879e966722bf`、UI `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`、running_only CPP `4cee26e980e2bfaf32e0f2a299c86a0c4082073d` | UI 552/552、Phase6 focused 34/34、running_only連携前回全suite 563/563・focused 50/50、typecheck/lint・サイズ検査PASS。今回`pnpm typecheck`/`pnpm lint` PASS、`pnpm build` exit 0。登録済みlive `dist/`の新規backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-runningonly-predeploy-backup-20261122-072227-7ce881baefb7451d8d5438a8d5f9e510`とbuild前に11/11 path/size/SHA-256一致。配備後11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML参照2件、marker 8/8。Bridge再起動はユーザー報告済みだがlive app `tools/list` schemaは未確認。配備時点ではChrome reload・C31–C36/C38実機受入はNOT_RUN。2026-11-23のC38要改善観測は後段に記録。C37の当時のfinal-answer不一致は後続修正後に主要正常系PASS。詳細異常系は未確認。 |

## B監視一覧の読み込み停止修正（2026-11-22）

- ユーザー報告の2回目はreload・接続更新・30秒待機・A更新でもB一覧が読み込み中のまま、開始不可。A一覧/Bridge接続表示は正常で監視中/通知は0/0だった。先行観測から変わった理由や保存データの消失は確認されておらず、原ログも未収集。
- ソースで確認したgeneration競合に対し、B一覧要求の優先度調停、単一flightの自動更新、25秒bounded timeout、失敗原因表示/再試行、route tokenによる遅延応答破棄を追加。失敗を0件にせず`—`とし、B開始は一覧の成功・current connection・current route等が有効な時だけ許可する。owner filter、sender URL/tab URL検証、保存済みwatch/eventは変更しない。
- 実機の症状がこの競合だったかは未確定。欠落/不正なwatch/event配列を成功0件扱いしない検査も追加。隔離全suite 636/636、focused 38/38、`pnpm typecheck`・`pnpm lint`・`pnpm check:size` PASS。source-only suite前後はlive `dist/`11/11 hash一致。2026-11-22 source commit `39a38f5cd423576294fbd744b41b595a7a0a0578`を登録済みrepo直下`dist/`へ`pnpm build` exit 0で配備。backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-predeploy-20261122-225802-220-e09b3e603f0a489b98ea9bc8ef2c6edb`はbuild前11/11 relative path/size/SHA-256一致、reparseなし。prebuild manifest `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-predeploy-20261122-225802-220.manifest.csv`、postbuild manifest `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-postbuild-20261122-225802-220.manifest.csv`は生成後11/11 hashを現物照合、bundle変更は`content.js`のみ。静的検証11 files、Manifest V3/0.1.5、必須6/6、HTML refs 5/5、CSS URL refs 0、C44/C37 markers PASS。Chrome reloadとC44はNOT_RUN、手動確認手順は最終チェックリストC44に記録。

## 最終受入の保留（2026-11-21〜23時点の記録）

この節は当時の保留事項を残す履歴。2026-11-24のC46実機観測と現行の優先順は、本書冒頭および最終Chromeチェックリストの最新記録を参照する。

- Chrome実機受入はユーザー実施待ちで、Phase 2〜5の未確認項目は`docs/panel-main-v2-final-acceptance-checklist.md`に`NOT_RUN`として集約した。Phase 1のユーザー報告によるPASSは別記録で維持する。
- Phase 4は総保持上限の判断が残るためPARTIAL。実装済みの未確認event保護と確認済み最新128件保持を変えずに、その判断を保留する。
- 最終レビューで未確認event 129件以上のACKを128件以下の直列batchへ分割し、途中失敗の件数表示・一覧再取得・route変更時停止を追加した。B watch identityとC event IDの選択も会話別stateに保存し、owner一致の一覧で再検証する。詳細は`docs/phase4-acceptance.md`と最終ChromeチェックリストC27–C28。
- C12 thread一覧は`c528acd37e9b0d907175f4e19019c6913f027eca`で読み込み済み候補の実行中優先・「実行中のみ」filterを追加し、自動テスト548/548と正式`dist/`配備を完了。Chrome修正後確認はNOT_RUN。チェックリストC12/C29に記録。
- 2026-11-21のユーザー実機報告: C02通常画面、C03 Options表示、C05 A→B→Cと最小化・復帰をPASS。C17は当該会話のwatch/eventが0/0で他会話情報の混入兆候なしだがownerless legacyを実際に用意した確認は未実施のためNOT_RUN。C30スピーカー重複は修正前FAIL、修正後確認はNOT_RUN。
- C30はスピーカー1個の`aria-pressed`を会話別muteだけに結び、iconは全体OFFまたは会話別mute中に消音表示する。ARIA/titleは両状態を別々に説明し、全体OFF時も会話ID・読込・保存待ち条件を満たせば会話別muteを操作できる。全体設定はOptionsに集約し、パネルから`answerCompletionSoundEnabled`を書き換える経路を削除した。実機でのON/OFF・tab別確認はNOT_RUN。

## 過去の仕様判断と保留（2026-11-22時点の記録）

以下は当時の判断・報告を残す履歴で、最新状態の要約ではない。C37の後続結果、C38/C45の部分観測、現在の残工程は本書冒頭と最終Chromeチェックリストを参照する。

- conversation ID不明時の通常回答完了音の再生可否。
- Optionsの「既定値に戻す」が会話別パネル表示状態へ及ぼす範囲。
- Bridge event保持方針。確認済み履歴は最新128件、未確認eventは件数保護のため保持する。総保持件数上限は未決定で、Phase 4をPARTIALとする。
- （当時の未解決記録）Bridge final-answer本文の完全性と取得時点差。CPPがno-final-answerを返した場面のraw応答は未取得だった。後続でC37の応答形式不一致を修正し、2026-11-23の主要正常系PASSを確認。項目欠落・複数候補・履歴不足等の詳細異常系は未確認。
- CodexBridge側の`codex_threads(running_only=true)`はlocal commit `41faae1`に実装済みとのユーザー報告があり、Bridge再起動もユーザー報告で完了。現在のCodexBridge connectorからlive app `tools/list` schemaは読めず、boolean能力の公開状態は未確認。CPPは実機でschema能力を確認してから実行中要求を送り、remote targetが拒否した場合は実行中値を`—`にして通常一覧を維持する。
- Phase 6 UIはユーザー提示の画像構成に沿ってReact/CSSに実装し、自動回帰を通して登録済みdistへ配備した。UIコードcommitは`3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`。Chrome表示は未確認でC31–C36は実機受入NOT_RUN。
- （履歴）2026-11-22 01:40 JSTの報告ではC37が`no-final-answer`だった。当時のraw応答未取得・原因未特定は履歴として保持し、後続の応答形式修正後にC37主要正常系PASSを確認。詳細異常系は未確認。
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
- 自動テストPASS：`pnpm test` 668/668、`pnpm typecheck`、`pnpm lint`、`pnpm build` exit 0。Chrome実機NOT_RUN。distはbuildで更新したが、Chrome reloadは未実施。以前この記録でProbeをChrome登録先とした記述は、ユーザーが実ロード元をrepo直下`dist/`と明示したため誤記として訂正する。C38全体受入は`NOT_RUN`を維持。C37とC44/C45の既存判定を維持し、C45の後続観測は下段に追記。

## C37実機再受入と正式ロード元の確認（2026-11-23）

- 時系列：上記の2026-11-22記録時点では、CPPのfinal-answer取得失敗と当時raw MCP応答が未収集だったため原因未特定としていた。履歴はその時点の観測として保持し、後続調査で判明した原因と修正を本節に追記する。
- Bridgeの永続化API `codex_final_answer(thread_id,turn_id,target_id)`を本番応答で直接確認。返却は`status=retrieved`、`source=app_server.item/completed.agentMessage.phase=final_answer`で、本文が対象回答と完全一致した。応答には`target_id`、`thread_id`、`turn_id`、`status`、`item_id`、`source`、`text`に加えて`native_thread_id`が含まれていた。
- 根本原因とCPP修正：この正当な追加identity fieldをCPP `parseCodexBridgeFinalAnswerResponse`の`hasExactKeys`が拒否していた。CPP commit `c40dea06814b46257342243fca91dbe5241a6ee0`で`native_thread_id`だけを契約上の任意追加キーとして許容し、存在時は既知のnative identityとの一致を検証するよう修正。ID不一致と未知fieldは拒否し、fallback禁止と`confirmed`の意味を維持した。Bridgeコードは変更していない。
- ロード元記録の訂正：過去記録にある兄弟ProbeがChromeの実登録ロード元だという記述は誤り。ユーザー明示の実ロード元はrepo直下`D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`であり、兄弟Probeを配備先として扱わない。過去にProbeへコピー・照合した操作記録はChrome配備の証拠ではないため、そのように解釈しない。
- ユーザー実機受入：2026-11-23、Chrome拡張とChatGPTページをユーザーが再読み込み。CPPパネルCで完了eventを開き最終回答を取得、UIに「完了済みturnの確定した最終回答を取得しました。」と本文が表示された。以前の「Bridgeの応答形式を確認できません。」は再発せず。ユーザー追加報告でcopyとChatGPT入力欄への挿入も成功。Bridge API直読でも対応Turnのcompleted/retrievedと本文一致を確認した。C37は「主要正常系PASS／詳細異常系NOT_RUN」とする。
- 関連項目の範囲：C20は最終回答の取得・表示・copy・入力欄挿入までの部分観測。別会話/別接続先のowner越境、同一会話別tab、挿入後の下書き保持、自動送信しないことの独立試験は報告されておらずNOT_RUN。C34のA/B/C全体も未確認。B監視0件でCに完了eventが残るスクリーンショットはC45主要正常系の部分観測として記録し、5秒周期、failed/interrupted、異常・競合系、event保存失敗、他watch/alarm影響はNOT_RUNのまま。

## C45 終端認識と自動解除の不一致調査（2026-11-23）

- 14:34 JSTのユーザー実機報告では、パネルAはBridgeの実行中threadなし／0、Bは対象threadをwatch 1件のまま保持し「新しいturnの完了を観測」と表示。ユーザー確認では14:33 JSTにTurn完了。Bridge `codex_status`読取結果はcompleted、last_turn completed/live、current_execution unknown/inferred/`execution_unconfirmed`・turn_id nullだったとの報告。Cには新しい終了eventが見えなかったが、「現在の会話の終了通知1件を削除」の表示があるため、手動clearの対象が旧eventか新eventかは未確定。Aの一覧未更新はC38の別問題。
- 実機時点のmonitor storage/前回snapshotにはアクセスしていない。前回`fetchOutcome`、`lastSuccessAt`、`turnChange`、baseline値は未観測であり、当該watchがどのdetector gateに拒否されたかは確定できない。
- コード上の再現経路：watch baselineがlive `in_progress`、その後のstatus取得が失敗し、続くpollが同じturnのlive terminal statusを返す。detectorは`previous.fetchOutcome !== 'ok'`のため初回terminalを拒否するが、`saveSuccess`はterminal snapshotを保存する。次pollは同一turn/terminalで`turnChange=same`となり、`observedTransition`に必要なprevious `in_progress`が失われるため、以後のterminal pollでもevent作成・watch解除に到達しない。一度でもfetch errorや90秒gap等で遷移証拠を失う可能性があるが、これが実機の発生経路だったとは断定しない。
- 再現テストは修正前、watchを保持したままBが「新しいturnの完了を観測」と誤表示することを確認。修正後はイベントを作らずwatch/alarmを維持し、「完了状態を観測しました。通知判定保留（前回の状態取得に失敗）。監視継続中。」と表示し、保留理由をstorage snapshotと技術情報に残す。既終端baseline、unknown/gap/inferred-only、別turn current_execution、event保存失敗、duplicate/owner、同一watchの原子的解除、failed/interruptedの既存gateは変更していない。
- remote public thread IDの`targetId::native_thread_id`形式とtarget整合性検査`matchesTargetThread`、connection/target/threadを含むwatch/event keyは変更していない。既存handler testは他target prefixのthreadを拒否する。remote targetからのライブ終端eventは実機未確認で、status証拠gateはremote/local間で緩和していない。
- 最終自動検証：`pnpm test` 671/671、`pnpm typecheck` PASS、`pnpm lint` PASS（`check:size` 244 files、500行/32768 bytes上限）、`pnpm build` exit 0。Focused terminal/owner/event/表示回帰64/64 PASS。これはsource-only検証で、Chrome実機ではない。
- 実機watch/eventを含むChrome storageは読まず・変更せず、Chrome/Bridge操作とChrome reloadも行っていない。
- C38変更commit `52767e06cac283ed3e924097a25109678cff327a`は実ロード元`dist/`へのbuild後reload・C38実機検証を行っておらず、C38受入は`NOT_RUN`。C45 Chrome再受入も未実施。
- 17:22:57 JSTのC46実機ではcompleted/live後もwatchが残りCにeventなしとの報告があり、C45終了追跡もFAIL。上記missing-turn-ID baseline linkでsource経路を修正したが、C45の既存FAIL判定は維持し、修正後Chrome実機はNOT_RUN。
- 修正後source検証は同じcheckoutで`pnpm test` 713/713、typecheck/lint/size/buildがすべてPASS。これはC45実機再受入の代替ではなく、Chrome実機はNOT_RUNのまま。

## C46 回答完了時のID一致自動監視登録（2026-11-23訂正）

- **正仕様**：AnswerCompletionTrackerの回答完了イベントから会話ID・turnKey・assistantMessageIdを受け、本文を送らずに認証済みruntime requestを行う。明示ONかつowner tab/会話route/target/current connectionが一致する場合だけ、まず`codex_threads(running_only=true)`を取得し、live `current_execution`が`running`/`in_progress`のBridge実測`thread.id`一覧（最大1,000件・合計65,536文字）をcontentへ返す。OFFではBridge候補取得を行わない。
- Bridge `running_only=true`要求を開始してからcontent内だけで対象完了本文のsemantic snapshotを一時取得する。Bridge候補応答後に同じdocument/route/owner、main root、unique turnKeyと同一turn要素を確認し、完了したassistant message IDと`complete`状態を各読み取りで再検証する。可視本文（既存DIL/Textルーチン、最大65,536 code units）をsnapshotと比較し、1 taskの安定化を挟んだ再読取りおよび照合後の最終再検証でも同じsemantic textであることを確認してから、Bridge実測IDだけをUnicode独立token境界で照合する。属性/装飾/非本文UI変更、同じmain内のturn再配置、同semantic textの再描画は拒否条件にしない。完全一致したcanonical Bridge IDを重複排除して最大32件送る。UUID正規表現で本文からIDを作らず、関係ないUUIDは候補数に影響しない。URL/path内、別識別子への埋込、partial/substring、大小文字違いは一致しない。remote `target::native`とnative IDの変換は同一target内に限る。
- background登録側は受け取ったIDを新しい`running_only=true` live結果と再照合し、owner/target/connectionを再検証してから既存watchへ登録する。他の実行中threadは登録しない。DOMの不足・重複・曖昧・変化・大容量、Bridge候補なし/応答上限超過、Bridge未対応・取得失敗、接続/owner競合は登録を見送る。回答完了前に終了した短命taskは登録されなくてよい。本文やDOMはbackgroundへ送信・保存・ログ化せず、content側のskip診断も理由コードだけを記録し、回答eventの重複送信は抑止する。
- 自動登録のON/OFFは回答完了時のID照合だけを切り替える。ON、foreground/background alarm、worker restore、refresh、SPA遷移で実行中threadを全件探索・登録しない。既存watchの5秒/30秒poll、C45通知・終端自動解除、manual watch、32件上限、他owner/ownerless拒否、手動解除skipは維持する。`chatPanelPlus.codexBridgeAutoWatch.v1`は読取互換し、OFFでもwatch/eventは消さない。旧自動探索alarmはrestore時に解除する。
- B欄には「回答完了時の自動監視登録」と説明を表示し、定期探索候補件数を示さない。音声OFF、音量0、mute、再生失敗でも回答完了イベントの登録判定は動く。
- 以前のC46実装は「ON中の実行中thread全件を5秒/30秒周期で発見・登録」しており、この仕様は誤りだった。18:51 JSTの実機PASS（thread `01a207cf-52ab-7900-a91d-3288982ab221`の自動登録、終了通知、自動解除）は**旧誤仕様に対する結果**であり、今回訂正したC46の受入PASSではない。旧実機での候補件数/A同期の観測も新仕様の判定には流用しない。
- 17:22/18:51の当時のsource検証結果（713/713、716/716等）は旧定期探索およびBridge候補本文照合前の順序の履歴として保持する。今回のBridge-first順序へ変更後、`pnpm test` 732/732 PASS、`pnpm typecheck`・`pnpm lint` PASS、`pnpm check:size` PASS（264 files、500行/32768 bytes以下）、`pnpm build` exit 0。Chrome実ロード元は`dist/`。今回Chrome reload・ChatGPT F5・Bridge/既存storage操作は行わず、訂正後Chrome実機受入はNOT_RUN。C37主要正常系PASS、C38 Chrome NOT_RUN、C45の既存FAIL/再受入待ちは独立して維持する。
- Chromeの実ロード元はユーザー明示のrepo直下`D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`。この作業ではChrome reload、ChatGPT F5、Bridge操作、既存watch/event/storage変更を行わない。

## C49 同一Bridge/target上の会話別自動監視（2026-11-24）

- 永続設定entryの一意性を`connectionId + targetId + ownerConversationId`へ変更し、同じBridge/targetでも異なる会話のON/OFF・owner tab・mute revision・skip・failureを独立させた。保存fieldはすでにownerConversationIdを含むため、storage keyと`version: 1`の形は維持し、既存v1 entryをそのまま読み書きできる。version bumpや別キーmigrationは不要と判断。v1内の同一triple重複、異常entry、上限超過は従来どおり拒否し、disabled entry・watch・eventを消さない。
- 有効設定の照会はcurrent connection/target/conversationに限定し、他会話がONでもOFF側を競合errorにしない。別connectionの古いentryをcurrent connectionとして選ばず、不一致中は登録を見送る。同一会話の複数tabは従来の単一owner tab制約とstale tabの再bind条件を保つ。ON/OFFをentry単位で直列化し、running_only待ちのroute変更後は保存しない。
- 回答完了候補は従来どおり当該会話の確定済assistant回答内に存在するBridge live IDのみ。候補ID一致は起動turn/threadを暗号学的に証明しない制約をC49受入手順へ明記。running全件の周期探索は追加していない。
- watch所有権は既存の`CodexBridgeThreadMonitorStorage.mutate` read-modify-write直列化と`allowOwnerTransfer: false`でconnection/target/canonical thread単位に保つ。異なる会話が同一threadへ同時要求しても一人だけが作成し、競合failureはその会話に記録して別候補は続行する。同一会話の完了登録とstop/skipを同じentry lockに揃え、登録中のstop競合でwatchが残る回帰も修正した。
- 受入手順は`docs/c49-parallel-auto-watch-acceptance.md`、最終項目は本書C49行。自動検証は`pnpm test` 814/814、`pnpm typecheck` PASS、`pnpm lint` PASS（check:size 289 files、最大500行/32768 bytes）、`pnpm build` PASS、`git diff --check` PASS。実装時点のsource/build検証とChrome実機受入は区別する。後続の限定的な実機観測は下記に記録し、C48は従来の801/801 automated PASS・Chrome NOT_RUNを維持する。
- 2026-11-24ユーザー報告：異なる2つのChatGPT会話で自動監視をONにできた、片方をOFFにしてももう片方に影響しなかった、F5後も会話ごとの設定が維持された、の3項目をPASSとして記録。追加で「前回の2本同時監視もちゃんと効いてるっぽい」との報告があり、Bridge側でFX-LLMとCPPの2本同時実行を確認したとのこと。並行実行が成立した暫定観測として記録するが、watch登録・正確なconversation owner・自動登録経路・通知/最終回答の会話帰属に独立した確証はなく、PASS数は3のまま。別threadの自動登録、監視対象の非混在、終了通知owner、C47最終回答自動反映、同一thread競合、skip/mute/failure、接続変更、別tab、SPA等はNOT_RUN。OFF後のwatch/event等やF5後のwatch/event復元・owner帰属にも拡張しない。C49全体は部分PASSで、実機受入完了扱いにしない。C48のNOT_RUN記録は変更しない。

## C50 最終回答自動反映テンプレート（2026-11-24）

- Issue #22のテンプレート編集・共通設定保存/import/export/reset・C47挿入を実装する。schema version 1を維持し、template未設定の旧設定は正式token単独へ正規化する。templateは8,192 UTF-16 code units以内で、`##Codex最終回答##`を1個以上必須とする。C37回答取得上限256 Ki UTF-16 code unitsは既存どおり。
- Optionsの「自動反映」に複数行欄、token説明、例文preview、token単独へ戻すdraft操作を追加する。保存・JSON importはtoken欠落/型不正/上限超過を明示拒否し、旧JSONのfield欠落はdefaultを使う。
- C47は`retrieved + confirmed`の回答取得後・append直前に設定repositoryから一度だけ正規化済み設定を読み、全tokenを文字列として一度に置換して既存の末尾appendへ渡す。最終回答本文中のtoken、`$&`等、空白・改行・Markdownを再処理しない。route/owner eligibilityをtemplate読込後に再確認し、失敗時は可視の未反映とする。
- event受信時ではなくappend直前snapshotを使うため、queue待ち・回答取得中に保存されたtemplate変更は、そのeventの挿入時に読み込まれた値へ反映する。空/未確定/取得失敗の回答は従来どおり挿入せず、通知・手動copy/insert・既存draft保護を維持する。送信/Enter/送信ボタン/自動承認は追加しない。
- Chrome手順は`docs/c50-terminal-answer-template-acceptance.md`に追記。2026-11-24のユーザー報告で、設定欄、プレビュー、保存後保持、token欠落時の保存拒否、既存draft保持、既定値復元、および直前のC50記録更新後にCodex終了時のtemplate反映があった正常系をPASSとし、主要8項目中7/8の部分PASSへ更新。自動送信なしは明示報告がないためNOT_RUN。選択範囲、添付、JSON入出力、複数token、競合、失敗経路等も未確認。CPP側の反映成功はC49の両会話owner帰属を証明せず、C49の既存暫定観測と3項目PASSは変更しない。C48の自動801/801 PASS・Chrome NOT_RUNも維持する。
- 自動検証：`pnpm test` 823/823 PASS、`pnpm typecheck` PASS、`pnpm lint` PASS（check:size 291 files、最大500行/32768 bytes）、`pnpm build` PASS、`git diff --check` PASS。これはsource/build確認で、C50 Chrome実機受入はNOT_RUN。

## C51 ChatGPT / Codex通知音の独立設定（2026-11-24）

- Issue #21。ChatGPT回答完了音とCodex監視終了音にそれぞれenabled/soundId/volumePercentと試聴を設ける。音源asset管理・単一出力先・offscreen再生基盤は共通利用し、Issue #20の複数出力デバイスは含めない。
- schema 1を維持しCodex専用の3 fieldを追加する。Codexの新規既定はOFF・`two-tone`・60%。旧設定/JSONでCodex fieldが欠けた場合は、対応するChatGPT fieldを旧既定値（OFF・`tone-660`・60%）で正規化してから項目ごとに引き継ぐ。明示Codex値は保持し、保存/JSON exportで正規化した後はChatGPT側設定から独立する。
- Optionsは通知設定を2組表示し、共通音源管理と出力先は重複表示しない。共通カスタム音源の削除前に、保存済み設定の該当する両参照だけを既定音へ保存し、各draftも一致する選択欄だけを更新する。読込/保存失敗や競合では音源削除を行わない。
- Codex終了音だけ専用設定を参照する。ChatGPT回答完了の通知経路、会話別ミュート/owner guard、終端eventの重複防止、初回既終了状態・手動解除の非通知条件は維持する。
- Chrome受入手順は`docs/c51-independent-terminal-sound-acceptance.md`。本実装の実機結果は未報告のため全項目NOT_RUN。C48は自動801/801・Chrome NOT_RUN、C49は限定3項目PASSと追加暫定観測、C50は主要7/8部分PASS・自動送信なしNOT_RUNのまま保持する。
- 詳細設計・実装順は`docs/superpowers/plans/2026-11-24-issue-21-independent-terminal-sound.md`。
- 自動検証：`pnpm test` 832/832 PASS、`pnpm typecheck` PASS、`pnpm lint` PASS（check:size 292 files、最大500行/32768 bytes）、`pnpm build` PASS、`git diff --check` PASS。source/build確認とChrome実機受入は区別し、C51の全実機項目NOT_RUNを維持する。

## C46 semantic guard correction（2026-11-24）

- 08:09:15 JSTのユーザー提示スクリーンショットでは、イベント検出、Bridge候補取得OK・2件、本文照合`dom-changed`、監視登録未実行、B監視0、自動登録ON。Bridge側候補は2件とも`live/in_progress`。実機からIDや回答本文は記録しない。
- Source原因は、main外の変更を除外するcommit `12b82ea965180a940cb5d3c8785fa23380d8ac13`以後も、`turn.contains(record.target)`により回答turn内の属性・装飾・非本文UI変更を本文変更と同等に扱っていたこと。Bridge候補OK後、本文を読む前に`dom-changed`で停止する。画面だけでは個別mutation種別は分からない。
- 修正後はsemantic本文一致とroute/root/unique turn/assistant ID/complete状態の再検証で判定する。Bridge候補2件、回答本文の完全一致1件なら対象1件だけ登録しcontrol候補は登録しない。本文/DOMはbackgroundへ送らず、診断は既存の安全な理由コード・件数だけを使う。
- 自動検証：`pnpm test` 756/756、C46 bridge-first 16件と登録連携20件を含む。`pnpm typecheck`、`pnpm lint`、`pnpm check:size`（269 files）、`pnpm build`、`git diff --check`もPASS。
- この記録時点ではsource修正後のChrome受入は未実施だった。その後ユーザーがrepo直下`dist/`をreloadしChatGPTをF5し、10:00:42 JSTのC46基本正常経路を確認した。限定的なPASSと未確認項目は本書冒頭に記録する。

## C52 通知音の複数出力先（2026-11-24）

- Issue #20と追加コメントに基づき、Options共通出力先を最大8件のcheckbox選択へ変更する。空選択は既定出力。`chatPanelPlus.answerCompletionOutputDevice`の旧単一`{deviceId,label}`はschema 2配列へ読み替え、ユーザー操作前の自動書き換えはしない。破損値は保存操作で上書きしない。共通設定JSON対象は拡張せず、UIに対象外と示す。
- 同一出力要求は出力ごとに独立AudioContextを作り、複数物理出力へ並行再生する。部分成功・全失敗を区別し、切断/権限/sink/context/playback失敗を他出力へ波及させず、成功先の再生を重複しない。部分失敗時の全体retryや既定出力fallbackを行わない。空選択時のChatGPT/試聴ローカル経路とCodex Offscreen既定経路、C51の通知別音源・音量・enabled、既存mute/owner/dedupe意味を維持する。
- Chrome受入手順は`docs/c52-multiple-output-devices-acceptance.md`。今回の実機結果は未報告のため全項目`NOT_RUN`。C48/C49/C50既存観測を変更せず、C51実機受入も全項目`NOT_RUN`を維持する。
- 詳細計画は`docs/superpowers/plans/2026-11-24-issue-20-multi-output-devices.md`。最終自動検証は`pnpm test` 851/851、`pnpm typecheck` PASS、`pnpm lint` PASS（check:size 295 files、500行/32768 bytes以下）、`pnpm build` PASS、`git diff --check` PASS。実機のChrome reload、ChatGPT F5、デバイス切断/再接続、複数実音再生は行っていないためC52はNOT_RUNのまま。
