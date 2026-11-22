# Phase 4 — Bridge監視の会話別所有・通知・認可

## 自動受入結果

- 状態: **PARTIAL／自動検証・配備PASS、総保持方針とChrome実機確認は保留**。未実施項目をPASSとしていない。
- Phase 3の全テスト518件を基準に、Phase 4初回変更後は527/527 PASS（9件追加）。今回の最終レビュー修正後は539/539 PASS（累計21件追加）、修正箇所の焦点テストは29/29 PASS。
- `pnpm typecheck`: PASS。`pnpm lint`: PASS（500行／32 KiB検査を含む）。`git diff --check`: PASS。
- 全テストは`dist/`を除いた一時ソースコピーで実行し、`node_modules`のみリンクした。最終実行前後で登録済みrepo直下`dist/`の11ファイルについて相対パス・サイズ・SHA-256が一致した。
- MCP APIを追加せず、既存Chrome runtime messageと共有watch/event保存形式を内部拡張した。

## 登録済みdistへの配備記録

- Phase 4実装コミット: `f321cf50f6f81a2fd38975dda79a8e5d1a0cff26`。
- repo直下のChrome登録済み`dist/`へ`pnpm build`で直接配備、exit code 0。`pnpm deploy:chrome`は使用していない。
- 配備前バックアップ（repo兄弟）: `ChatPanelPlus-dist-phase4-predeploy-backup-20261121-122238-938-761563`。11ファイルすべての相対パス・サイズ・SHA-256が配備前`dist/`と一致し、照合一覧は隣接する`.sha256.txt`に保存した。
- 配備後は11ファイル。Manifest V3、version `0.1.5`、必須6ファイル、Manifest/HTML参照、Phase 4のowner conflict・終了通知確認表示を確認した。Phase 3バックアップから`background.js`と`content.js`が更新された。
- branch/HEADは実装commitから不変、Git clean。Chrome reloadは未実施。実機確認はPhase 5へ延期。

### 最終レビュー修正の配備

- 修正commit: `048953c3bd44298a9261048209c433eb9acc2d40`。登録済みrepo直下`dist/`へ`pnpm build`を実行し、exit code 0。`pnpm deploy:chrome`は使用していない。
- 配備前バックアップ: `ChatPanelPlus-dist-phase4-review-predeploy-backup-20261121-131345-babd0e04`。11/11ファイルの相対path・size・SHA-256が一致。完全manifestは隣接する`.manifest.json`へ保存した。
- 配備後11ファイル。Manifest V3、version `0.1.5`、必須6ファイル、Manifest/HTMLの7参照、ACK部分結果文言・conversation state key・background ACK handler markerを確認。配備前から変更したartifactは`content.js`の1/11件。全配備後hashは隣接するpostdeploy manifestに保存した。
- HEADは修正commit、Git clean。Chrome reload・実画面操作は未実施。ユーザーの最終Chrome受入に残す。

## 変更した境界

- 監視開始時にbackgroundが信頼済みsenderのtab IDと検証済みconversation IDをownerとして記録する。同一watch identityのownerは常に単一。別conversationからの重複開始はstorage.mutate内で既存watchのownerを原子的に移管し、watchId・baseline・lastObservedTurnId等を保持する。同じconversationからの再登録は冪等。競合する移管は直列保存順の後勝ちとする。
- WATCH_LISTとWATCH_FOREGROUND_REFRESHの両方をbackgroundでowner会話に絞る。WATCH_READ、WATCH_STOP、WATCH_READ_FINAL_ANSWER、終了event ACKもsender会話を認証し、他会話のデータ・件数・存在を返さない。
- 終了eventは作成時のwatch owner identityをsnapshotする。watch解除や後日のowner移管、tab終了でも過去eventの帰属を変更せず、移管後に作成したeventだけ新ownerへ帰属する。ownerの生IDはpanel表示に露出しない。
- 同一conversation IDの複数タブでは通知一覧と件数を共有する。最終回答の取得はevent ownerと要求sender会話が一致する場合だけ許可し、content側もroute変更中の選択・取得結果を破棄し、copy／入力欄挿入直前に再確認する。
- 件数は「監視中」と「監視スレッドが終了した未確認」の2種。後者はowner会話の未確認Turn eventを含む一意watch identity数。通知再生状態とユーザー確認状態は別に保持し、確認はevent ID単位で冪等に処理する。
- Bridge完了音は登録元tab＋会話の最新mute判定に従う。tab別session値がなくてもwatch/eventの最終既知muteを使い、ownerまたはmuteが不明なら音声をskipする。active tabへのfallbackはしない。共有音声有効化、音量、出力先の設定は維持する。
- ownerなしの旧watch/eventは共有保存を保つが、通常の会話別panel表示・件数から除外する。所有先を推測しない。旧watchの音声はskipし、UIから他会話情報を漏らさない。

## 保留・実機未確認

- event台帳の総保持数上限は未決定。未確認eventは件数を誤らせないため削除せず保持し、確認済み履歴は別枠で最新128件を保持する。未確認eventが128件以上あれば総数は128件を超える。より厳密な総保持方針は決めていない。
- Bridgeが返す最終回答本文の完全性は確認できない。UIは切詰め情報がない点を表示し、別のmessageを最終回答として推測しない。
- 通常回答完了音でconversation IDを取得できない場合の扱い、Optionsの「既定値に戻す」が会話別状態へ及ぼす範囲は引き続き未決定。
- Chromeでの実ジョブ開始、Bridge終了通知・実音声、実画面の会話分離、legacy ownerlessの運用保守、Service Worker／Bridge再起動、final-answer取得・copy・挿入、SPA raceは未実施。Phase 5チェックリストで**NOT_RUN**として確認する。

## Phase 4の主な自動テスト

- 会話A/Bの一覧・summary・ACK・read・stop・final-answer分離、sender URL不整合とownerless隔離。
- 同一会話の別tab共有、watch stop後・移管後も不変なevent owner、別ownerへの後勝ち移管、watch上限時の既存枠移管、旧ownerのstop/mute不作用、移管中pollの帰属、同時移管の単一watch維持。
- 未確認eventが128件を超える場合の保持、確認済みeventの保持範囲、重複TurnとACK race。
- Bridge音のowner mute、owner不明時のskip、再生直前mute更新の直列化。
- SPA route変更中のwatch操作、final-answer取得・copy・入力欄挿入キャンセル。

## 最終レビュー修正（2026-11-21）

- この修正は初回Phase 4配備の後に追加し、新規兄弟バックアップの全件hash照合後に登録済み`dist/`へ配備した（上記記録）。
- **未確認event 129件以上のACK:** UIでowner会話に表示中のevent IDを一度snapshotし、最大128件ずつ重複除外・直列送信する。部分失敗では成功応答件数を示して一覧を再取得し、再試行可能な未確認分を残す。SPA route変更時は次batchを送らない。backgroundのsender/owner認可、冪等ACK、event ID単位のrace保護は維持した。
- **会話別B/C選択:** 監視watch identityと終了event IDを既存versioned conversation stateへ追加。同じconversationの複数Chrome tabで共有し、別conversationでは分離する。schemaVersion 1の旧状態は新項目を`null`補完し、owner一致の保存済み一覧に存在しない選択は解除する。Aの一般thread探索選択とは別状態。最終回答本文は永続化せず、event ownerと現在routeの一致を従来どおり要求する。
- 自動確認: 129/256件batch、実background handler上限、途中失敗、新規event並行発生、route中止、owner認可、conversation A/B選択分離、旧schema互換を含む539/539 PASS。`pnpm typecheck`、`pnpm lint`、500行／32 KiB検査もPASS。
- 初回全回帰の538/539では`PanelView`が新しい選択propsを`CodexBridgeList`へ渡す契約テストが旧JSX形を固定して失敗した。テストを新props（watch/event selectionとcallbackを含む）へ更新し、UI契約を維持した上で全539 PASSを確認した。機能テストを削除・緩和していない。
- 総event保持数上限は引き続き未決定で、未確認eventの保持方針を変更していない。Chrome実機の大量ACK、途中通信失敗、同一会話別tab／SPA／reload後の選択復元は未実施のまま最終チェックリストに残す。

## 後続修正: owner後勝ち移管と通知クリア

- owner競合時の拒否を廃止した。別conversationからのWATCH_STARTは、同一connection/target/thread identityの既存watchをstorage.mutate内で原子的に移管する。同ownerの再登録は冪等、同時移管は最後に直列確定したownerを採用する。
- 移管ではwatchId、baseline、lastObservedTurnId、poll状態を保持し、ownerTabId・ownerConversationId・ownerMuted・ownerMuteRevisionを新senderの値へまとめて置換する。既存のwatch上限に達していても追加枠を使わず移管できる。
- terminal eventは作成時のowner snapshotを維持する。移管前eventは元conversationに残り、移管後に確定した新規eventは新ownerに帰属する。旧ownerは一覧・解除・mute更新で新watchを操作できず、通知クリアも各eventのownerだけを対象にする。ownerless legacy watchは推測移管しない。
- 集中回帰では移管、再登録冪等、上限、旧owner権限、過去／新規event、同時移管、sender不一致、通知クリア、移管中のterminal pollを確認する。今回のChrome実機確認は未実施。

## C12 thread表示 follow-up（2026-11-21）

- ユーザーのChrome実機指摘では、thread一覧で実行中が先頭に表示されなかった（修正前FAIL）。修正commit: `c528acd37e9b0d907175f4e19019c6913f027eca`。
- 取得済みthreadだけを、`currentExecution.state`が`in_progress`／`running`の確定実行中、`estimated_running`の推定、その他の順で表示する。各群は有効な`updatedAt`新しい順、日時欠損・不正は安定した元順で末尾。`lastTurn.status`だけでは実行中と判定しない。配列・選択・監視・ページングは変更しない。
- 「実行中のみ」checkboxは初期OFF。ONでも確定／推定を表示し、対象は読み込み済み一覧のみと説明する。次ページ取得を保ち、選択中threadや監視状態を変更しない。新API・自動fetchは追加していない。
- 全548/548 PASS（C12追加分は4ロジック＋5 UI契約テスト）、`pnpm typecheck`・`pnpm lint` PASS。隔離テスト前後でlive `dist/`の11ファイル相対path・size・SHA-256一致を確認した。
- 配備前バックアップ: `ChatPanelPlus-dist-c12-predeploy-backup-20261121-215034-e7f2d76cca0346e5a440171dffb49bda`（11/11照合PASS）。登録済みrepo直下`dist/`へ`pnpm build`を実行しexit 0。配備後11ファイル、Manifest V3/version `0.1.5`、必須6ファイル、参照整合とC12表示markerを確認。`pnpm deploy:chrome`は未使用。
- Chrome reloadとC12の修正後実機再確認はNOT_RUN。C12受入は再確認待ち。event総保持数上限が未決定のためPhase 4は引き続きPARTIAL。

## B監視開始表示の追加再現観測（2026-11-22）

- 基準commitの`CodexBridgeWatchPanel`では、owner-conflict文言は明示的な`WATCH_START`失敗時だけ設定された。`CodexBridgeList`のAスレッド選択・更新は監視開始を送らず、Bの開始ボタンだけが送信元だった。
- 同じ旧実装では無効なWATCH_LIST応答を`readWatchList`が`null`として返し、`refreshList`は無表示でreturnしていた。成功一覧・A選択変更でも共通`error`を消していなかったため、前回B開始で表示されたowner-conflictが後のA操作で残存・再描画された経路はコード上成立する。現在の未ビルド作業ソースではowner-conflict拒否を後勝ち移管へ置換している。
- 読み取り調査で未更新live `dist/content.js`にも旧文字列が含まれることを確認した。今回build/Chrome reloadはしていないため、実機に表示された瞬間のmessage source・送信履歴は未採取。よって「A操作が新規競合を発生させた」とは確認できず、直接原因は**未特定**。過去のB開始失敗が残って見えた可能性が比較的高いが、実行時証跡がないため仮説である。
- Bボタンが無効になる条件は選択thread、現在routeと会話IDの一致、一覧読込失敗/中、接続ID取得、busy状態。旧WATCH_LIST失敗は接続IDを`null`のままにし無言になり得た。watch一覧とaudio-mute handlerは双方`sender.url`・`sender.tab.url`のoriginとconversation ID一致を検証しており、SPA切替中の不一致は二つの失敗に共通し得るが今回の発生は未確認。権限条件は変更せず、作業ソースでsender拒否理由・一覧失敗・再試行・disabled理由を表示する。
- 新規監視開始拒否は`監視開始:`の操作ラベルと理由を表示する。Aの選択変更、thread読込開始、Bの明示的再試行で旧開始エラーを整理する。自動foreground refreshや過去リクエストの遅延応答が新しい開始失敗を消したり別選択へ移したりしないようgeneration/選択identityで分離する。
- 自動focused testsはA選択/更新ではWATCH_STARTが送られないこと、B明示操作だけが開始すること、現ownerの実失敗が表示対象になること、選択変更後の古い失敗を抑えること、sender不一致で解除messageを送らないことを対象とした。関連focused suite 93/93、隔離全suite 601/601 PASS。`pnpm typecheck`・`pnpm lint`・500行/32 KiB検査もPASS。
- 全テストはrepo `dist/`を除いた一時source copyで実行。repo live `dist/`は前後11/11相対path・size・SHA-256一致。正式dist build/deployとChrome操作は未実施。C43の実機確認はNOT_RUN。Phase 4は未確認event総保持数の仕様判断が残るためPARTIAL。
