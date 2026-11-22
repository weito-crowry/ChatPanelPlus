# Options V2 と保存データ管理

更新日: 2026-11-22

## 目的と画面構成

Optionsを目次付きの編集画面へ再構成する。広い画面では左に目次、右に選択中の設定だけを表示し、幅720px以下では目次を上段へ移す。URL hashでセクションを選び、ブラウザーの戻る・進むと hashchange に追従する。非選択セクションはDOMに保持したまま非表示にし、接続token入力、プロジェクト設定の未保存値、音声UIの状態をセクション移動で失わない。

目次は「パネル編集」「接続設定」「プロジェクト」「通知・音声」「データ管理」。パネル編集では常時表示または表示中のタブを選び、そのグループのボタンだけを編集する。タブの表示・名称・順序は別の一覧で管理し、既存の上下移動、ドラッグ、カスタムボタン追加・削除、色、定型文、操作種別、挿入位置を維持する。ドラフトは既存の共通設定保存経路を使い、タブ切替では破棄しない。

共通の保存操作は画面下部に追従する。接続先・音声有効化・音量などの既存設定と、session token、プロジェクト別フォルダ設定、音源、出力先の独立保存は従来の保存先を維持する。

## 保存データの閲覧

「保存データ」を開いたとき、または明示的に更新したときだけ、既知の `chrome.storage.local` キーを個別指定して読み込む。全キー取得や未知キー探索はしない。ページ表示は最大500レコード、1ページ50件。概算サイズは非機密の表示用要約から算出し、実保存サイズの厳密計測とは区別する。行の詳細は選択時のみ表示する。

| 保存領域 | 表示内容 | 更新時刻 |
| --- | --- | --- |
| `chatPanelPlus.config` | schemaと共通設定の概要 | 不明 |
| `chatPanelPlus.viewState` | 共有表示状態の概要 | 不明 |
| `chatPanelPlus.projectNames` | project IDと名称 | 不明 |
| `chatPanelPlus.projectFolderPatterns.v1` | project IDとパターン一覧 | 不明 |
| `chatPanelPlus.panelStateByConversation.v1` | 会話ID、選択タブ、最小化、Bridge展開状態 | 不明 |
| `chatPanelPlus.statistics` | 会話ID、ターン数、文字数集計 | 不明 |
| `chatPanelPlus.codexBridgeThreadMonitor.v1` | watch件数、検証済み終了eventの状態と `detectedAt` | 保存領域の更新時刻は不明。eventごとの検出日時だけ表示 |
| `chatPanelPlus.answerCompletionSoundAssets` | 音源ID、名称、形式、サイズ、再生時間 | 不明 |
| `chatPanelPlus.answerCompletionOutputDevice` | 既定/選択状態。device IDは末尾4文字以外を伏せる | 不明 |

JSON長は概算値である。音源のbase64本文はUI・詳細・ログに出さず、サイズメタデータから概算する。MCP tokenはsession storageの特定キーについて保存有無だけを表示し、値・長さを取得後にUI状態へ保持しない。ミュートやCodex作業中状態など他のsessionキーは読み出さない。壊れた既知データは「破損の可能性」として削除対象にしない。

日時が保存されていない会話状態、統計、名称、フォルダ設定の時刻は「不明」とする。Bridge終了eventはevent validatorを通り、`detectedAt`が日時として有効なものだけ90日以上の古い候補に表示する。日時なし・不正日時は候補に含めない。古いeventはこの画面から削除できない。watch登録は維持し、通知整理はパネルの既存「通知をクリア」操作へ案内する。

## 削除可能な記録と境界

削除対象は行チェック後に対象カテゴリ・ID・影響のプレビューを出し、さらに `window.confirm` で明示確認した場合だけ処理する。表示時から値が変化した対象、読込データが破損した対象、取得できない対象は削除せず競合またはエラーとして報告する。各削除は既存repositoryの同一storage key用Web Lockの下で比較してから同じkeyだけを書き戻し、同じkey内の他レコードを残す。

| 削除操作 | 影響 |
| --- | --- |
| 会話別パネル状態1件 | 指定会話の選択タブ・最小化・Bridge表示/選択状態だけを削除 |
| 会話統計1件 | 指定会話の保存済み統計だけを削除 |
| プロジェクト別フォルダ登録1件 | 指定project IDのパターン一覧だけを削除 |
| 保存済みプロジェクト名1件 | canonical project IDの名称だけを削除。曖昧な旧slug形式は削除対象にしない |

設定・共有view state、Bridge watch、過去event、音源とそのbase64、出力先、session token、未知keyは削除できない。Bridge watch/eventの履歴上限や削除は既存backgroundのatomic owner契約を使う別導線の範囲であり、Optionsから直接書き換えない。storage `onChanged` で既知キーの変更を検出すると一覧を古い状態として表示し、再読込まで削除を止める。

既存 `chatpanelplus-settings.json` はタブ・ボタン等の共通設定用で、全保存領域のバックアップではない。project folder patterns、MCP token、音源データを含まない。

## 受入記録

- 自動: 目次/URL選択、非表示中のstatefulセクション維持、グループ切替と既存ボタン編集契約、既知キー限定読み込み、secret/base64非表示、90日境界と日時なし除外、CAS競合、同一key内の他レコード保持、破損データ拒否、既存lock名の使用、初回/再読込失敗時の削除禁止と成功後の復帰を検証する。
- 実データ: FakeStorageだけで削除テストを行う。実ユーザーのChrome storageへ書き込まない。
- Chrome UI: `NOT_RUN`。Optionsの狭幅/広幅、hash戻る進む、タブ/ボタンドラフト、token・プロジェクト・音声状態のセクション移動、データ更新時のstale表示、確認取消、個別削除、保存データ詳細を確認する。
- 正式dist: 未ビルド・未配備。全テストは `dist` 除外のsource-onlyコピーで実行し、正式dist 11ファイルのSHA-256一覧が前後一致することを検証する。

## 実装・自動検証記録

- 2026-11-22: focused suite 27/27 PASS、隔離した全suite 620/620 PASS。`pnpm typecheck`、`pnpm lint`、`pnpm check:size`、`git diff --check` PASS。
- 全suiteは`dist/`を含まない一時ソースコピーで実行し、元の`node_modules`だけをjunctionで利用した。登録済みlive `dist/`は11ファイルの相対path・byte length・SHA-256が実行前後で一致した。
- 監視レコードの詳細はthread/targetと状態に限定し、接続ID・owner tab/conversation/muteの値は表示しない。保存サイズは安全な表示用要約からの概算であり、最大500件への表示制限があるカテゴリでは実保存容量より小さくなる場合がある。
- Chrome画面の広狭表示、キーボード操作、実storage上の読み取り・確認・削除は`NOT_RUN`。正式distへのビルド・配備は行っていない。

### refresh失敗時の削除停止修正

- 最新の保存データ読込が失敗した場合、一覧を古い状態として保持しつつ削除用snapshot・選択対象・プレビューを破棄する。初回失敗でも「読み込めなかったため削除不可」を明示し、読込中・stale状態では選択と削除を停止する。
- 新しい成功読込だけが削除を再開する。世代番号により、古い失敗応答がより新しい成功状態を上書きしない。`storage.onChanged`との競合では既存のstale判定を維持し、確認直後にも最新の削除許可を再確認する。
- focused tests 12/12 PASS（Options契約7件＋状態遷移5件）、隔離全suite 625/625 PASS、`pnpm typecheck`・`pnpm lint`・`pnpm check:size`・`git diff --check` PASS。
- 全suiteは`dist/`を除外した一時ソースコピーで実行。登録済みlive `dist/`は11/11ファイルの相対path・byte length・SHA-256が実行前後で一致。正式dist、Chrome、実ユーザーstorageは変更していない。
