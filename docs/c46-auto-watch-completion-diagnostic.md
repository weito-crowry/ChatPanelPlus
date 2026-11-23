# C46 回答完了時の自動監視登録: 追加調査と次回受入

## 実機で確認された事実

以下はユーザー提示の画面・説明に基づく。今回のcheckoutから実機状態を再取得したものではない。

- A欄の2件は、ユーザーが「スレッド一覧を更新」ボタンを手動で押した後に表示された。自動更新の証拠にはしない。
- B欄の回答完了時自動監視登録は0件だった。
- Bridge側では対象 `01a20a77-f05a-71e1-bd3a-c90cf6ace7d5` と対照スレッドの2件が `live/in_progress` と確認されていた。
- 完了済みChatGPT回答本文には対象IDが書かれていた。
- ユーザーはChromeで `cfe2c00` を再読み込み済み。

受入対象は「回答完了 → Bridge実行中ID取得 → 当該回答本文との照合 → 一致IDだけ監視登録」。今回もこの失敗が起きたが、個々の境界を実機で計測していないため、原因は確定していない。

## ソース調査と確定した不具合

`createCompletedTurnDomGuard()` は `main` 全体の属性・子要素・文字変更を監視している。MutationObserver callbackは変更が完了turnに関係するかを確認するが、`changed()` が `takeRecords()` の戻り件数だけで `dom-changed` にしていた。そのため、Bridge候補待ちの間にChatGPT UIなどmain内の別要素が変わった場合も回答本文照合を中止し得る。

候補待ちにmain配下の無関係な属性・子要素・テキストレコードをキューイングする失敗テストを追加し、修正前は `dom-changed`、修正後は一致IDのみ `ready` になることを確認した。callbackと `takeRecords()` は同じturn関連判定を使う。turn本文変更、turnの移動・削除・同じkeyでの置換、main置換は引き続き拒否する。

このコード不具合は確認できたが、C46実機FAILで実際にこの経路が発生したかは未確認である。

## 他の境界のレビュー

| 境界 | 現在のコード上の契約 | 残る可能性・次回の見分け方 |
|---|---|---|
| 回答完了tracker | 既存の統計MutationObserverがturn identityを読み、`AnswerCompletionTracker` がin-progressからcompleteへの遷移を通知する。音声通知とは別経路。 | 遷移前のin-progressを観測していない場合はイベント未検出となる。診断に `no-active-cycle` または `assistant-message-unavailable` が出る。 |
| 完了イベント購読 | 有効なconversation routeとイベントidentityを検査して同期listenerへ通知。Bの自動監視controlはeffectで購読する。 | 診断でイベント検出後、候補取得が未実行または待機中なら、この境界とruntime応答を確認する。 |
| Bridge候補取得 | content scriptのruntime messageをbackgroundが拡張ID、tab、frame 0、ChatGPT origin/routeで検証する。候補取得はowner・ON設定・connection・live executionを再確認する。 | 診断の候補取得失敗コードにowner・接続・runtime経路が出る。 |
| 回答本文取得 | 候補応答後、対象turn/message IDに結び付いた完了assistant本文だけを読む。hidden領域やボタンは除外し、本文内code要素の文字も読む。 | `answer-not-confirmed`、`dom-changed`、`no-matching-ids` 等で理由を区別する。 |
| 監視登録 | backgroundがsender由来owner、owner tab、connection、最新live executionを再検証し、候補一致分だけ登録する。応答は新規登録件数を返す。 | 診断の登録件数と理由コード、既存B欄の状態を確認する。0件だけでbackground到達失敗とは断定しない。 |

## 診断表示とデータ範囲

B欄の「直近の回答完了時照合」を折りたたみ技術情報として表示する。完了イベントでのみ更新し、Bridge候補件数、本文一致件数、登録件数、allowlistした理由コード、発生時刻を含む。診断状態は表示中componentのメモリ内だけにあり、conversation/targetが変わると前の状態を隠して破棄する。

診断callback、ログ、storageへ回答本文、Bridge thread ID、turn ID、DOM、会話本文は渡さない。診断用pollやreload時の保存・復元も行わない。既存の手動監視、終端通知、owner/mute検査、C37回答処理、watch/event記録には変更を加えない。

## 次回の手動受入手順

1. 今回の `pnpm build` 完了後、ユーザーがChromeの登録済み `D:\weito\Documents\src\codexapp\ChatPanelPlus\dist` を再読み込みし、ChatGPTページをF5する。
2. 対象conversationのB欄で自動監視登録がON、対象マシンとownerが現在の会話であることを確認する。
3. A欄の手動更新を押さずに、Bridge側で対象と対照の2スレッドがlive/in_progressの状態で、完了回答に対象IDを含める。
4. B欄の「直近の回答完了時照合」を開き、時刻、イベント、候補取得、本文照合、監視登録の表示をスクリーンショットで共有する。診断にはIDや回答本文は表示されない。
5. 結果を次のように分類する。
   - イベント未検出: trackerの完了遷移検出を調べる。
   - 候補取得失敗: 表示されたowner/runtime/connection理由を調べる。
   - 候補取得OK・本文照合スキップ: 表示されたDOMまたは本文理由を調べる。
   - 本文照合OK・登録0/失敗: backgroundのowner、最新live再確認、登録応答を調べる。
   - 登録件数が1以上: 対象回答とlive候補の一致登録が通った。

Chrome実機での今回の修正受入はまだ行っていない。A欄の手動更新後の件数は、自動更新判定に使用しない。

## 自動検証

- `pnpm test`: PASS、753 tests。コマンド内の全buildも成功。
- `pnpm typecheck`: PASS。
- `pnpm lint`: PASS。
- `pnpm check:size`: PASS、269 filesを検査。
- `pnpm build`: PASS、Options・Content Script・Service Worker・Offscreenをこのcheckoutの`dist/`へ生成。
- `git diff --check`: PASS。commit前にstage-0を含め再確認する。
- Chrome実機受入: `NOT_RUN`。Chrome GUI、Bridge、本番データの操作なし。
