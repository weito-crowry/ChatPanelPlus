# Codex作業中モード

- 文書ID: CPP-DESIGN-14
- 状態: 実装済み（自動検証済み・Chrome実機確認待ち）
- 改訂日: 2026-10-23
- 依存: `00-architecture.md`、`05-settings-storage.md`、`06-options-page.md`、`08-lifecycle.md`、`09-testing.md`、`13-answer-completion-sound.md`
- 目的: ChatPanelPlus上で、ユーザーが手動で設定した「Codex作業中」状態を明確に表示・切り替え・保持する。

## 1. 機能の位置づけと状態の範囲

Codex作業中モードはCodexの実稼働状態を検知せず、ユーザーが手動で切り替える表示モードである。ONは利用者が手動表示を指定したことだけを意味し、Codexのプロセス、スレッド、ジョブの状態を保証しない。

状態は**ChromeタブIDとChatGPT会話IDの組**ごとに独立する。同じタブで会話間を移動すると、各会話の値を個別に復元する。同じ会話URLを別タブで開いても別状態になり、開いた直後はOFFとなる。

| 項目 | 設計 |
| --- | --- |
| 切替 | ChatPanelPlusパネル内の手動ON/OFFのみ |
| 状態キー | ブラウザーが送信元として付与する`sender.tab.id`と`/c/{id}`の会話ID |
| 保存先 | Background Service Workerだけがアクセスする`chrome.storage.session` |
| 保存期間 | Service Workerの停止・再起動中も保持。ブラウザー終了、拡張機能の更新・無効化・再読み込みではChromeのsession寿命に従い消去 |
| タブ終了 | `tabs.onRemoved`で該当タブIDの状態だけを削除 |
| 新しい会話 | 会話ID未確定中は状態を表示せず、切替を無効にする。会話IDの確定後にその状態を読む |
| 設定・統計・回答完了音 | 既存の保存先と処理に影響させない |
| Codex連携 | 実稼働の読取・通信・自動検知を行わない |
| Manifest権限 | `clipboardRead`と`storage`を維持し、`tabs`などの権限を追加しない |

旧`chrome.storage.local`キー`chatPanelPlus.codexWorkMode`はlegacyデータとしてそのまま残す。新実装はこの値を読み込まず、コピー、移行、削除、上書きを行わない。

## 2. UI・操作仕様

### 2.1 展開時と最小化時

- パネル内の手動切替ボタンは1つとし、現在値をON/OFFの文字で示す。色だけで状態を区別しない。
- ボタンは`aria-pressed`で現在値を公開し、「手動表示」であることを説明する。
- 最小化中も確認・切替できる既存のコンパクト表示を保つ。最小化・復帰操作とは別のボタンとして動作する。
- 会話IDが確定していない間は「利用不可」と表示し、ON/OFFの値は示さない。
- Composer、送信、入力中の文章への操作を追加しない。

### 2.2 読込・保存・失敗

- 読込中はON/OFFを表示せず、切替を無効にする。
- 保存中の連打を受け付けず、保存が完了してから表示を更新する。
- 不正データ、読み書き失敗、未知バージョンでは状態不明として扱う。不正値を自動でOFFに上書きしない。
- 既存UIの再試行と明示的な「OFFで初期化」の導線を維持する。
- 保存中に会話が変わった場合、旧会話への結果を新しい会話の表示に反映しない。書込みは開始時の会話IDに限定する。

## 3. 保存データとBackground API

### 3.1 session storage

`chrome.storage.session`には、次の形式の値を`chatPanelPlus.codexWorkMode.session.v1:{tabId}.{conversationId}`キーに保存する。

```json
{
  "schemaVersion": 1,
  "enabled": true
}
```

- 未保存キーはOFFとして読み、OFF値を自動保存しない。
- `schemaVersion`は数値の`1`、`enabled`はbooleanのみを受け付ける。
- 不正値は元の値を維持したまま状態不明を返す。
- `storage.session`は既定でContent Scriptへ公開されない。`setAccessLevel`で公開しない。
- タブ終了イベントは該当するタブIDのprefixに一致するキーだけを削除する。タブIDの取得や生成をContent Scriptに任せない。

### 3.2 メッセージと検証

Content ScriptからBackgroundへ送る限定メッセージ:

- `GET_CODEX_WORK_MODE`: `conversationId`を指定して状態を取得する。
- `SET_CODEX_WORK_MODE`: `conversationId`とbooleanの`enabled`を指定して保存する。
- Backgroundから同じタブ内へ送る`CODEX_WORK_MODE_UPDATED`は、同一Content Scriptの重複起動時の表示整合に使う。

Backgroundは`chrome.runtime.onMessage`の`sender.id`、メインフレームの`sender.frameId`、ブラウザー提供の`sender.tab.id`、ChatGPT origin、会話ID形式を検証する。`sender.url`のpathnameはSPA遷移直後に古い場合があるため、会話IDとのpath一致判定には使わない。保存キーのタブスコープは常に`sender.tab.id`で決める。

非同期応答では対象メッセージだけ`return true`を返し、既存の`OPEN_OPTIONS`処理を保つ。Content Scriptは`chrome.runtime.sendMessage`を使い、`storage.session`を直接参照しない。タブ内の更新通知は送信元のタブIDにだけ送るため、別タブへ同期しない。

## 4. SPA遷移とライフサイクル

- 統計機能で使っている`conversationIdFromPath`を共有route moduleへ移し、両機能で同じ`/c/{id}`判定を使う。
- Codexモードは`popstate`と`pageshow`を即時に処理し、250ms間隔のpathname確認で`pushState`による会話リンク遷移も検出する。
- history APIの差し替えや、新しいdocument-wide `MutationObserver`は追加しない。既存の統計route監視は変更しない。
- route変更ごとに読込世代を更新する。旧会話から遅れて返る読込・保存・通知は現在の状態へ反映しない。
- Reactのアンマウント時にroute監視、runtime購読、タイマーを解除する。再マウントやF5では同じタブID・会話IDからsession状態を読み直す。
- Chromeタブ複製は新しいタブIDを持つため、元タブのON状態を引き継がない。

## 5. 他機能との境界

- `chatPanelPlus.config`、`chatPanelPlus.viewState`、`chatPanelPlus.statistics`、設定JSON、回答完了音の状態は変更しない。
- 会話統計の保存・再計測、Composer操作、定型文ボタン、貼り付け、送信処理には接続しない。
- 新規権限、外部通信、Codex稼働検出を追加しない。

## 6. 自動テストとChrome実機確認

自動テストでは次を確認する。

1. 同じタブで会話IDごとの値を分離し、戻った会話の状態を復元する。
2. 同じ会話IDでも異なるsender.tab.idでは初期OFFとする。
3. Content Scriptの再生成、状態読込遅延、保存中の遷移後に旧結果を現在画面へ反映しない。
4. `/`などID未確定時はOFFを読み出さず、ON操作を保存しない。会話ID確定後に読込する。
5. `popstate`、`pageshow`、pathname pollingが同一Conversation ID抽出関数と連携し、`pushState`等の遷移を検出する。
6. タブ終了では対象タブのsessionキーだけを削除する。
7. 不正保存値・読み書き失敗で元データを保ち、明示初期化以外に上書きしない。
8. 同一タブ内の更新通知、異なる会話IDの通知除外、購読解除、連打時の単一保存を確認する。
9. legacyキー、設定、統計、回答完了音へのアクセスや移行がないことを動作テストで確認する。
10. `pnpm typecheck`、`pnpm lint`、`pnpm check:size`、`pnpm test`、`pnpm build`を実行する。

Chrome実機では次を確認する。自動テストとビルドだけでChromeの実挙動を確認済みとは扱わない。

- タブAで会話①をONにし、同タブで会話②へ移動してOFF、①へ戻るとONに戻る。
- タブBで①を開くとOFFで、Bの切替がAへ影響しない。
- F5、パネルの最小化／再マウント、Service Workerの停止・再起動で同じ会話の値を復元する。
- Aを閉じ同じURLを新規タブCで開くとOFF。タブ複製もOFF。ブラウザー再起動ではsession寿命に従って消去される。
- 新規チャットから会話ID確定までモード値を表示せず、確定後に対応状態を読む。
- Back/Forward、会話リンク遷移、保存中遷移で別会話の状態が混ざらない。
- 不正値、保存失敗、手動初期化、回答完了音と既存設定の独立性を確認する。

## 7. 実装記録

- `src/background/codex-work-mode.ts`: `sender.tab.id`と会話IDに紐付くsession保存、送信元検証、タブ終了時の整理、タブ内更新通知。
- `src/shared/codex-work-mode-repository.ts`: Background message経由の読書き、応答検証、購読解除。
- `src/shared/conversation-route.ts`: 統計とCodexモードで共有する会話ID抽出。
- `src/content/codex-work-mode-route.ts`: popstate/pageshowとpathname pollingによるroute監視。
- `src/content/codex-work-mode-controller.ts`: routeごとの読込、世代管理、保存中遷移、手動初期化。
- `src/content/CodexWorkModeToggle.tsx`: 同じUIのまま会話ID未確定中の利用不可表示を追加。
- Manifest permissionsは`["clipboardRead", "storage"]`のまま。
- 旧`chatPanelPlus.codexWorkMode`は読み書き・削除・移行しない。

### 自動検証結果（2026-10-23）

- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm check:size`: PASS（115ファイル、各500行・32KiB以内）
- `pnpm test`: PASS（327 tests、失敗0。拡張全体のbuildを含む）
- `pnpm build`: PASS（Options、Content Script、Background Service Worker）
- Chrome実機のタブ間・SPA挙動: 未確認

### Chrome実機確認待ち

上記のタブ分離、会話間の復元、F5、最小化・再マウント、Service Worker lifecycle、タブ複製、ブラウザー終了、SPAリンク／Back/Forwardと保存エラーの挙動。
