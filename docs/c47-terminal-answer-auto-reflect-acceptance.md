# C47 監視終了時の最終回答・自動下書き反映

日付: 2026-11-24
対象: メインパネル v2 / C47
実装commit: `12d1e6d861349663706bfe7f9a1e886740cd21c8`
実装状態: **実装・自動検証PASS**
Chrome実機受入: **主要正常系PASS（部分受入）／残項目NOT_RUN**

## 仕様と実装経路

- C45が新しいterminal eventを保存した時だけ、backgroundは `ownerTabId` へevent ID・owner会話ID・検出時刻だけを送る。回答本文は通知へ含めない。起動/worker restoreによる既存eventの再送はない。
- C欄の「監視終了時に最終回答を入力欄へ自動反映」は会話単位で保存され、既定OFF。ON時刻より前のeventも、遅れて配信されても処理しない。C46自動監視、音声通知、muteとは独立する。
- 登録元タブの会話routeとON状態が一致したeventだけC37 `CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER`で取得する。C37のowner/auth/target/connection/event/turn検証を利用し、`retrieved`かつ`confirmed`の本文だけを自動反映する。`pending`は250ms・500msの最大2回だけ再取得する。
- 末尾専用adapterは既存のeditor検出・IME状態・検証済み `insertText` を使う。空欄には本文だけを挿入し、既存下書きには必要な改行を挟んで末尾追記する。現在の選択範囲は挿入位置に使用せず、元の選択を復元する。添付等を含む複雑内容、IME中、入力欄なし/編集不可、route/設定変更では挿入しない。
- 自動経路は送信、Enter、送信ボタン操作、clipboard APIを呼ばない。成功時も下書きのまま。未反映時はC欄に理由を短く表示し、既存の手動取得・挿入を維持する。最終回答本文はC37応答の一時利用以外に保存・ログしない。
- C欄componentはBridge詳細折りたたみ・パネル最小化時もReact treeに残る既存配置で動作する。

## 自動検証

| 領域 | 確認する内容 | 結果 |
|---|---|---|
| event保存・dispatch | 新規event保存後だけownerへidentity-only配信。mute/通知不可と独立。restoreで再送しない。 | **PASS** — 保存後だけ通知すること、通知・muteからの独立、restoreでの再送なしを自動テストで確認。 |
| 会話設定・UI | 既定OFF、会話単位の保存/reload、ON時刻より前のevent排除、C欄control/status。 | **PASS** — 会話stateの既定値/再読込、ON時刻、C欄配置・statusを確認。 |
| 取得・順序 | OFF/重複/route変更/取得失敗を抑止。confirmed retrievedだけ反映。同一会話の複数eventを受信順に処理。pending retryは最大2回。 | **PASS** — 取得/挿入は一度だけ、同一会話内は受信順で直列、pendingは最大2回再試行。 |
| editor | 空欄のraw本文、既存下書きの末尾追記、選択範囲保持、添付保持、IME/複雑内容/入力欄なし拒否、送信操作なし。 | **PASS** — editor adapterの自動テストで確認。Chrome実機での選択/添付保持は未確認。 |
| C37/C45/C46回帰 | 既存C37 owner/connection/event検証、C45保存/自動解除、C46回答完了時のBridge-first登録。 | **PASS** — 全suiteに含まれる既存回帰を通過。 |

自動テストPASSはChrome実機受入を意味しない。Chrome reload/F5はユーザーが実施する。

## Chrome実機受入手順

### 準備

1. ユーザーが `D:\weito\Documents\src\codexapp\ChatPanelPlus\dist` の拡張を `chrome://extensions` で再読み込みし、ChatGPT会話をF5する。
2. 専用のテスト会話と、使用許可のあるBridge threadを用意する。既存watch/event/storageの実データを削除・書換えない。
3. C欄で自動反映が既定OFFであることを確認する。C46自動監視、音声通知、muteの状態は独立して確認する。

### 正常系・draft保持

1. 登録元会話でC47をONにする。空の入力欄の状態で手動watchを登録する。別の正常ケースでC46自動watch由来のeventも確認する。
2. watch対象の実行を完了させる。C通知が一件増え、C47最終回答が入力欄へ一度だけ末尾追加されることを確認する。送信されず、送信ボタンも押されないことを確認する。
3. 既存draftを入力し、その一部を選択して同じ正常系を行う。既存本文の後ろに必要な改行を挟んで追記され、本文と選択範囲が消去/置換されないことを確認する。
4. 同一会話を別Chrome tabでも開いてからeventを発生させ、登録元owner tabだけに反映されることを確認する。音声通知OFFと会話mute中でも自動反映が独立して動くことを確認する。
5. 複数watchをほぼ同時に完了し、C通知のevent順と入力欄への追加順が一致することを確認する。

### 非反映・手動fallback

1. OFFの会話で新eventを発生させ、入力欄が変化せずC欄に未反映状態が出ることを確認する。その後ONにしても過去eventは反映されないことを確認する。
2. event前にC47をONにした後で拡張reload/F5する。reload時に既存eventが再処理されず、その後に新規保存されたeventだけが対象になることを確認する。
3. eventの取得中に別会話へSPA遷移する。新しい会話の入力欄へ反映されないことを確認する。必要なら登録元会話へ戻り、既存のC欄手動取得を使う。
4. IME変換中、入力欄なし/編集不可、添付ありの場合は自動挿入されず、C欄に理由が出ることを確認する。C欄からの手動取得・手動挿入は引き続き利用できる。
5. pending/no-final-answer/incomplete/failed、event削除/接続変更では自動挿入されないことを確認する。C欄の手動取得結果を確認する。
6. 終了前にowner tabを別会話へ切り替えた場合、その別会話へ反映されないことを確認する。event ownerと通知が表示される会話の扱いはC45/C20のowner規則に従う。

## Chrome実機受入結果（2026-11-24 JST）

- ユーザー報告では、登録済みのrepo直下`dist/`をreloadし、ChatGPTをF5した。
- 初回はC47をONにし忘れたため再試験した。再試験ではC47をONにした。OFFのまま入力欄が不変であることの独立観測は報告されておらず、OFF受入は`NOT_RUN`。
- 11:23:51.223のBridge live記録で正常終了を確認。空欄へ自動反映された2行の最終回答をユーザーが送信し、送信本文はBridge最終回答と完全一致した。自動反映直後のDOMと、手動送信前の未送信状態を独立観測した記録はない。
- 11:47:22.660、11:47:46.942の2件のBridge正常終了後、ユーザー報告では未送信の既存手入力文を保持し、異なる2つの検証マーカーを各1回、改行区切りで末尾へ順次追記した状態を送信した。当該試験で重複はなかった。
- 以上から、空欄への自動反映、既存下書き保持、順次複数反映、本文一致、当該試験での重複なしを主要正常系`PASS`とする。実際の会話ID、回答本文、thread IDは記録しない。
- watchの起点（手動／C46自動）、選択範囲保持、ほぼ同時終了の競合、手動watch経路、OFF・過去event、別tab/別会話/SPA、mute/音声OFF、IME/添付、取得失敗・手動fallback等は未観測で`NOT_RUN`。

## 結果記録

| 項目 | 結果 | 証跡/メモ |
|---|---|---|
| 自動テスト・typecheck・lint・size・build・diff check | **PASS** | `pnpm test` 784/784、`pnpm typecheck`、`pnpm lint`、`pnpm check:size`（278 files）、`pnpm build`、`git diff --check` がすべて成功。build先は登録済みロード元のrepo直下`dist/`。 |
| Chrome reload/F5・空欄への自動反映・本文一致 | **PASS（ユーザー報告）** | 登録済みrepo直下`dist/`をreloadしChatGPTをF5。11:23:51.223の正常終了後、空欄へ自動反映された2行の回答をユーザーが送信し、Bridge最終回答と完全一致。送信前DOM／未送信状態の独立観測はなし。 |
| 既存下書き・順次複数反映・当該試験での重複なし | **PASS（ユーザー報告）** | 11:47:22.660、11:47:46.942の正常終了後、未送信の手入力文末尾へ異なる検証マーカーを各1回、改行区切りで順次追記した内容をユーザーが送信。本文・会話ID・thread IDは記録しない。 |
| OFF・過去event | **NOT_RUN** | 初回はC47をONにし忘れて再試験した。OFF時の入力不変、ON前event、reload後の再処理なしは独立観測なし。 |
| 選択範囲・watch起点・近接/同時完了・owner tab/別会話/SPA | **NOT_RUN** | 手動watchとC46自動watchの起点差、選択範囲復元、競合順序、owner/route分離は未観測。 |
| audio OFF/mute・IME・添付・入力欄不可・C37取得失敗/手動fallback | **NOT_RUN** | 独立性と非反映時の各状態は未観測。 |
