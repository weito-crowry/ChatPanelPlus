# ChatPanelPlus Phase 6 — メインパネル外観・Bridge表示仕様

更新日: 2026-11-22
状態: 仕様記録。Phase 6 UIは未実装であり、現在のChrome表示・動作を示すものではない。

## 目的と対象

ユーザー提示の「ChatPanelPlus CodexBridge画面設計(1).png」を外観の基準に、既存のPhase 1〜5の機能・保存・認可を保ちながら、React/CSSでメインパネルを再構成する。画像中の説明シート、右側の「構成の概要」、左端の状態名は実際の拡張UIには含めない。画像の細部を未確認のまま寸法や装飾を推測しない。

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

- **A — スレッド一覧:** title/previewなどの人間可読ラベル、状態iconと短い日本語状態を主に表示する。C12で実装した実行中優先と「実行中のみ」filterを維持する。Phase 6では通常`running_only`を使い、必要時に通常20件cursor paginationのthread一覧へ切替える導線を設ける。このrunning-only server機能はCodexBridge別repoで実装・検証する依存項目であり、CPPから未実装APIを送信しない。更新、次ページ、マシン選択など既存操作を保つ。thread ID、cwd、target/connection ID、execution/turnの詳細や時刻を通常行に列挙せず、必要な情報は選択後の「技術情報」で折りたたむ。
- **B — 選択スレッド／監視中:** 現在選択したthreadの表示名、日本語status、既存の監視開始／解除を表示する。利用可能なtitle/nameを主ラベルに使う。ラベルが取得不能、null/空白、または表示に使えない場合はthread IDを仮の主ラベルにする。title/nameがある行にもIDを行内で常時併記しない。ラベルにmouse hoverするとthread IDをtooltipで確認できる。キーボードfocus時にも同じIDを説明文（例:`aria-describedby`）から取得できるようにする。tooltip対象は接続・target・ownerの内部IDに置き換えず、監視identityと認可は従来どおり`connectionId`/`targetId`/`threadId`で行う。
- **C — 通知・最終回答:** 現在会話ownerに属するeventだけを表示する。完了／失敗等の短い状態と時刻、最終回答の取得・copy・入力欄挿入を必要時に出す。event ID/Turn IDは通常行に出さず、「技術情報」に折りたたむ。既存ACK、background owner認可、SPA遷移時の本文破棄、部分失敗処理、event保存・保持動作を変えない。

### 最小化状態

本文と操作buttonを隠し、細い横長の1行にChatPanelPlus icon/名称、既存Codex作業中mode、「実行中 N」「監視中 N」「通知 N」、復帰chevronを配置する。既存の最小化操作、会話別保存・復元を維持する。未取得値を0と表示せず、現在会話以外のwatch/event件数を出さない。

## Bridge barの表示値とデータ境界

- **実行中:** 将来のCodexBridge `running_only=true`結果が持つ、Bridgeが実行中と認識したthread数を表示する。確定中と推定中の内訳は別countにしない。現行の通常20件ページを全thread数として数えない。API接続・応答前は`—`と待機中tooltipを表示し、実行数を推測・捏造しない。
- **監視中:** 既存のowner conversation-specific summaryを使用する。
- **通知:** 未確認終了通知を持つwatch identityの重複除外件数を使用する。既存のowner会話別集計を維持する。
- **接続状態／対象マシン:** 現行接続状態と選択中targetなど、取得済みの実データのみを表示する。接続失敗や未取得を接続中・0件に見せない。
- `running_only`用server API、実行件数、接続・対象名が未取得の時点ではplaceholderと説明を用いる。既存runtime messageを装った新requestやmock数値を追加しない。将来接続する場合はprops/adapter境界を分離する。

## ID・会話owner・アクセシビリティ

- Bでは、表示名が利用できる通常行にthread IDを常時表示しない。表示名が使えずthread IDを仮ラベルにする場合は、仕様上の必要なfallbackとして主ラベルに表示する。
- Bのtitle/nameラベルはmouse hover tooltipでthread IDを示す。キーボードfocus時も関連説明を読めるようにする。色だけで実行・選択・通知状態を伝えず、focus ringとARIA状態を保つ。
- A/Cに同様のID tooltipを広げる場合も、通常行にIDを併記しない。行はbackgroundでowner filterと権限確認されたデータだけから作り、tooltip/技術情報にも他会話・ownerlessのIDや本文を混ぜない。A/Cでtooltipを必須にする判断はPhase 6実装時に行う。
- 表示名はラベルであり、watch選択・保存・権限判定に使用しない。複数接続・複数target間でのidentityは内部の`connectionId`/`targetId`/`threadId`を維持する。

## 依存と未実装事項

- CodexBridge別repoの`running_only`実装・paginationとの共存・重複排除が必要。完了まではCPPの既存API経路を維持し、現在のC12 client filterだけを使う。新API成功や全thread網羅を表示しない。
- UI改修、tooltip/focus、3状態、Bridge barの3値統合は未実装。Chrome表示で動作するという受入結果はない。
- 元画像の細部・実機での正確な余白/幅は未確認。Phase 6実装時に画像の参照情報とChrome表示を使って調整する。

## Phase 6受入

最終Chrome受入のC31以降を本仕様の受入項目とする。Phase 6実装・Bridge APIの前提が整う前はすべて`NOT_RUN`。現在のC12/C30等の既存判定は変更しない。
