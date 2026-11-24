# C46 回答完了時の自動監視登録: 現在DOM照合と受入記録

## 2026-11-24 実機観測記録

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

### 09:33:56 JST — 独立code段落で不一致

- 続く09:35:09試験と同じ対象IDを、Markdownバッククォート付きの独立code span段落に置いた回答。ユーザー報告ではBridge候補2件、本文照合`no-matching-ids`、登録未実行。
- この画面は失敗時の本文形状を示すが、実DOMを直接観測していないため、単独では抽出または境界判定のどちらが原因か確定しない。

### 09:35:09 JST — 正仕様の基本経路で初回PASS

- ユーザー提示スクリーンショット：回答完了イベント検出、Bridge候補取得OK・2件、本文照合OK・1件、監視登録OK・1件。回答本文の対象IDは全角括弧で囲われた平文、対照候補は非登録。
- B監視1件、対象表示「C46_診断上書き対策_明示対象のみ」、設定内件数1。正仕様による対象1件のみの自動登録を初めてPASSとして記録する。2026-11-23の旧全件探索仕様でのPASSは別扱いのまま。
- Aの実行中件数「2」の表示は確認されたが、手動操作なしに更新されたかは未確認。
- 対象終了後の終了通知と自動解除は、この観測では未確認。今回のPASSに含めない。

### 10:00:42〜10:07 JST — コード装飾付きIDの照合と終了後表示

- ユーザーが登録済みrepo直下`dist/`をChromeでreloadし、ChatGPTをF5した後の実機観測。回答完了検出は10:00:42 JST。Bridge候補OK・2件、コード装飾付き対象IDの本文照合OK・1件、監視登録OK・1件。対象だけがBへ登録され、対照候補は非登録だった。
- 登録前の表示はA実行中2、B監視1、設定内監視1、C通知0。自動登録は明示ON。これは現在の回答完了時照合仕様に対する基本正常経路のPASSを支持する。コード装飾の個別形式はユーザー観測の表現どおりに記録し、前後段落・表・コードブロック等すべての形式を通過したとは扱わない。
- Bridge実測では対照が10:04:34.514 JSTに正常終了、対象が10:05:00.631 JSTに正常終了し、実行中0。10:07頃の画面はA実行中0、B監視0、設定内監視0、C通知1。通知の検出時刻は10:05:09 JSTだった。
- 10:06:05 JSTの診断は候補0／`no-running-candidates`。対象終了後の診断として正常な値であり、照合失敗を意味しない。
- C通知の技術情報は折りたたまれていたため、通知identityと対象IDの直接照合はしていない。終端後に通知1件・監視0件となった通常経路の部分証拠として記録し、C45全項目のPASSには広げない。
- 音声、独立した手動更新の有無、厳密なpoll周期、別会話、worker復旧、異常系は未観測。結果はそれぞれ未確認のままとする。

## 本文抽出とID境界のコード調査

- `src/content/conversation-statistics-dom.ts`の共有`visibleText`は`cloneNode(true)`した要素から除外UIを消し、detached cloneの`innerText`を読んでいる。cloneはdocumentへ挿入されない。非レンダリング要素の`innerText`が`textContent`相当になるため、段落間の視覚的改行を失う経路がソース上にある。今回のChrome DOMを直接観測したわけではなく、実機での原因確定とは区別する。
- `src/content/codexbridge-auto-watch-completion.ts`の旧`TOKEN_CONTINUATION`はUnicode letters/numbersを含むため、ASCII Bridge IDの直後・直前に日本語文字があるとtoken境界を拒否する経路がある。
- 回帰テストでは、独立した`<p><code>ID</code></p>`と前後の日本語段落がfake DOMのdetached textで連結されることを再現した。自動監視専用抽出に実DOMタグ由来の段落、`br`、表セル、`pre`境界を加え、統計の共有`visibleText`とOUTPUT文字数は変更していない。ASCII候補IDは日本語文字に隣接しても照合する一方、ASCII識別子の部分一致・連結は引き続き拒否する。
- 現実装の回帰テストは、全角括弧、コードspan、Markdown表相当のtable DOM、コードブロック、`br`を扱う。別target prefix、URL内、ゼロ幅文字、hidden/toolbar、現在のassistant message以外の除外と、Bridge live候補のみを照合する契約も維持する。
- 09:33:56と09:35:09の実DOM/本文は未観測のため、コードで再現した抽出・境界の問題は有力な説明だが**当時の実機FAILの根本原因を確定したものではない**。10:00:42の後続実機ではコード装飾付き対象IDの照合1件が成功した。独立code spanと前後の日本語段落、表・コードブロック等の個別形式や拒否条件は未確認。

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
- 本文から候補IDを生成しない。Bridge候補に含まれたIDだけを完全一致tokenとして照合し、照合できたIDだけを登録要求に含める。ASCII候補IDは前後の日本語文字に隣接していても照合するが、ASCII識別子の部分一致・連結、異なるtarget prefix、URL内・埋込IDは拒否する。2候補中1候補だけの一致も維持する。
- イベント重複抑止、明示ON、手動監視のowner/auth、既存watch ownership、5秒/30秒監視、C45終端通知・自動解除、worker restoreの扱いは変更しない。ON中に全threadを周期探索・登録しない。Bridge照会より前に終わる短命threadは見逃してよい。
- 回答本文やDOMはbackground、診断、console、storageへ渡さない。backgroundへ送るのは既存の会話/turn/message識別情報、connection、現在本文に一致したBridge候補IDのみ。

## 診断とデータ範囲

B欄「直近の回答完了時照合」はイベント、候補件数、本文一致件数、登録件数、allowlist済み理由コード、時刻を表示する。現在DOMの一意turn不在は`turn-not-unique`、assistant ID/state/本文を確認できない場合は`answer-not-confirmed`、候補IDが本文にない場合は`no-matching-ids`、route不一致は`invalid-route`で表示する。診断を細分化したDOM属性・構造や識別値は記録しない。

診断stateはcomponentのメモリ内だけに置き、target/conversation切替時に前回分を隠して破棄する。完了イベント以外のpoll、console記録、storage保存、reload後の復元はしない。照合本文はcontent script内の一時値だけである。

## 次回の手動受入

1. 2026-11-24にユーザーがrepo直下`dist/`をreloadしChatGPTをF5済み。以後コードを含む新buildを受け入れる場合は、そのdistをユーザーが再度reload/F5してから行う。
2. 自動登録ON/OFF、音声OFF・mute・volume 0、手動watchを個別に確認する。自動登録判定が音声状態に依存しないこと、手動watchが既存動作を保つことは今回未観測。
3. 正仕様の平文・全角括弧は09:35:09、コード装飾付き対象IDは10:00:42に、それぞれ候補2件中の対象1件のみ照合・登録をPASS確認。独立code span段落の前後に日本語段落がある形、日本語隣接、Markdown表・コードブロックは個別に再確認する。
4. Bridge応答待ち中のmain/turn再描画・再配置や非ID部分の編集後も、現在の同一conversation、assistant message ID・complete、現在本文内の候補ID一致が保たれれば対象だけが登録されることを確認する。
5. assistant ID不一致/不明、未完了、曖昧duplicate turn、別会話route、owner/target/connection不一致、候補外ID、IDなし、partial/substring/URL内/埋込IDでは登録されないことを確認する。音声、手動watch、C45通知・自動解除を含む周辺動作も個別に確認する。

## 自動検証

- 回帰テストは、独立code段落と前後の日本語段落、`br`、表セル、`pre`、日本語隣接、ASCII連結ID拒否、統計OUTPUT文字数維持を確認する。
- `pnpm test`: PASS、764/764 tests。
- focused C46 Bridge-first/registration/current-DOM tests: PASS、39/39。
- `pnpm typecheck`: PASS。
- `pnpm lint`: PASS。
- `pnpm check:size`: PASS、270 files。
- `pnpm build`: PASS。repo直下`dist/`にOptions、Content Script、Service Worker、Offscreenを生成。
- `git diff --check`: PASS。
- 2026-11-24 09:35:09 JSTの平文・全角括弧ケース、および10:00:42 JSTのコード装飾付きIDケースで対象1件だけの照合・登録をユーザー報告によりPASS。後者では対象終了後にB/設定内監視0、C通知1を表示したが、通知identityの直接照合はしていない。
- 音声、手動更新の有無、厳密poll周期、別会話、worker復旧、独立code span前後段落・表/コードブロック・拒否系の個別受入は**NOT_RUN**。この文書更新ではChrome、DevTools、Bridge、既存watch/event/storageを操作していない。
