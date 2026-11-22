# ChatPanelPlus メインパネル再設計 v2 実装計画

> 実装担当はCodex単独。サブエージェント、別モデル、新規worktreeは使わない。

**目標:** パネルの操作を通常画面、Bridge詳細展開、最小化の3画面へ整理し、会話ごとのUI状態と共有設定・Bridge監視状態を分離する。

**構成:** Phase 1で画面表示と状態・副作用のコアを分ける。続いて既存ボタンとBridge導線を3画面へ配置し、パネル状態を会話ID別に保存する。監視登録は既存の共有保存を維持し、終了通知の確認状態は既存のTurnイベント台帳へ加える。MCPサーバーのAPIは増やさない。

**技術:** Chrome MV3、React、TypeScript、chrome.storage.local/session、既存のChrome runtime message、pnpm。

**仕様:** 承認済み「ChatPanelPlus メインパネル再設計 v2」指示と、同日付のPhase 0監査文書を基準とする。

## Global Constraints

- 設定画面の設定、タブ、プロンプト、カスタムボタンおよびミュート以外の音声設定は同一Chromeプロファイル内で共通にする。
- 音声ミュートだけはChromeタブID＋conversation ID別に保存し、共有音声設定や別タブのミュート値を変更しない。
- 通常の回答完了音は共有音声有効化がONかつ現在のタブ／会話muteがOFFの場合に可聴とし、Bridge完了音は登録元ownerのmuteを使う。共有ON/OFFと会話別muteは別UI操作にする。
- Bridge watchはtrusted tab ID＋検証済みconversation IDを単一ownerとして保持し、別conversationから新たな監視開始があれば既存watchを原子的に後勝ち移管する。完了音はその時点のwatch ownerの最新muteだけを参照し、active tabへfallbackしない。
- Bridge監視と終了検出のbackendは共通とするが、Bの監視一覧、Cの終了通知一覧、通知確認、2件数はowner conversation IDごとに分離する。同じconversation IDを開いた別Chromeタブ間では表示・確認状態を共有する。
- Aの一般Codex thread候補探索一覧は共有でよい。通常の会話別パネルには、現在会話から登録したwatchと、その会話ownerを持つ終了eventだけを返す。
- Bの監視中一覧・選択状態とCのevent一覧・選択状態もconversation IDごとに分け、同一会話を開いた別tab間で共有する。
- 終了eventは作成時点のowner conversation ID（必要ならorigin tabId／watch identity）を内部snapshotとして固定し、watch解除・owner移管・SPA遷移で過去eventの帰属を変えない。
- 最終回答の取得・表示・コピー・入力欄挿入はevent ownerと現在会話が一致する場合だけ許可する。backgroundで取得を認可し、SPA遷移時はcontent側の選択・本文・pending結果を破棄して挿入直前にも再照合する。
- owner欠損の既存watch／eventは保持するが通常の会話別panelには表示・計上しない。ownerを推測して割り当てない。
- パネルが変更する表示・選択状態は会話ID別に保存し、別会話タブへ引き継がない。SPA遷移と再読込後に同じ会話状態を復元する。
- 会話IDが取れない間は既定状態をメモリ内で使い、会話別の保存値を読まず、書かない。
- 現行の共有view stateキーを削除・上書き・新会話への自動コピーをしない。
- Codex作業中モードの既存のタブID＋会話ID別session保存を変えない。
- CodexBridgeの監視登録と既存の保存キーは共有状態として維持し、各watchに登録元のowner bindingとowner専用mute policy snapshotを保持する。
- サマリーは「監視中 N件」「監視スレッドが終了した未確認 N件」の2つだけ。実行中、要対応、新着の分類は加えない。
- 終了数は現在conversation ownerの未確認Turnイベントを一つ以上持つ監視対象スレッドの重複除外数とする。会話ownerでfilter後、集約キーは既存watch identityのconnectionId、targetId、threadIdとしTurn IDは含めない。
- 終了通知確認は未確認イベントを確認済みにする。音声通知の再生状態と確認状態を混同しない。
- Bridge既存導線の整理に新規MCP APIは不要。確認操作は既存backgroundとイベント保存基盤を使う。
- Phase 2にヘッダー、常時ボタン、タブ／プロンプトボタン、「全文／要約／翻訳／調べて」の既存ボタン再配置を含める。元画像は使わない。
- 初期幅とブレークポイントは実装時に決め打ちし、実機Chromeで後調整する。
- Phase 0はドキュメントだけ。コード変更、Chrome配備／reload、Bridge操作、認証値読み出しはしない。Phase 0でdistを書き換えない。
- Phase 0の作業中は変更コミットを保留し、受入段階で計画・監査文書のみをcommitする。push、PR作成はしない。

## Review Focus

- 同じconversation IDでも別Chromeタブなら音声ミュートが別状態であり、共有音声設定の操作がその値を変えないこと。
- 既定出力とbackground／Offscreen出力のどちらも、SPA切替やミュート更新との競合時に古い許可で音を鳴らさないこと。
- 異なる会話IDのタブで表示状態・選択状態が混ざらず、同じ会話IDは再読込後に復元すること。
- SPAで会話IDが切り替わったとき、前会話の遅延ロード結果が新会話へ反映されないこと。
- Turn単位の終了イベントをスレッド単位に数え、同一スレッドの複数Turnを一件にまとめること。
- 確認済み状態と音声の成功／失敗／無効を分離し、同時確認や新規イベントとの競合で未確認数を失わないこと。
- 会話ID不明時に旧共有view stateや直前の会話状態を流用しないこと。

---

## 決定済みの画面と保存境界

### 画面

1. **通常:** ヘッダー、常時表示操作、タブ／プロンプトボタン、2つのBridge件数を表示する。
2. **Bridge詳細展開:** thread一覧、既存の監視登録／解除、終了通知確認のA→B→Cだけを扱う。
3. **最小化:** 既存の最小化／復帰操作を保ち、パネル本文を隠す。

Bridge詳細では現在の全診断値を常時展開しない。監視登録は現行の明示操作を使う。別サービス連携、実行中／要対応／新着の件数、MCPの新規APIは追加しない。

「全文／要約／翻訳／調べて」は現在、既定の指示タブにある挿入型ボタンで、クリック時に入力欄へ定型文を挿入する。Phase 2では配置を変更するが、別の生成APIや自動送信動作を作らない。

### 保存と移行

| 設定・状態 | スコープ | 保存領域と扱い |
|---|---|---|
| Options設定（カスタムボタン／タブ、表示順、回答完了音の共通有効化・音色・音量など） | 同一Chromeプロファイル内で共通 | `chrome.storage.local` の `chatPanelPlus.config`。パネルのミュート操作から変更しない。 |
| 回答完了音の出力デバイス | 同一Chromeプロファイル内で共通 | `chrome.storage.local` の `chatPanelPlus.answerCompletionOutputDevice`。Optionsで選んだ値を全ChatGPTタブで共有する。 |
| ユーザー音源asset | 同一Chromeプロファイル内で共通 | `chrome.storage.local` の `chatPanelPlus.answerCompletionSoundAssets`。 |
| **音声ミュート** | **ChromeタブID＋conversation ID別** | **`chrome.storage.session` にbackground経由で保存する。キーに送信元タブIDと検証済みconversation IDを含め、再読込後に同じタブ・会話の値を復元する。同じ会話を別Chromeタブで開いた場合も別状態にする。タブを閉じた際は当該タブの値を整理する。ミュート操作は共有設定や他タブのミュート値を書き換えない。** |
| selected tab、最小化、Bridge詳細展開、thread／終了通知の選択など、音声ミュート以外のパネルUI状態 | 既存計画どおりconversation ID別 | 会話別状態として保存する。同じ会話を複数タブで開く場合の共有は前計画の扱いを維持し、今回決定したタブ別音声ミュートとは分ける。 |
| Codex作業中モード | 既存どおりChromeタブID＋conversation ID別 | 現行 `chrome.storage.session` の保存・タブ終了時の整理を維持する。音声ミュートと別の状態として扱う。 |
| Bridge監視登録・終了イベント | 監視・検出・保存はプロファイル共通。表示・確認はconversation ID別 | 既存の`chrome.storage.local`watch/event台帳を維持する。watchには常に単一owner（信頼済みtab ID＋conversation ID）を持たせ、別conversationからの新たな開始で同一watchを原子的に後勝ち移管する。eventには作成時のowner conversation IDを不変snapshotとして保存する。owner別mute policyは現在のwatch owner tab＋conversationに適用する。owner欠損データは保持するが通常panelの一覧・件数から除外し、推測移行しない。 |

回答完了音の共通有効化・音色・音量は`chatPanelPlus.config`にあり、出力デバイスと音源assetも別の`chrome.storage.local`領域に保存される。これらは同一ChromeプロファイルのChatGPTタブ間で共有する。Optionsは共有設定を読み・保存する。

`Panel.tsx`の現在の回答完了音ON/OFFは共有設定`answerCompletionSoundEnabled`を更新する。これを会話別ミュートと呼び替えない。パネルでは共有有効化とタブ／会話別ミュートを別操作として扱い、実効可聴条件を「共有有効化がON かつ 現在のタブID＋会話IDのミュートがOFF」とする。どちらの操作も他方の保存値を上書きしない。

`conversationIdFromPath`を使う。ミュートはタブIDもキーに含むため、別会話タブだけでなく、同じ会話を別Chromeタブで開いた場合も独立する。音声ミュート以外のパネルUI状態の同一会話・複数タブ動作は別の判断として維持する。

conversation IDが不明な新規会話では、会話別UI状態やミュートを読み書きせず、共有値や直前の会話の値を流用しない。ID不明中に完了音イベントが発生した場合の再生可否は、誤音鳴りを避けるroute判定と合わせて実装前に確定する。

`chatPanelPlus.viewState`は旧共有状態として残し、新しい画面から読まず、変更・削除・会話別領域への自動コピーをしない。Bridge監視状態も既存の共有キーを維持する。Optionsの「既定値へ戻す」が現在view stateも初期化する挙動については、会話別状態を一括消去せず、既定設定保存と各会話の表示状態を分ける方向で受入確認する。
### Bridge件数と確認

- Aの一般Codex thread候補一覧は共通discoveryとしてよい。Bの監視watch一覧とCのevent一覧は現在のconversation IDにownerが一致する項目だけをbackgroundで絞って返す。同じ会話を開いた別tabには同じ一覧を返す。
- 「監視中 N件」は現在conversation IDがownerのwatch snapshot数とする。他会話watchやowner欠損watchの件数・存在は返さない。
- 「監視スレッドが終了した未確認 N件」は現在conversation IDにownerが一致する未確認Turn eventを一つ以上持つ `(connectionId, targetId, threadId)` の重複除外数。同一watchに複数Turnがあっても一件。別conversation IDのeventとowner欠損eventは含めない。
- 現在の終了イベントはTurn単位。イベント重複排除キーは `(connectionId, targetId, threadId, turnId)` である。
- event作成時にowner conversation ID（必要に応じorigin tabId／watch identity）を内部snapshotとして固定する。監視解除後もイベントownerを保持し、後日の別conversationからの再登録で過去eventを移し替えない。
- 現在のイベントにはユーザー確認状態がない。実装案は既存イベントへ確認時刻を追加し、未設定の既存イベントは確認の証拠がないため未確認として読む。
- `WATCH_LIST`と`WATCH_FOREGROUND_REFRESH`の両応答は一覧・summaryを返す前にbackgroundで送信元conversation IDを検証し、watch/event ownerでfilterする。`WATCH_READ`／`WATCH_STOP`もowner conversationを照合し、他会話のwatchを読んだり止めたりできないよう認可する。不一致時にwatchの有無や本文を推測できる応答を返さない。
- 確認操作は画面に表示した未確認event IDのsnapshotをbackgroundへ渡し、送信元conversation ownerに一致するeventだけを一回の保存変更で確認済みにする。他conversation event IDは拒否し、その未確認数を変えない。存在しないIDと他ownerのIDで拒否応答を区別せず、eventの有無を漏らさない。同一会話の複数tab間では冪等にし、新規eventとの確認raceも検証する。
- `WATCH_READ_FINAL_ANSWER`はeventIdで台帳を検索した後、event owner conversation IDと信頼済みsender conversation IDをbackgroundで照合する。不一致、owner欠損、conversation ID不明は拒否し、event有無を推測できる応答差も返さない。UIでのdisabled表示のみを認可に使わない。
- contentはSPA route変更時に選択event、取得済み本文、pending取得結果をクリア／破棄する。表示・copy・入力挿入前に現在routeとevent ownerを照合し、挿入先はowner会話を表示中の現在tab入力欄に限る。origin tabが前面である必要はない。
- 音声通知状態は再生結果のまま保持し、終了確認とは別項目にする。監視登録そのものは確認操作で解除しない。
- owner欠損の旧watch／eventは共有storage上で保持し、通常の会話別一覧・件数には含めない。ownerを自動推定しない。解除等の保守導線は他会話情報を漏らさない設定画面等で今後整理する。
- 既存イベント保存は最大128件に制限される。未確認スレッドの件数を維持するには、未確認イベントを通常の履歴上限で落とさず、確認済み履歴に上限を適用する案を実装時に検証する。

## 対象ファイルと依存関係

| 領域 | 主な対象 | 役割 |
|---|---|---|
| パネル画面／コア | `src/content/Panel.tsx`, `src/content/panel-view.ts`, `src/content/panel.css`; 必要なら新規 `src/content/panel-controller.ts` | 3画面と既存操作の配置、状態とDOM表示の分離 |
| 会話別状態／音声ミュート | `src/shared/settings-repository.ts`, `src/shared/conversation-route.ts`, `src/content/Panel.tsx`, `src/content/ConversationStatistics.tsx`, `src/content/conversation-statistics-controller.ts`, 音声出力route、background mute storage | UI stateとmuteのread/write／復元。ミュートはtab ID＋conversation ID別、他音声設定は共有。Codex work mode保存契約は維持。 |
| Bridge一覧・確認・最終回答／owner音声 | `src/content/CodexBridgeList.tsx`, `src/content/CodexBridgeWatchPanel.tsx`, `src/content/codexbridge-watch.css`, `src/shared/codexbridge-thread-monitor-protocol.ts`, `src/background/thread-monitor-storage.ts`, `src/background/thread-monitor.ts`, `src/background/codexbridge-thread-monitor.ts`, `src/background/codexbridge-notifications.ts`, background mute repository／handler、必要なら`src/background.ts` | conversation ownerを含むevent snapshot、一覧・summary・read・stop・確認のbackground access control、最終回答取得制限、SPA破棄、owner mute。MCP APIは変更しない。 |
| 既存設定・出力ボタン | `src/shared/default-ui.ts`, `src/content/panel-button-actions.ts`, `options/src/OptionsPage.tsx`, `options/src/options-state.ts` | 既存のボタン定義、Options保存／import／export、定型文挿入。Phase 0の確認範囲ではOptions全面改修は不要 |
| 回帰テスト | `tests/panel-view.test.ts`, `tests/settings-repository.test.ts`, `tests/default-ui.test.ts`, `tests/custom-buttons.test.ts`, `tests/custom-button-options.test.ts`, `tests/codexbridge-thread-monitor.test.ts`, `tests/codexbridge-terminal-events.test.ts`, `tests/codexbridge-watch-panel.test.mjs`, `tests/codexbridge-thread-monitor-handler.test.ts`; 必要に応じて新規のcontroller／summaryテスト | 保存境界、集約、確認競合、既存動作 |

正確な関数分割と新規テストファイル名はPhase 1の設計時に既存実装へ合わせる。`CodexWorkModeToggle`、`codex-work-mode-repository.ts`、`codex-work-mode-route.ts`の保存契約は変更対象にしない。

## 段階分割案

### Phase 0 — 調査と計画（本タスク）

- [x] 現行UI、状態保存、route、Bridgeイベント、Options経路、テスト・ビルド境界の必要範囲を監査する。
- [x] 本計画とPhase 0監査文書を作成する。
- [x] `pnpm typecheck`と`pnpm lint`が終了コード0。両コマンド後もdistに変更なし。
- [x] 最終差分、`git diff --check`、statusを確認する。

### Phase 1 — 画面とコアの分離、既存動作の基準化

- [ ] パネル表示コンポーネントと状態遷移／保存／外部呼び出しを分ける。既存の入力、タブ、最小化、音声設定、統計、Bridge操作の意味は保つ。
- [ ] 純粋な状態モデルと保存境界のテストを追加・更新する。
- [ ] ライブ `dist/` を保全したまま全テストがビルドできる隔離手順を整備する。新worktreeは作らない。
- [ ] 既存全テストを実行しPASSを確認する。既存機能の動作確認を行い、Chrome実機が必要で未実施ならNOT_RUNとして明記する。
- **受入ゲート:** 既存全テストPASS、既存機能の動作確認結果を記録。Chrome未確認をPASS扱いしない。

### Phase 2 — 3画面と操作配置

- [ ] 通常／Bridge詳細展開／最小化を実装し、初期幅とブレークポイントを固定する。
- [ ] ヘッダー、常時操作、タブ／プロンプト操作を配置する。
- [ ] 「全文／要約／翻訳／調べて」を再配置し、既存の入力挿入動作を保つ。
- [ ] 元画像に依存せず、実機Chromeで幅と読みやすさを調整する。

### Phase 3 — 会話別パネル状態と音声ミュート

- [ ] 音声ミュートをChromeタブID＋conversation ID別にbackground所有の`chrome.storage.session`へread/writeし、ページ再読込後に復元する。同じ会話を開いた別タブの値と分離する。
- [ ] ミュート操作を共有`answerCompletionSoundEnabled`、音量、音色、出力先、音源assetの保存から分離する。通常回答完了音の実効可聴は共有有効化ONかつ現在のtab/conversation mute OFF。
- [ ] 回答完了イベント時のconversation IDを捕捉し、SPA遷移後に別会話のミュート状態を誤適用しない。route非同期ロード、再読込、複数タブ、ミュート切替と再生要求の競合を確認する。
- [ ] 通常の回答完了音についてconversation ID不明時は会話別状態をread/writeしない。その場合の通常回答完了音の可否は未確定のまま残す。
- [ ] 旧共有view stateは残して無視し、自動移行しない。
- [ ] 既存Codex作業中モードのtabId＋conversationId session保存とタブ終了時整理を維持する。
- [ ] 会話別ミュートのread/write、同一タブ再読込復元、別タブ分離、共有音声設定との非干渉をテストする。
- [ ] backgroundのmute更新に合わせて該当するBridge watch ownerの最新mute snapshot/revisionも順序を保って更新し、通知音の再生直前判定とraceをテストする。

### Phase 4 — Bridge最小フロー、件数、登録元mute

- [ ] Aの一般Codex thread候補探索は共通のまま、Bのwatch一覧・Cの終了event一覧をowner conversation IDで分離する。同じ会話の複数tabでは一覧と件数を共有する。
- [ ] サマリーは2件数のみ。監視中数は現在会話ownerのwatch数、終了未確認数はその会話にownerが一致する未確認Turn eventを持つwatch identityの重複除外数とする。
- [ ] 既存イベント台帳に確認状態を追加し、MCP APIを増やさず既存background保存経路で更新する。
- [ ] 旧イベントの読み込み、重複Turn、複数タブの同時確認、新規イベントとの競合、128件履歴上限をテストする。
- [ ] 監視開始要求はChromeの信頼済みsender.tab.idと、/c/<ID>をsender.url／sender.tab.urlおよび要求conversation IDと照合した値でowner bindingを作る。不一致、欠落、SPA切替raceでは登録を拒否する。
- [ ] owner bindingと最新mute snapshot/revisionをwatch snapshotのowner情報として既存共有watch stateへ保存する。watch identityごとにownerは常に単一。同じconversation IDからの重複登録は冪等で既存watchを返す。別conversation IDから開始された登録はstorage.mutate内で同一watchを原子的に新ownerへ移管し、watchId・baseline・lastObservedTurnId等の監視状態を保持する。競合する移管は保存順の後勝ちとする。複数ownerは持たない。
- [ ] 既存owner欠損watchは監視とeventを維持し、UIに解除・再登録を案内する。owner不明の通知音はskipし、自動で割り当てない。
- [ ] Turn単位の終了eventと通知は生成元watchのownerに帰属させ、active tab／現在routeを参照しない。owner IDをログ・公開UI・MCP出力へ露出しない。
- [ ] Turn event作成時にowner conversation ID（必要ならorigin tabId／watch identity）を不変snapshotとして保存する。watch stop後やowner移管後も過去eventの所有会話を変えず、移管後に新規作成するeventだけ新ownerへ帰属させる。
- [ ] `WATCH_LIST`と`WATCH_FOREGROUND_REFRESH`はbackgroundでsender.url／sender.tab.urlからconversation IDを検証してからwatch、event、summaryをfilterする。`WATCH_READ`／`WATCH_STOP`もsender会話がownerと一致するwatchだけ許可し、不一致時はwatchの有無や他会話の内容を返さない。
- [ ] 通知確認はevent IDごとにowner conversationを検証し、要求元会話のeventだけを確認する。他会話のevent IDは拒否して件数を維持し、同一会話別tabの確認は冪等にする。
- [ ] `WATCH_READ_FINAL_ANSWER`はeventId検索後にevent ownerと信頼済みsender conversationを照合する。不一致、owner不明、conversation ID不明をbackgroundで拒否する。取得済み本文表示、copy、入力欄挿入もowner会話内だけ許可し、SPA route変更時に選択／本文／pending結果を破棄して挿入直前に再照合する。
- [ ] owner欠損legacy watch/eventは保存・監視を保つが通常の会話別panel一覧／件数に出さない。保守・解除は別会話情報を出さない設定画面等で将来整理し、ownerを推測しない。
- [ ] mute変更をbackgroundでserialにsession muteと該当owner watch snapshotへ反映する。tab終了後もwatchが続く間はowner bindingと最終既知muteを保持し、active tabへfallbackしない。
- [ ] Offscreen再生直前にownerの最新muteを確認する。音声は共有有効化ON・音量0超・owner mute OFFの場合だけ許可し、mute ON／ownerまたはmute不明は音声skip。event、未確認数、視覚通知は維持し、非同期mute参照と再生のraceをgeneration/revisionで防止する。
- [ ] 既存Chrome runtime messageと保存経路を拡張する。新規MCP APIは追加しない。
- [ ] 会話A/Bの一覧・件数・確認分離、同一会話別tabでの共有、watch stop後／別会話再登録後もevent owner不変、sender不正、eventId越権取得／stop拒否、確認と新規eventの競合、SPA中のread/copy/insert取消、legacy ownerless隔離をテストする。owner ID検証、owner mute ON/OFF／不明、タブ終了後とserial/generation再生raceも含める。

### Phase 5 — 実機受入と未検証シナリオ

- [ ] CPP UIからのCodexジョブ開始が実際に可能か確認する。
- [ ] CPP UIで最終回答本文が取得・表示されることを確認する。event owner会話と同じ会話を表示する別tabでは許可し、別会話／unknown ownerでは拒否する。本文の表示・copy・入力挿入とSPA切替中のcancelをChrome実機で確認し、本文完全性の未確認状態も表示する。
- [ ] Service Worker再起動、Chrome再読込、SPA遷移、Bridge切断／復旧、複数タブの復旧シナリオを確認する。
- Phase 0では上記を実行しない。既存コード上の最終回答取得・表示パスがあっても、Chrome実機受入済みとは扱わない。

## Phase 1受入試験案

1. 既存のbuild付き全テストを、ライブ `dist/` に触れない隔離手順で実行し全件PASSにする。
2. パネルのタブ選択、最小化／復帰、ボタン挿入、クリア、貼り付け、設定、カスタムボタン、統計、共有回答完了音ON/OFF、音量／音色／出力先／音源asset、既定／Offscreen出力経路、Bridge一覧／監視登録の既存動作を確認する。
3. 会話ID別状態を導入する場合は、別会話タブの独立、同一会話の再読込復元、SPA遷移切替、会話ID不明時の非保存、遅延ロード競合を確認する。
4. Codex作業中モードの保存がtabId＋conversationId単位のままで、パネル状態の変更から独立していることを確認する。
5. Phase 3で会話別muteのread/write、再読込復元、同一会話の別タブ分離、SPA切替、共有設定非干渉、既定／Offscreen再生raceを確認する。Bridgeはowner snapshot更新、Turn eventの元owner帰属、同一owner再登録／別ownerへの後勝ち移管／legacy owner欠損、owner mute OFF時のみ再生、mute ON／不明・タブ終了後の音声skip、視覚通知と件数維持をテストする。
6. 会話A/Bの一覧・件数・確認分離、同一会話別tabでの共有、watch stop後／別会話再登録後もevent owner不変、不正sender、eventId越権read／stop拒否、確認競合、新eventの保持、SPA中の取得／copy／挿入取消、legacy ownerless隔離を確認する。
7. Chrome実機未実施の項目はNOT_RUN、判定不能はUNKNOWNとして記録する。
