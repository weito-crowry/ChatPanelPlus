# ChatPanelPlus メインパネル再設計 v2 Phase 0 監査

## 監査範囲と実行境界

この監査は、Panel、Bridge一覧／監視、設定保存、conversation route、Options保存、関連テストとbuild scriptを中心にした必要範囲の確認である。全ソースの網羅監査ではない。未確認の項目は下記に分けた。

- 開始時の変更差分はなく、`main`を`origin/main`へfast-forward後、作業ブランチ`codex/cpp-mainpanel-v2-20261121`を作成した。作業HEADは`850701450d4ca03243d64022e87e45c92bea86fb`。
- 既存Chrome実機接続成功は依頼者が示した`docs/cpp-mcp-phase6-acceptance.md`の記録を前提とする。このPhase 0ではChrome、Bridge、認証情報を操作していない。
- Phase 0でコード、`dist/`、Chromeロード元を変更していない。commit、push、PR作成もしていない。

## 現行実装で確認した事実

### 1. パネル画面と依存

| ファイル | 現行の役割と依存 |
|---|---|
| `src/content/Panel.tsx` | `SettingsRepository`で設定とview stateを読み、変更を購読する。入力アダプター／貼り付け、統計、Codex作業中モード、`CodexBridgeList`、常時ボタン、タブとタブ内ボタン、Options起動、最小化を一つの画面に構成する。見出しは`ProjectPanelTitle`。 |
| `src/content/panel-view.ts` | 設定から可視タブ・ボタンのViewModelを作り、初期選択、選択タブの補正、最小化切替を純粋関数で扱う。保存対象は選択タブと最小化。 |
| `src/content/panel.css` | 通常／最小化の見た目、ヘッダー、操作、Bridge表示、ダーク表示を持つ。Phase 0では新しい幅・ブレークポイントを決めていない。 |
| `src/content/CodexBridgeList.tsx` | Bridge対象選択、thread一覧取得／追加ページ取得、thread選択、手動状態確認を行う。現在の状態値、`needs_attention`等も詳細表示する。 |
| `src/content/CodexBridgeWatchPanel.tsx` / `src/content/codexbridge-watch.css` | 監視開始／解除、監視状態一覧、終了イベント一覧を表示する。終了イベントを選択し、明示操作で最終回答を読み、本文のコピー／入力欄への挿入もできる。音声結果の表示は終了確認状態ではない。 |

現行のBridge一覧・監視は、通常表示の`CodexBridgeList`内に一覧、状態詳細、監視、終了イベント、最終回答取得を連続表示する。v2指定の3画面や折りたたみA→B→Cフロー、2つのサマリー件数はまだ実装されていない。最小化時はPanel本文が隠れる。

### 2. 「全文／要約／翻訳／調べて」の実在確認

`src/shared/default-ui.ts`の4操作は、既定の「指示」タブに属する`kind: insert`ボタンで、定型文を持つ。`Panel.tsx`から`dispatchPanelButton`へ渡す処理は、選択中の既存入力欄への挿入を行う。確認したこの導線は生成ジョブ開始や自動送信ではなく、プロンプト挿入である。

`CodexBridgeWatchPanel.tsx`には、終了イベントを選んだ後の明示的な最終回答取得、取得本文表示、コピー、入力欄挿入のコードがある。ただし実機Chromeでの本文表示はPhase 0で確認していない。

### 3. 設定とview stateの保存境界

- `src/shared/settings-repository.ts`の共有設定キーは`chatPanelPlus.config`、共有view stateキーは`chatPanelPlus.viewState`。
- `ExtensionSettings`にはボタン上書き、表示順、カスタムボタン、カスタムタブ、音声設定、Bridge URLなどが含まれる。Optionsは同じrepositoryから設定を読み、保存・import/exportを行う。カスタムボタン定義は設定の一部として保存される。
- `Panel.tsx`は全タブで同じview stateを読み、storage変更も購読する。従って選択タブ／最小化は現行では会話別ではなく、複数会話タブ間で共有される。
- Optionsの既定レイアウト復元は`saveSettings`へ`resetViewState`を渡し、共有view stateキーも既定値にする。
- Bridge MCPトークンの既存session保存は設定値の保存経路と分かれている。このPhase 0では値を読まず、接続設定を変更しない。

**移行案:** `chatPanelPlus.viewState`は残し、新画面は読まず、書かず、自動コピーしない。新しい会話別保存領域へは有効なconversation IDをキーにしたUI状態を保存する。会話IDが取れない新規会話では既定状態を一時表示し、保存もしない。過去の共有値をどの会話へ割り当てるか推定しないため、他会話への引継ぎとユーザーデータ破壊を避ける。Optionsの「既定レイアウト復元」が会話別状態へどう反映されるかは、Phase 0では未確定として残す。

### 音声設定と再生経路（追加監査）

| 現行項目 | 現行スコープ／保存領域 | 確認した経路 |
|---|---|---|
| 回答完了音の有効化、選択音、音量 | 共有。`chrome.storage.local`の`chatPanelPlus.config`内に`answerCompletionSoundEnabled`、`answerCompletionSoundId`、`answerCompletionSoundVolumePercent`を保存 | `Panel.tsx`の`toggleAnswerCompletionSound`は`SettingsRepository.saveSettings`で共通設定を更新する。`ConversationStatistics.tsx`の表示トグルもこの値を受け、完了通知時のsoundEnabled／volume判定と`AnswerCompletionSoundPlayer.setEnabled`に使う。 |
| Optionsの音声設定 | 共有設定のdraft | `OptionsPage`は`loadSettings`で共通設定を読み、保存時に同じrepositoryへ書く。`AnswerCompletionSoundSettings`は共通の有効化、音色、音量を編集する。 |
| 出力デバイス | 共有。`chrome.storage.local`の`chatPanelPlus.answerCompletionOutputDevice` | `AnswerCompletionOutputDeviceRepository`がload/saveし、Options UIはChromeプロファイル内のChatGPTタブ間共有と表示する。 |
| ユーザー音源asset | 共有。`chrome.storage.local`の`chatPanelPlus.answerCompletionSoundAssets` | sound asset repositoryがload/saveし、完了音とBridge音源選択に使う。 |
| 会話別音声ミュート | **現行実装にはなし** | `chatPanelPlus.config`と現在のPanel toggleは共通有効化。タブID＋会話IDのミュートkey、操作、再生判定はいずれも未実装。 |

`dispatchAnswerCompletionNotifications`は共通有効化と音量が有効な場合にsound callbackを呼ぶ。content側の出力ルートはデバイス確認をbackgroundへ送り、既定出力なら応答後にcontentの`player.play()`、選択デバイスならbackgroundの`playOffscreen()`がroute応答より先に実行される。現行メッセージにconversation IDは含まれない。

`ConversationStatisticsController`は現在のconversation IDを内部に持ち、完了イベントをcallbackへ渡す。現行の`ConversationStatistics` callbackは完了eventを受け取るが、route／会話IDを再生要求へ明示的に結び付けず、共有音声値で再生する。

**会話別ミュートの設計:** 共有`answerCompletionSoundEnabled`はブラウザ共通のON/OFFとして扱い、現行のPanel toggleを会話別muteへ読み替えない。パネルには別々の共有有効化操作とミュート操作を設ける。実効可聴条件は`共有有効化 && !ミュート(tabId, conversationId)`。音量、音色、出力先、音源assetは共有のまま維持する。

ミュートの保存案は、既存Codex作業中モードと同じくbackgroundが信頼した`sender.tab.id`とconversation IDを組み合わせ、`chrome.storage.session`に保持する方式。タブIDを含めるため同一会話を別Chromeタブで開いた場合もミュートは独立する。content scriptはtab IDを自己申告せず、background経由でread/writeする。タブ再読込では同じtab ID／conversation IDの値を復元し、タブ終了では該当状態を整理する。

**誤音鳴りにつながる競合:**

- 完了イベントを検出した時点のconversation IDを保持し、SPA遷移後に現在routeの別会話状態で過去eventを判定しない。
- ミュートread完了前に完了音を開始しない。タブ再読込時はmute復元と完了通知監視の開始順を確認する。
- 既定出力ではroute応答後、content player実行直前に対象tab／conversationのmute状態を再確認する。
- 選択デバイスではbackgroundが`playOffscreen`を呼ぶ直前に、sender tabと会話routeに対応するmuteを確認する。ミュート更新後の古い再生要求にはgeneration／revision等を使う設計を検討する。再生開始後の音を遡って止められるかは既存経路では確認していない。
- 同一conversationの別タブ、SPA route切替、page reload、ミュート切替と非同期route応答が重なるケースを分離テストに追加する。
- 通常の回答完了音ではconversation ID不明時にパネルmuteをread/writeせず、別会話や最後の状態を借用しない。ID不明中に共通有効化だけで再生するかmute復元まで待つかは未確定。Bridgeの新規監視登録はowner ID不明なら拒否し、owner欠損legacy watchの音声はskipする。

**Bridge完了音の現行経路:** 現行`CODEX_BRIDGE_WATCH_START`は`CodexBridgeWatchPanel.tsx`の`startWatch`からtargetId/threadIdだけを送る。background handlerは`sender.tab.id`、`sender.tab.url`、`sender.url`、frameId等の信頼済みsender情報を検証して`monitor.startWatch`へ渡す。`thread-monitor.ts`はconnectionId＋targetId＋threadIdをidentityとしてwatch snapshotを共有`chrome.storage.local`へ保存し、既存watchは`created:false`で扱う。現在のsnapshotにはowner bindingがない。protocolの`CodexBridgeWatchSnapshot`と`thread-monitor-storage.ts`のvalidatorが拡張点となる。終端eventはTurn単位で生成元watchから`notifyForEvent → this.notification.prepare(event) → play()`へ進む。`codexbridge-notifications.ts`は共通音声設定とOffscreenを使い、現在owner tab／conversationを参照していない。

**確定仕様 — 登録元会話のmuteを適用:** watch開始時にChromeが信頼する`sender.tab.id`と、現在の`/c/<ID>`から検証したconversation IDをownerとしてsnapshotへ記録する。`sender.url`と`sender.tab.url`の会話ID、および要求conversation IDを照合し、SPA route切替などの不一致・判定不能は登録拒否とする。owner bindingはwatchの不変フィールドとして保持し、以降のTurn eventと通知もそのwatchのownerへ帰属させる。active tabや通知時点のrouteへ切り替えない。

mute本体はtab ID＋conversation ID別の`chrome.storage.session`だが、Bridge watchはタブ終了後も継続し得るため、watch recordにはowner IDと最新mute判定可能な通知policy snapshot/revisionを保持する。mute変更はbackgroundでsession値と該当watch owner snapshotを順序を保って更新する。タブが閉じてもwatch解除までowner bindingと最終既知muteを保ち、active tabへfallbackしない。保存先は既存の共有watch state内のwatch owner専用policyであり、他会話へ汎用適用する設定ではない。

通知音の直前にowner muteの最新状態を検査し、共有音声有効化OFFまたは音量0でも再生しない。mute ONなら音声だけをskipし、Turn event、未確認数、視覚通知は維持する。owner binding／muteが不明な場合も「owner不明・音声スキップ」とし、誤再生しない。mute参照からOffscreen開始までの非同期raceはserial/generation/revisionで防止する。

共有watch identityごとのownerは単一とする。同じownerからの再登録は冪等、別ownerからの登録は明示的なowner conflictとし、変更は解除後の再登録に限る。owner欠損のlegacy watchは監視を維持しつつ音声をskipし、UIは手動解除・再登録を案内する。自動移譲や複数owner対応はしない。owner IDをログ・公開UI・MCP出力に出さず、新規MCP APIも追加しない。

### 4. conversation routeとCodex作業中モード

`src/shared/conversation-route.ts`はURL pathの`/c/<id>`からIDを抽出し、英数字・`_`・`-`のみのIDを受け入れる。`src/content/codex-work-mode-route.ts`はpopstate/pageshowと250ms確認でSPA routeを観測する。

Codex作業中モードは既存background repositoryで`chrome.storage.session`に`tabId + conversationId`を含むキーで保存する。今回の会話別パネル状態とは保存範囲が異なる。v2実装ではwork modeの保存キー、通知、controllerを変更しない。

### 5. Bridge監視、終了イベント、重複排除

- 監視登録と終了イベントは、`CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY`の既存`chrome.storage.local`状態に保存される。監視登録はconnection／target／threadで識別され、既存の最大監視数は32。
- `CodexBridgeTerminalEvent`はTurn単位である。重複排除キーは`connectionId + targetId + threadId + turnId`。同じ監視threadの複数Turnは異なるイベントになる。
- 保存読込時もこの4要素のキーで重複をまとめ、同一Turn重複では音声通知状態の進んだ記録を優先する。現行イベント履歴上限は128件。
- 通常の監視処理は新しい終端Turnを検出してイベントを追加し、音声通知の結果を`pending/requested/played/skipped/failed`として保存する。これらは音声配信状態であり、ユーザーが終了通知を確認したかを示さない。
- 現在のwatch UIには確認済みフィールド／確認操作がない。イベント選択は表示選択で、確認とは別。
- storage mutationは`CodexBridgeThreadMonitorStorage`インスタンス内のqueueで順次実行される。確認変更も同じbackground storage ownerへ通し、content側から直接書き込まない構成がよい。

**現行のbackground応答範囲:** `CODEX_BRIDGE_WATCH_LIST`と`CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH`は現在items/eventsを全件返す。`CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER`はeventIdで全体台帳からeventを検索して最終回答を読む。contentの`CodexBridgeWatchPanel.tsx`も全件eventを描画し、取得・copy・入力欄挿入を行う。protocolの`CodexBridgeTerminalEvent`にはwatchId、connection／target／thread／turn／event ID、status、detectedAt、notificationState等はあるが、owner/conversation帰属はない。watch stopはwatchを削除してもeventを残す。owner情報がない現状は`WATCH_READ`／`WATCH_STOP`にも会話owner access controlを適用できない。一覧やボタンをUIだけでfilter／disableしても不十分で、background応答前の認可が必要。

**確定仕様 — 会話別一覧と件数:** backendの監視・polling・event ledgerは共通のまま、backgroundは各要求で`sender.tab.url`と`sender.url`から現在の`/c/<ID>`を検証する。`WATCH_LIST`と`WATCH_FOREGROUND_REFRESH`はwatch/event/summaryの生成前にownerConversationIdでfilterし、他会話の本文だけでなく存在、タイトル、件数もレスポンスへ混ぜない。`WATCH_READ`と`WATCH_STOP`も送信元会話がwatch ownerに一致する操作だけ許可する。owner不一致・owner不明時の拒否応答から他会話watchの有無を推測できないようにする。Aの一般Codex thread探索だけは共通discoveryのままでよい。Bの監視一覧・選択状態とCのevent一覧・選択状態はconversation ID単位で分け、同一会話の別tabでは共有する。

「監視中 N件」は現在会話ownerのwatch snapshotだけを数える。「監視スレッドが終了した未確認 N件」はownerConversationIdが現在会話と一致する未確認Turn eventを一つ以上持つ一意watch identity `(connectionId, targetId, threadId)` の数。複数Turnでも一件、他会話／ownerlessは除外。同一conversation IDを開く別Chrome tab同士では一覧と件数を共有する。未確認フィールドのない既存eventは確認の証拠がないため未確認として扱う案を維持する。

terminal event作成時にwatch.ownerのconversation ID（必要ならorigin tabIdとwatch identityも）を内部の不変snapshotとしてeventへコピーする。watch stop、後日の別会話からの再登録、SPA遷移、元tab終了でも過去eventのownerは変えない。生のowner IDはログ、公開UI、MCP出力へ出さない。ownerless legacy watch/eventは保全し、通常の会話別panel一覧・件数から除外しownerを推定しない。保守・解除は他会話情報を漏らさない設定画面等の別導線で将来整理する。

**確認競合案:** UIに表示した未確認event ID集合をbackgroundへ送り、各IDのownerConversationIdが要求元conversationと一致するeventだけを確認済みにする。他会話event IDは拒否し、他会話の未確認数を変えない。不存在IDと他owner IDへの拒否応答を区別せず、eventの存在を漏らさない。同一会話の別tabで同じIDを確認しても二回目は冪等。一覧表示後の新eventは確認対象に含めず、複数tab確認とevent追加の順序をテストする。音声状態は変えない。MCP APIは不要で、Chrome runtime内の既存background経路を使う。

**最終回答の会話認可:** `WATCH_READ_FINAL_ANSWER`はeventIdで台帳検索後、event ownerConversationIdと信頼済みsender conversation IDをbackgroundで照合する。不一致、ownerless、会話ID不明は拒否し、存在しないevent IDと他owner event IDの拒否応答を区別せずevent有無を漏らさない。UI disabledだけに依存しない。結果の表示・copy・入力欄挿入はevent owner会話でのみ許可し、挿入先はその会話を開いている現在tabの入力欄とする（登録元tabが前面である必要はない。同一会話の別tabは許可）。SPA route変更時にcontent側の選択event、取得済み本文、pending結果を破棄し、copy／挿入直前にも現在会話を再照合する。

**保持上限の論点:** 現行は全イベントを最大128件に切り詰める。未確認イベントが上限で削除されるとスレッド件数を正確に保てない。確認待ちイベントは確認まで残し、確認済みの履歴に128件上限を適用する案を次段階でテストする。上限超過時の最終方針は実装前にデータ挙動を確認する。

### 6. 既存テストとbuild境界

| 対象 | 主な既存テスト |
|---|---|
| Panel view／ボタンモデル | `tests/panel-view.test.ts`, `tests/default-ui.test.ts`, `tests/panel-button-actions.test.ts`, `tests/panel-custom-button-dispatch.test.mjs` |
| Settings／カスタムボタン／Options | `tests/settings.test.ts`, `tests/settings-repository.test.ts`, `tests/custom-buttons.test.ts`, `tests/custom-button-options.test.ts`, `tests/custom-tab-settings-repository.test.ts`, `tests/options-page.test.mjs`, `tests/options-tab-order.test.ts` |
| Bridge panel／要求追跡 | `tests/codexbridge-panel.test.ts`, `tests/codexbridge-request-tracker.test.ts`, `tests/codexbridge-watch-panel.test.mjs`, `tests/codexbridge-thread-monitor-handler.test.ts` |
| Bridge監視／終端イベント／通知 | `tests/codexbridge-thread-monitor.test.ts`, `tests/codexbridge-thread-monitor-review-fixes.test.ts`, `tests/codexbridge-terminal-events.test.ts`, `tests/codexbridge-notifications.test.ts` |
| SPA・作業中モード・コンテンツ | `tests/codex-work-mode-route.test.ts`, `tests/codex-work-mode-controller.test.ts`, `tests/content-lifecycle.test.mjs` |
| build assets | `tests/build.test.mjs`。通常の全テストに先立ちbuild出力を確認する。 |

`package.json`では`typecheck`は`tsc --noEmit`、`lint`はsource size確認と`eslint .`。一方`test`は先に`pnpm run build`を実行する。Vite設定は`outDir: dist`で、通常buildはChromeが読み込んでいるrepo直下の`dist/`を変更し得る。したがってPhase 0では`pnpm test`、`pnpm build`、`pnpm build:noop`、`pnpm deploy:chrome`を実行しない。

## v2実装での変更候補ファイル

| 段階 | ファイル候補 | 主な変更 |
|---|---|---|
| Phase 1 画面／コア分離 | `src/content/Panel.tsx`, `src/content/panel-view.ts`, `src/content/panel.css`, 必要なら新規panel controller | 画面構成から状態遷移・永続化・外部操作を分ける。既存動作は保つ。 |
| Phase 3 会話別状態／ミュート | `src/shared/settings-repository.ts`, `src/shared/conversation-route.ts`, `src/content/Panel.tsx`, `src/content/ConversationStatistics.tsx`, `src/content/conversation-statistics-controller.ts`, 音声出力route、background mute storage | UI stateとmuteのread/write／復元。ミュートはtab ID＋conversation ID別、他音声設定は共有。Codex work mode保存契約は維持。 |
| Phase 4 Bridge | `src/content/CodexBridgeList.tsx`, `src/content/CodexBridgeWatchPanel.tsx`, `src/content/codexbridge-watch.css`, `src/shared/codexbridge-thread-monitor-protocol.ts`, `src/background/thread-monitor-storage.ts`, `src/background/thread-monitor.ts`, `src/background/codexbridge-thread-monitor.ts`, `src/background/codexbridge-notifications.ts`, background mute repository／handler、必要なら`src/background.ts` | event owner snapshot、WATCH_LIST／WATCH_FOREGROUND_REFRESHのconversation filter、WATCH_READ／WATCH_STOP／READ_FINAL_ANSWER／確認のbackground認可、会話別summary、SPA破棄、owner mute。MCP API変更なし。テスト候補: `tests/codexbridge-thread-monitor-handler.test.ts`, `tests/codexbridge-terminal-events.test.ts`, `tests/codexbridge-notifications.test.ts`, `tests/codexbridge-watch-panel.test.mjs`, summary／final-answer access-control tests、mute repository／thread monitor tests。 |
| 回帰確認 | 上表の既存関連テストと新規summary/controllerテスト候補 | 複数会話、競合、イベント重複、既存機能の回帰確認。 |

`options/src/OptionsPage.tsx`、`options/src/options-state.ts`、`src/shared/settings.ts`、`src/shared/default-ui.ts`は保存と操作定義の依存として確認した。Phase 0で変更していない。出力ボタン再配置はまずPanel側で行い、Optionsの設定スキーマは不要な変更をしない。

## 主なリスクと未確定点

- **音声スコープ:** 現行Panelの回答完了音ON/OFFは共有`answerCompletionSoundEnabled`であり、会話別muteではない。共有操作とtabId＋conversationId別muteをUI・保存・再生判定で分ける。
- **音声race:** 通常回答完了音の既定route応答後とbackground Offscreen開始前にmuteを照合する。SPA切替、reload初期化、別タブ、toggle競合をテストし、通常回答完了音の未知ID時の扱いは未確定事項として分ける。Bridge通知は登録元ownerのsnapshot/revisionを再生直前に照合する。
- **Bridge owner／音声:** 現行watchにowner bindingはないため、登録時に信頼済みtab IDと検証済みconversation IDを固定し、元watchのmute snapshotだけで通知音を判定する。owner不明・mute不明は音声skip、視覚通知と件数は維持。重複登録のowner conflict、legacy owner欠損、タブ終了後、mute更新から再生までのraceを検証する。

- **グローバルview state:** 旧値を残したまま新保存に切り替えるため、古い最小化やタブ選択は自動移行しない。移行時に全会話へ誤複製しないこと。
- **route切替競合:** SPAでconversation IDが変わった後、前会話の非同期ロードが遅れて返るケースを防ぐ必要がある。
- **Options reset:** 現行リセットはglobal view stateも初期化する。新しい会話別状態への適用範囲は未確定。
- **会話別情報漏えい:** 一覧／foreground refreshのresponseをbackgroundでownerConversationId filterし、他会話のwatch/event内容・タイトル・存在・件数を漏らさない。WATCH_READ／WATCH_STOP／確認／READ_FINAL_ANSWERにもowner access controlを適用する。content側のfilterだけでは不十分。
- **最終回答のSPA競合:** 読取中にrouteが変わった場合のresponse破棄、表示／copy／挿入直前の再照合、同じ会話の別tab許可、別会話eventIdの拒否をbackgroundとcontentの両方で検証する。
- **終了数の意味:** countはTurnイベント件数ではなく、現在conversation ownerに一致する未確認Turn eventを持つ一意監視thread数。異なるBridge接続で同じtarget/thread文字列があってもconnection IDが異なれば別の監視対象とする。他会話・ownerless eventは含めない。
- **イベント保持上限:** 未確認状態を128件で捨てると正確な件数にできない。保持ポリシーと確認済み履歴の上限挙動が必要。
- **通知状態の混同:** 音声が再生済みでもユーザー確認済みとは限らない。新しい確認状態を分ける。
- **最終回答UI／認可:** 現行UIには取得・描画・copy・入力欄挿入コードがある。backgroundのowner access control、別会話拒否、SPA中の取得cancel／挿入gateは未実装で、実機Chrome動作も未確認。
- **Phase 5:** CPP UIからのジョブ開始、最終回答本文表示、event ownerと現在会話が一致する取得／copy／挿入、同一会話別tabの許可、別会話拒否、SPA中の取得cancelと復旧、Service Worker／Chrome／Bridge復旧は未検証として残す。Phase 0では実行しない。
- **未確認:** 元画像、画面幅・breakpoint値、Bridge詳細の実機レイアウト、OPTIONS resetの期待値、実機Chromeの今回の状態、live distのハッシュは調べていない。

## Phase 1受入試験案

1. 既存build付き全テストがPASSすること。実行前にrepo直下のlive `dist/`を変えない隔離手順を整え、新worktreeは作らない。
2. 画面とコアの分離後も既存のボタン挿入、貼り付け、クリア、タブ選択、最小化／復帰、Options、カスタム設定、統計、共有回答完了音ON/OFF、音量／音色／出力先／音源asset、既定／Offscreen出力経路、Bridge一覧／監視登録が保たれること。
3. 会話別状態について、別conversation IDのタブ間独立、同一会話の再読込復元、SPA遷移、未知IDの非保存、遅延ロード競合を確認する。
4. Codex作業中モードがtab ID＋conversation ID別session保存のままであることを確認する。
5. Phase 3で通常回答完了音の既存経路回帰と会話別muteのread/write・再読込復元・同一会話の別タブ分離・SPA切替・共有設定非干渉を確認する。Bridgeはowner snapshot更新、Turn eventの元owner帰属、同一owner再登録／別owner conflict／legacy owner欠損、owner mute OFF時のみ再生、mute ON／不明・タブ終了後の音声skip、視覚通知と件数維持、非同期再生raceをテストする。
6. 会話A/Bのwatch／event一覧・summary・確認分離、同一会話別tabでの共有、watch stop／別conversation再登録後のevent owner固定、sender偽装・不正会話の拒否、eventId越権read／stop／final-answer拒否、確認競合、新event保持、SPA中の最終回答取得cancel／copy／入力挿入再照合、ownerless legacy隔離をテストする。
7. 実機が必要な項目は試験結果を分け、未実施をPASSにしない。

## Phase 0 静的検査結果

- `pnpm typecheck`: PASS、終了コード0。実行内容は`tsc --noEmit`。
- `pnpm lint`: PASS、終了コード0。source size checkは174ファイル、上限500行／32,768 bytesでPASSし、`eslint .`も終了コード0。
- `git diff --check`: PASS、終了コード0。新規未追跡文書は通常のdiff対象外のため、UTF-8妥当性、末尾空白0件、ファイル境界を別途確認した。
- `git status --short --branch`: 作業ブランチは`codex/cpp-mainpanel-v2-20261121`、HEADは`850701450d4ca03243d64022e87e45c92bea86fb`。未追跡はこの2文書のみ。tracked source／dist変更とstaged変更なし。
- `pnpm test`、`pnpm build`、Chrome、Bridge操作は未実施。`dist/`変更と認証情報読み出しはなし。
- 作成文書はUTF-8として読み戻せ、個人用絶対パスとtoken形式の値は含まれず、末尾空白は0件。
