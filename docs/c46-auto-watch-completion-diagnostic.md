# C46 回答完了時の自動監視登録: 追加調査と次回受入

## 2026-11-24 08:09:15 JST 実機で確認された失敗

以下はユーザー提示のスクリーンショットと説明に基づく。今回のcheckoutからChromeやBridgeの状態を読み直したものではない。

- イベントは「検出」、Bridge候補取得は「OK・2件」、本文照合は「スキップ（dom-changed）」、監視登録は「未実行」だった。
- B監視は0件、自動登録はONだった。Bridge側では対象と対照の2件が`live/in_progress`だった。

候補取得成功の後、本文照合に入る前のguardが中断した位置まで特定できる。スクリーンショットから実際のmutation種別までは判定できないため、特定の属性・装飾変更が起きたとは記録しない。

## ソース調査と確定した原因

`createCompletedTurnDomGuard()` は`main`内を監視し、`mutationAffectsTurn()`がmutation targetを対象turn内と判定すると変更済みにしていた。回答turn内の`style`/`aria`など属性、回答本文外のボタン・toolbar・状態UIの追加、本文DOMの同一内容再描画も同じ扱いになる。候補取得後は本文を読む前に`guard.changed()`を確認するため、意味的な本文変更がない場合も`dom-changed`で照合を中断していた。08:09:15の「候補OK 2件 → dom-changed → 登録未実行」はこの分岐と一致する。

main直下など対象turn外の変更を除外する修正はcommit `12b82ea965180a940cb5d3c8785fa23380d8ac13`で済んでいる。今回の原因は、その後も残っていた「対象turn内部ならすべて変更扱い」の判定である。

修正ではMutationObserverのdirty判定に本文照合可否を委ねず、同じdocument/route/owner、main root、unique turnKeyと同一turn要素を再確認する。Bridge候補要求を先に開始し、本文はcontent内だけで一時snapshotする。Bridge候補応答後に対象assistant message IDと`complete`状態を各読み取りで再検証し、可視本文を読み直してsnapshotと比較する。短い1 taskの安定化後にも同じ内容であることを確認してからBridge候補IDと完全一致token照合し、照合後にもidentityと本文を再確認する。属性・装飾・非本文UI変更、同じmain内のturn再配置と同一semantic textの子要素再描画は通し、本文差分、assistant ID/state不一致、route/root/turn差し替えは拒否する。

本文のUUIDを候補として抽出しない。本文snapshotはcontent内の一時値で、background・診断・storage・ログには渡さない。

## 他の境界のレビュー

| 境界 | 現在のコード上の契約 | 残る可能性・次回の見分け方 |
|---|---|---|
| 回答完了tracker | 既存の統計MutationObserverがturn identityを読み、`AnswerCompletionTracker` がin-progressからcompleteへの遷移を通知する。音声通知とは別経路。 | 遷移前のin-progressを観測していない場合はイベント未検出となる。診断に `no-active-cycle` または `assistant-message-unavailable` が出る。 |
| 完了イベント購読 | 有効なconversation routeとイベントidentityを検査して同期listenerへ通知。Bの自動監視controlはeffectで購読する。 | 診断でイベント検出後、候補取得が未実行または待機中なら、この境界とruntime応答を確認する。 |
| Bridge候補取得 | content scriptのruntime messageをbackgroundが拡張ID、tab、frame 0、ChatGPT origin/routeで検証する。候補取得はowner・ON設定・connection・live executionを再確認する。 | 診断の候補取得失敗コードにowner・接続・runtime経路が出る。 |
| 回答本文取得 | 完了した対象turn/message IDに結び付いた可視assistant本文だけを読む。hidden領域やbutton/toolbarを除外し、本文内code要素の文字も読む。Bridge応答後にsemantic snapshotとの一致と短い安定性を確かめる。 | 本文差分やidentity不一致は`dom-changed`/`answer-not-confirmed`、候補不一致は`no-matching-ids`で理由を区別する。 |
| 監視登録 | backgroundがsender由来owner、owner tab、connection、最新live executionを再検証し、候補一致分だけ登録する。応答は新規登録件数を返す。 | 診断の登録件数と理由コード、既存B欄の状態を確認する。0件だけでbackground到達失敗とは断定しない。 |

## 診断表示とデータ範囲

B欄の「直近の回答完了時照合」を折りたたみ技術情報として表示する。完了イベントでのみ更新し、Bridge候補件数、本文一致件数、登録件数、allowlistした理由コード、発生時刻を含む。診断状態は表示中componentのメモリ内だけにあり、conversation/targetが変わると前の状態を隠して破棄する。

診断callback、ログ、storageへ回答本文、Bridge thread ID、turn ID、DOM、会話本文は渡さない。診断用pollやreload時の保存・復元も行わない。既存の手動監視、終端通知、owner/mute検査、C37回答処理、watch/event記録には変更を加えない。

## 次回の手動受入手順

1. 今回の `pnpm build` 完了後、ユーザーがChromeの登録済み `D:\weito\Documents\src\codexapp\ChatPanelPlus\dist` を再読み込みし、ChatGPTページをF5する。
2. 対象conversationのB欄で自動監視登録がON、対象マシンとownerが現在の会話であることを確認する。
3. A欄の手動更新を押さずに、Bridge側で対象と対照の2スレッドがlive/in_progressの状態にし、完了回答本文には対象IDだけを完全一致で含める。
4. B欄の「直近の回答完了時照合」を開き、候補2件・本文一致1件・監視登録1件、B監視が0から1件になること、対照候補が登録されないことを確認する。時刻、イベント、候補取得、本文照合、監視登録の画面を記録する。診断にはIDや回答本文は表示されない。
5. 結果を次のように分類する。
   - イベント未検出: trackerの完了遷移検出を調べる。
   - 候補取得失敗: 表示されたowner/runtime/connection理由を調べる。
   - 候補取得OK・本文照合スキップ: 表示されたDOMまたは本文理由を調べる。
   - 本文照合OK・登録0/失敗: backgroundのowner、最新live再確認、登録応答を調べる。
   - 登録件数が1以上: 対象回答とlive候補の一致登録が通った。

Chrome実機での今回の修正受入はまだ行っていない。A欄の手動更新後の件数は、自動更新判定に使用しない。

## 自動検証

- `pnpm test`: PASS、756/756 tests。コマンド内の全buildも成功。C46 bridge-first 16件、登録連携20件を含む。
- `pnpm typecheck`: PASS。
- `pnpm lint`: PASS。
- `pnpm check:size`: PASS、269 filesを検査。
- `pnpm build`: PASS、Options・Content Script・Service Worker・Offscreenをこのcheckoutの`dist/`へ生成。
- `git diff --check`: PASS。
- Chrome実機受入: `NOT_RUN`。Chrome GUI、Bridge、本番データの操作なし。
