# ChatPanelPlus Phase 6 — メインパネル外観・Bridge表示仕様

更新日: 2026-11-22
状態: Phase 6 UIとrunning_only CPP連携を実装・自動検証し、2026-11-22にそれぞれバックアップ後`pnpm build`で登録済みrepo直下`dist/`へ配備済み。running_only CPP commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`のChrome reloadと実機確認は未実施で、現在のChrome表示・動作を示すものではない。Bridge再起動はユーザー報告済みだが、稼働サービスの`tools/list` schemaはこの接続から確認できていない。

## 目的と対象

ユーザー提示の「ChatPanelPlus CodexBridge画面設計(1).png」と、同時に示された画面構成・外観の説明を基準に、既存のPhase 1〜5の機能・保存・認可を保ちながらReact/CSSでメインパネルを再構成する。画像中の説明シート、右側の「構成の概要」、左端の状態名は実際の拡張UIに含めない。CSS初期幅・breakpointは実装に合わせて設定したが、Chrome実機の描画寸法や色は未確認。

Phase 6では通常、Bridge詳細展開、最小化の3状態を扱う。白〜薄い青みグレーの面、細い青灰色の境界、角丸、控えめな影、青いactive状態・線画icon、横長でコンパクトな操作列を基本とする。表示構成を変え、既存の設定値、会話・タブ別状態、Bridge owner、通知・音声の保存や認可、入力・copy等の副作用を変更しない。

## 画面構成

### 通常状態

1. **ヘッダー:** 左にChatPanelPlus icon・名称・区切り・動的プロジェクト名。長い名前は省略でき、tooltipとアクセシブルな名前を保つ。右に既存Codex作業中toggle、会話別muteを操作するスピーカー1個、Turns数の統計popover、Options、最小化chevronを置く。Codex作業中modeの保存契約を維持する。
2. **常時操作:** Optionsで定義したutility buttonだけを、表示順どおりコンパクトな横列で示す。例示された「現在時刻」「コピペ」「クリア」「雑談」を固定・強制表示しない。
3. **タブ:** 現行設定のタブ、順序、表示状態、会話別選択状態を保つ。active tabは青い背景と白文字で示す。
4. **prompt操作:** active tabで設定済みの挿入buttonだけを表示する。「全文／要約／翻訳／調べて」の例示を固定したり、自動送信したりしない。
5. **CodexBridge bar:** 1行に接続状態・対象マシンと「実行中 N」「監視中 N」「通知 N」を表示し、詳細を開く操作を置く。3ラベルを表示する仕様であり、Phase 0で決めたイベント保存・owner認可の意味を変えない。データ未取得中は`—`と待機中の説明を出し、0件と区別する。

### Bridge詳細展開

通常状態の上半分を保ち、Bridge barの下にA/B/Cのcardを横並びに配置する。広い画面で3列、狭い画面で2列または縦積みにし、横スクロールや操作buttonの隠れを避ける。900px/640px付近を初期breakpoint候補とし、Container queryを優先する。ライト・ダーク両方で文字と操作を判別できる配色にする。

- **A — スレッド一覧:** title/previewなどの人間可読ラベル、状態iconと短い日本語状態を主に表示する。C12で実装した取得済み候補の実行中優先を維持し、Bridgeの実行中APIと通常20件paginationをmodeで切り替える。実行中modeはBridge返却threadを直接表示し、通常一覧modeは通常APIの取得済み候補を使う。API未対応時に実行中結果を捏造せず、通常一覧へ切替可能。更新、次ページ、マシン選択など既存操作を保つ。thread ID、cwd、target/connection ID、execution/turnの詳細や時刻を通常行に列挙せず、必要な情報は選択後の「技術情報」で折りたたむ。Aのtitleにはthread IDのhover tooltipとkeyboard説明を付ける。
- **B — 選択スレッド／監視中:** 現在選択したthreadの表示名、日本語status、既存の監視開始／解除を表示する。利用可能なtitle/nameを主ラベルに使う。ラベルが取得不能、null/空白、または表示に使えない場合はthread IDを仮の主ラベルにする。title/nameがある行にもIDを行内で常時併記しない。ラベルにmouse hoverするとthread IDをtooltipで確認できる。キーボードfocus時にも同じIDを説明文（例:`aria-describedby`）から取得できるようにする。tooltip対象は接続・target・ownerの内部IDに置き換えず、監視identityと認可は従来どおり`connectionId`/`targetId`/`threadId`で行う。
- **C — 通知・最終回答:** 現在会話ownerに属するeventだけを表示する。完了／失敗等の短い状態と時刻、最終回答の取得・copy・入力欄挿入を必要時に出す。event ID/Turn IDは通常行に出さず、「技術情報」に折りたたむ。既存ACK、background owner認可、SPA遷移時の本文破棄、部分失敗処理、event保存・保持動作を変えない。

### 最小化状態

本文と操作buttonを隠し、細い横長の1行にChatPanelPlus icon/名称、既存Codex作業中mode、「実行中 N」「監視中 N」「通知 N」、復帰chevronを配置する。既存の最小化操作、会話別保存・復元を維持する。未取得値を0と表示せず、現在会話以外のwatch/event件数を出さない。

## Bridge barの表示値とデータ境界

- **実行中:** 選択中targetへ`codex_threads(running_only=true)`を要求し、Bridgeが返したthread数を確定・推定の区別なく表示する。Bridgeの認識範囲に基づく件数であり、Bridgeが把握していないthreadまで含む完全性は保証しない。通常20件ページから推定しない。接続中・未取得・失敗・未対応では`—`と状況tooltipを表示し、真の0件だけ0とする。
- **監視中:** 既存のowner conversation-specific summaryを使用する。
- **通知:** 未確認終了通知を持つwatch identityの重複除外件数を使用する。既存のowner会話別集計を維持する。
- **接続状態／対象マシン:** 現行接続状態と選択中targetなど、取得済みの実データのみを表示する。接続失敗や未取得を接続中・0件に見せない。
- Aの取得modeは「実行中（既定）」と「通常一覧」。実行中modeは`running_only=true`を使い、返却threadをclient側で実行状態filterしない。通常一覧modeは既存の`limit=20`とcursorを維持し、読み込み済み候補のC12優先順を適用する。mode/target切替時は古い非同期応答を破棄し、監視対象の選択をmode切替で解除しない。
- MCP `tools/list`で`codex_threads.inputSchema.properties.running_only`がbooleanと確認できた場合だけ実行中要求を送る。欠落・不明schemaのBridgeや、実行中要求を拒否するremote targetでは実行中件数を`—`にしてBridge更新待ち／取得失敗を示し、通常一覧modeは使用可能にする。実行中要求はtargetと`running_only`だけを送り、cursor/history/page limitと混ぜない。通常一覧は従来どおり通常APIの20件cursorを使う。
- 実行中件数は実行中modeの返却、または通常一覧modeで別途実行した`running_only`取得から更新する。target変更・接続エラー・失敗・未対応時に古い件数を残さず、通常／展開／最小化で同じtargetの同じsummaryを使う。初回取得・手動更新のみで、定期pollingは追加しない。

## ID・会話owner・アクセシビリティ

- Bでは、表示名が利用できる通常行にthread IDを常時表示しない。表示名が使えずthread IDを仮ラベルにする場合は、仕様上の必要なfallbackとして主ラベルに表示する。
- Bのtitle/nameラベルはmouse hover tooltipでthread IDを示す。キーボードfocus時も関連説明を読めるようにする。色だけで実行・選択・通知状態を伝えず、focus ringとARIA状態を保つ。
- Aではthread IDをhover tooltipとkeyboard説明から確認できる。Cのevent ID/Turn IDは通常行に出さず、「技術情報」に折りたたむ。行・説明・技術情報はbackgroundでowner filterと権限確認されたデータだけから作り、他会話・ownerlessのIDや本文を混ぜない。
- 表示名はラベルであり、watch選択・保存・権限判定に使用しない。複数接続・複数target間でのidentityは内部の`connectionId`/`targetId`/`threadId`を維持する。

## 依存と未実装事項

- CodexBridge側の`running_only` APIはlocal commit `41faae1`に実装済みとのユーザー報告があり、Bridge再起動完了もユーザー報告済み。稼働サービスの`tools/list` schemaは現在のCodexBridge接続から確認できず、`inputSchema.properties.running_only`の公開状態は未確認。CPPはschema能力検出と実行中modeを実装済みで、schema未対応・不明時は通常20件を実行中結果と誤認せず、件数を`—`にする。
- Phase6のReact/CSS 3状態、A/B/C card、Bridge bar、Bの名前fallback/ID tooltip、Aのhover・keyboard ID説明は先行commitで実装・配備済み。running_only CPP連携commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`も自動検証後に登録済みrepo直下`dist/`へbuild・配備済み。Chrome拡張のreloadは未実施なのでブラウザ内での反映は未確認。
- CPP running_only連携の自動検証記録: 全suite 563/563 PASS、focused suite 50/50 PASS、typecheck/lint/サイズ検査PASS。隔離source-only copyでテスト・buildし、当時の登録済みlive `dist/` 11ファイルはテスト前後で相対path・size・SHA-256一致。本ターンでは`pnpm typecheck`/`pnpm lint`を再確認し、repo `dist/`を`pnpm build`で更新した。BridgeサービスとChromeブラウザは操作していない。
- Chrome上の正確な余白・幅、hover/focus、light/dark配色、最小化時の実表示は未確認。最終受入チェックリストC31–C36は実機確認まで`NOT_RUN`とする。

## Phase 6受入

最終Chrome受入のC31以降を本仕様の受入項目とする。Phase6 UIの通常／展開／最小化・tooltip・responsiveの実機報告がなくC31–C36は`NOT_RUN`。running_only CPP実装commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`は自動検証後に`dist/`へbuild・配備済みだが、Chrome reloadと実機受入は未実施。Bridge再起動はユーザー報告済み、稼働`tools/list` schemaとChromeからの新API利用は未確認のためC38は`NOT_RUN`。別項目C37は2026-11-22のユーザー報告でfinal-answer取得失敗となった。native `codex_threads(include_history=true)`の別経路応答には同じTurnの`agentMessage`/`final_answer` itemがあるとの確認がある一方、CPP失敗時の応答は未取得で原因未特定。C37は未解決のままとし、C12/C30等の既存判定も変更しない。04:00 JSTの再発報告では、03:41完了Turnの終了event検出と音声は成功したがCPPはno-final-answer。後刻native historyの41 itemsにはphase=final_answerのagentMessageがなく、`codex_status.latest_agent_message`には最終報告があった。前回01:29対象Turnのnative historyにはfinal_answer itemがあった。CPP失敗時のraw応答は未取得で、原因は未特定。

## Phase6 UI初回配備記録（2026-11-22）

- UIソースcommit: `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`
- 配備先: `D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`（Chrome登録済みロード元）
- 実行: `pnpm build` exit 0。誤った兄弟Probe宛ての`pnpm deploy:chrome`は実行していない。
- 配備前backup: `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-predeploy-backup-20261122-012236-b904e2364297495daf438482a97522f8`。distとbackupはlink/reparse pointなし。build前に相対path・byte length・SHA-256が11/11一致。
- 配備後検査: 11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML/CSS local asset参照5件、Phase 6表示marker10/10を確認。build前からの内容変更は`content.js`のみ。
- この初回UI配備時点ではChrome reload・Bridge操作をしていない。C31–C36は`NOT_RUN`。当時のbundleにはrunning_only CPP連携commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`が未配備で、実行中件数は`—`だった。後日の連携配備は次節に記録する。

配備後ファイルのSHA-256 manifest:

| 相対path | bytes | SHA-256 |
|---|---:|---|
| `assets/index-C_XpLgfC.css` | 6701 | `7cdfc1cf1aee4b5ebfc6122fec43c75e9045483240bff046ef85e2df090c9988` |
| `assets/index-D6JxlyjY.js` | 294502 | `56bf45a2abf3e8849b680c98328023c8b91ef9c71e82895306358ea39a38a8a3` |
| `background.js` | 79181 | `ce168cccdfd589e415afaf4856fe8035177005210a9973b22775c756acd9641a` |
| `clipboard-probe.css` | 455 | `8d33028ae7bf6df78623bea5ca5658676c74c3a2c5aadcaf57150eb8c3caad19` |
| `clipboard-probe.html` | 1418 | `977a0d32e4acea352f0f47766d34fae837857fc3df840b7e58a00b596c4b8f76` |
| `clipboard-probe.js` | 8635 | `955eccdaa8828ea52a360d9851b8d4a9f58a018df9b00c7b9cfa4faadd09b60c` |
| `content.js` | 430073 | `bf327d61ab9c7e01de6a48a1e9345cf0e708d5180b5615835cfe0427ffb502d8` |
| `index.html` | 469 | `ba0cb89f4835fae131ece5f1bda15ea91da4c2eab4d62a5ca168789f156f31d2` |
| `manifest.json` | 762 | `b1e0d5ba2de4ddf2745b263680499afe09b6f1ba1c7ba6c029d00841a06c3f72` |
| `offscreen.html` | 203 | `da70320eef06462e7c45b661b857c98c8c9fb21cc7a8e1bd9904fbf87e8683a5` |
| `offscreen.js` | 3635 | `2c7a28c4914fd38a4e9c4ddd8f9605ffd045af4dbc369faa249e469f1d32dd65` |

## running_only連携配備記録（2026-11-22）

- CPP実装commit: `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`。今回の`pnpm typecheck`と`pnpm lint`はPASS。全テストは再実行しておらず、直前の隔離suite記録（563/563、focused 50/50 PASS）を参照する。
- Bridge再起動: ユーザー報告で完了。現在利用可能なCodexBridge connectorはnative thread一覧の呼出し口のみを公開し、稼働app serviceの`tools/list` schemaは読めなかった。`running_only`能力は未確認で、認証値・Bridge設定へのアクセスはしていない。
- 登録済みロード元: `D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`。build前backup: `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-runningonly-predeploy-backup-20261122-072227-7ce881baefb7451d8d5438a8d5f9e510`。リンク/reparse pointなし、相対path・byte length・SHA-256が11/11一致してからbuildした。
- 実行: `pnpm build` exit 0。配備後11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML local asset参照2件に欠落なし、Phase 6/running_only marker 8/8を確認。変更pathは`assets/index-BvLAkwA3.js`追加、旧JS asset削除、`background.js`・`content.js`・`index.html`更新の5件。誤った兄弟Probe宛ての`pnpm deploy:chrome`は実行していない。
- 配備後manifest SHA-256: `b1e0d5ba2de4ddf2745b263680499afe09b6f1ba1c7ba6c029d00841a06c3f72`。
- Chrome reloadは未実施。C31–C36とC38は`NOT_RUN`のまま。Bridge再起動後のschema公開と、Chromeが新APIを使って実行中件数を表示することは未確認。C37のfinal-answer取得問題も未解決。

配備後ファイルのSHA-256 manifest:

| 相対path | bytes | SHA-256 |
|---|---:|---|
| `assets/index-BvLAkwA3.js` | 294604 | `640052580e67c249e3b2df5d48419b90f8c9fe6e811f39dc9fea5b60246ddcac` |
| `assets/index-C_XpLgfC.css` | 6701 | `7cdfc1cf1aee4b5ebfc6122fec43c75e9045483240bff046ef85e2df090c9988` |
| `background.js` | 80195 | `0e98e13c9e808b074d6690f1f57997222eb6656dcdbe8ec4e87ed8996bb51307` |
| `clipboard-probe.css` | 455 | `8d33028ae7bf6df78623bea5ca5658676c74c3a2c5aadcaf57150eb8c3caad19` |
| `clipboard-probe.html` | 1418 | `977a0d32e4acea352f0f47766d34fae837857fc3df840b7e58a00b596c4b8f76` |
| `clipboard-probe.js` | 8635 | `955eccdaa8828ea52a360d9851b8d4a9f58a018df9b00c7b9cfa4faadd09b60c` |
| `content.js` | 432965 | `e4bb4694c00d9b46e72a5e64450e51b7c192353d1991a9a9d2a593a4ec7a23da` |
| `index.html` | 469 | `6616a57b5e616d2f90c70d560fd4e9e398ca13aa1c2c595ef3e240972dc26d5e` |
| `manifest.json` | 762 | `b1e0d5ba2de4ddf2745b263680499afe09b6f1ba1c7ba6c029d00841a06c3f72` |
| `offscreen.html` | 203 | `da70320eef06462e7c45b661b857c98c8c9fb21cc7a8e1bd9904fbf87e8683a5` |
| `offscreen.js` | 3635 | `2c7a28c4914fd38a4e9c4ddd8f9605ffd045af4dbc369faa249e469f1d32dd65` |
