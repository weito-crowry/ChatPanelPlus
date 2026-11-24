# C46 回答完了時の自動監視登録: 現在DOM照合と受入記録

## 2026-11-24 実機FAIL記録

次の観測はユーザー提示の実機診断に基づく。こちらからChrome、DevTools、ページDOM、Bridgeへアクセスして再確認した結果ではない。

### 08:46:31 JST — B診断

- イベント: 検出
- Bridge候補取得: OK・2件
- 本文照合: スキップ（`dom-changed`）
- 監視登録: 未実行。B監視は0件で、自動登録はON
- 回答には対象thread IDが記載されていた。対照IDは診断に記録されていない
- **原因未特定**。表示された`dom-changed`だけでは、判定時のDOMがどのように変わったか、または本文比較のどの時点で止まったかは分からない

### 08:09:15 JST — 先行する実機FAIL

先行画面にもイベント検出、Bridge候補OK・2件、`dom-changed`、登録未実行が表示された。これは別時刻の観測として残し、08:46の根本原因を証明する材料にはしない。

08:46時点のsource `9c3ff2343122fb486e264c82ea9edc303781273e` では、Bridge応答後のDOM guard、開始時snapshotとの本文比較、0ms経過後のguard/本文比較、照合後のguard/本文比較がすべて`dom-changed`へ集約されていた。画面からは最初に失敗した枝を特定できず、実DOMも直接観測していない。**ソース上の候補枝は列挙できるが、今回の原因は未特定**とする。

## 現在の登録契約

2026-11-24のユーザー承認に基づき、登録要求を作る時点の現在値で次の条件を確認する。

1. 現在routeのChatGPT会話ID、イベントの会話ID、watch ownerの会話IDが同一で、targetも現在の実行コンテキストと一致する。
2. 現在DOMでイベントのturnを一意に再特定でき、そのassistant message IDがイベント対象と一致し、assistant状態が`complete`である。
3. その時点の可視assistant本文に、Bridge `running_only=true`応答の候補IDと完全一致するtokenが含まれる。

処理順は回答完了イベント、Bridgeのrunning候補取得、応答後の現在DOM/本文照合、一致候補だけをcontent scriptから登録要求へ渡す順を保つ。登録要求直前にも現在route、turn/message identity、complete状態、可視本文を読み直し、Bridge候補IDとの一致を再計算する。backgroundは従来どおりsender、owner、target、connection、最新live状態を再確認する。

登録可否に使っていたBridge要求開始時の`main`/turn HTMLElement参照、時点間の本文snapshot完全一致、0ms安定化wait、後続読み取りとの本文完全一致条件は外した。Bridge待ち中にmain/turnが描画差し替え・再配置されても、現在DOMから対象turnを一意に再特定でき、上記3条件を満たせば照合する。本文の非ID部分や装飾が変わっても、現在本文に候補IDが残っていれば照合する。

## 維持する拒否条件と範囲

- 会話route/owner/target/connectionが一致しない場合は登録しない。別会話へのSPA遷移も拒否する。
- turn keyが現在DOM内で一意でない、assistant message IDが不明・不一致、assistantが未完了、または現在本文に候補IDがない場合は登録しない。
- 本文から候補IDを生成しない。Bridge候補に含まれたIDだけを既存のtoken境界・URL内・埋込ID判定で照合し、照合できたIDだけを登録要求に含める。2候補中1候補だけの一致も維持する。
- イベント重複抑止、明示ON、手動監視のowner/auth、既存watch ownership、5秒/30秒監視、C45終端通知・自動解除、worker restoreの扱いは変更しない。ON中に全threadを周期探索・登録しない。Bridge照会より前に終わる短命threadは見逃してよい。
- 回答本文やDOMはbackground、診断、console、storageへ渡さない。backgroundへ送るのは既存の会話/turn/message識別情報、connection、現在本文に一致したBridge候補IDのみ。

## 診断とデータ範囲

B欄「直近の回答完了時照合」はイベント、候補件数、本文一致件数、登録件数、allowlist済み理由コード、時刻を表示する。現在DOMの一意turn不在は`turn-not-unique`、assistant ID/state/本文を確認できない場合は`answer-not-confirmed`、候補IDが本文にない場合は`no-matching-ids`、route不一致は`invalid-route`で表示する。診断を細分化したDOM属性・構造や識別値は記録しない。

診断stateはcomponentのメモリ内だけに置き、target/conversation切替時に前回分を隠して破棄する。完了イベント以外のpoll、console記録、storage保存、reload後の復元はしない。照合本文はcontent script内の一時値だけである。

## 次回の手動受入

1. `pnpm build`で生成したrepo直下`D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`をユーザーがChromeで再読み込みし、対象ChatGPTページをF5する。
2. 専用会話/targetで自動登録をONにする。回答完了前に登録がなく、Bridge候補取得が回答完了後に一度行われることを確認する。
3. Bridgeにlive候補を2件用意し、完了したassistant本文には一方のIDだけを完全一致tokenとして含める。回答に同じturn ID/過去turn IDだけを置く条件も別に試す。
4. Bridge応答待ち中のmain/turn再描画・再配置、また非ID部分の編集があっても、現在の同一conversation、同assistant message ID・complete、現在本文内の候補ID一致が保たれていれば対象だけが登録されることを確認する。
5. 現在のassistant ID不一致/不明、未完了、曖昧duplicate turn、別会話route、owner/target/connection不一致、候補外ID、IDなし、partial/substring/URL内/埋込IDでは登録されないことを確認する。音声状態、手動watch、C45通知・自動解除も従来どおりであることを確認する。

## 自動検証

- `pnpm test`: PASS、761/761 tests。新規current-DOM系5件を含む。
- focused C46 Bridge-first/registration/current-DOM tests: PASS、41/41。
- `pnpm typecheck`: PASS。
- `pnpm lint`: PASS。
- `pnpm check:size`: PASS、270 files。
- `pnpm build`: PASS。repo直下`dist/`にOptions、Content Script、Service Worker、Offscreenを生成。
- `git diff --check`: PASS。
- Chrome実機受入は**NOT_RUN**。Chrome reload/F5、Browser/DevTools操作、本番Bridge操作、既存watch/event/storage変更は行っていない。
