# C50 設計: 最終回答自動反映の共通テンプレート

Issue: #22 — Codex監視終了時のC47最終回答自動反映に、Optionsから編集できる共通メッセージテンプレートを追加する。

## 目的・受入範囲

- C47の明示ON、会話owner、確定済み最終回答取得、末尾追記を維持し、固定文と最終回答を一つの未送信下書きとして反映する。
- 正式トークンは `##Codex最終回答##`。既定値はこのトークン単独とし、未設定・旧schema 1設定も同じ既定値へ正規化する。
- テンプレートにはトークンが1個以上必要。欠落、型不正、上限超過は保存・JSON import時に拒否し、固定文だけで成功させない。
- 置換は全トークンを一度だけ文字列として処理する。回答本文中の同名トークンや`$&` / `$1`等は再評価しない。改行・Markdown・空白・記号を正規化しない。
- Optionsに複数行編集、トークン説明、サンプルプレビュー、既定値へ戻す操作を置く。復元は通常のドラフト保存経路を使う。
- C50の実機受入項目を追加する。未受入は `NOT_RUN` とし、C48/C49の既存観測は変更しない。

## 現状と境界

- 共通設定はschema version 1の `ExtensionSettings`、`SettingsRepository`、Optionsのドラフト保存、JSON serialize/parse/import、`resetSettingsPreservingCustomButtons`を通る。
- C47の `CodexBridgeTerminalAnswerAutoReflector` は新規eventを会話単位に直列処理し、C37の `retrieved + confirmed` 応答だけを `appendTextAtEnd` へ渡す。手動取得・copy・挿入は `CodexBridgeNotificationCard` の既存経路である。
- 会話別ON/OFF・有効化時刻、owner/route guard、重複抑止、下書き保護、送信しないことは維持する。新しい送信・承認操作や会話別テンプレート保存は追加しない。

## 設計判断

1. **保存先**：テンプレートを共通 `ExtensionSettings` に追加し、schema version 1のまま欠落値を既定値に正規化する。既存の保存・競合・import/export/reset経路を広げ、別storage keyやC47会話stateには置かない。
2. **サイズ上限**：テンプレート文字列は8,192 UTF-16 code unitsまでとする。既存C37回答上限256 Ki code unitsに対して設定値を小さく保ち、個人用固定文を十分に記述できる範囲とする。trim、Unicode正規化、改行変換は行わない。
3. **置換**：専用pure helperで `split(token).join(answer)` 相当の一回走査を行う。正規表現や置換文字列構文を使わないため、回答内のtokenと`$`列は文字どおり保持する。
4. **実行時設定の時点**：event受信時の値を後で使い回さず、確定回答取得と既存eligibility確認の後、挿入直前に `SettingsRepository.loadSettings()` を一度呼ぶ。その結果がschema検証済みの設定snapshotで、templateをrenderした後に同じ同期処理内でappendする。queue待ち・回答取得中にOptionsで保存された変更は、そのeventが挿入される時点で読み込まれた値に反映する。
5. **失敗**：保存設定のload失敗・破損・template不正は `template-unavailable` として可視表示し、下書きを変更しない。旧設定でtemplate field自体がない場合は validator が既定値へ正規化し、既存の回答単独反映を保つ。
6. **Options**：既存のhash navigationへ「自動反映」sectionを追加する。編集欄は設定全体の通常ドラフト保存を使い、プレビューは固定の例文だけを使用する。

## 検討した方式

- **共通設定 + 挿入直前snapshot（採用）**：既存repositoryの競合検出、保存、import/export/resetを活用し、queueや取得中に更新された値を次の挿入へ反映する。
- **会話別stateまたはevent受信時snapshot**：既存C47状態へ設定面を増やし、受信後のOptions変更が反映されない。今回の共通テンプレート要件と既存保存分離に合わないため採用しない。

## 非目標

- C47の自動反映ON/OFF、イベント再送、最終回答取得、owner検証、末尾appendの仕様変更。
- 自動送信、Enter、送信ボタン、承認操作、回答本文の追加永続化・ログ化。
- C48/C49受入結果の更新、Chrome自動reload、Bridge実機操作。
