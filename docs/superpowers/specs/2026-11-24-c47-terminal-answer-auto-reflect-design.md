# C47 設計: 監視終了時の最終回答を下書きへ自動反映

日付: 2026-11-24
対象: メインパネル v2 / C47
状態: ユーザー提示仕様に基づく実装設計

## 目的

C45が新規terminal eventを永続化した直後、明示ONになっている登録元会話のChatGPT入力欄へ、C37で確定取得した最終回答を未送信の下書きとして末尾追記する。通常の空欄には回答本文をそのまま挿入し、既存本文には必要な改行を挟んで追記する。

## 既存経路

- `src/background/thread-monitor.ts` の `saveSuccess` は、storage mutationが新しいeventを作成した場合だけ通知処理へ進む。重複event・起動時restoreは新規event保存経路ではない。
- eventにはowner tab/conversation identityが保持される。`src/background/codexbridge-thread-monitor.ts` のC37 `CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER`は、sender会話、owner、target/thread、connection、event/turnを検証し、取得後にもconnectionと保存eventを再確認する。
- `src/content/editor/adapter.ts` の `insertAtCaret` は選択範囲を置換し得るため、自動反映には使用しない。既存のeditor検出、IME判定、検証済み `insertText` を再利用し、末尾専用関数からcollapsed end rangeを渡す。
- 会話別UI状態は `ConversationPanelStateRepository` で保存される。既存レコードへの追加booleanは欠落時falseとして読み、ストレージschemaを変えない。

## 採用する方式

1. 新しいterminal eventの保存が確定した後だけ、backgroundから保存済みeventの `eventId`、`ownerConversationId`、`detectedAt` を含むidentity-onlyメッセージを `ownerTabId` のcontent scriptへ送る。回答本文は送らない。owner tab/conversationが現在一致することを確認する。既存通知音・muteの成否とは独立させる。
2. 登録元タブのB欄に置く小さなON/OFF controlが、conversation stateを保存し、identityメッセージを受け取る。会話routeと設定が一致した新規通知のみを受理する。reload時に保存event一覧を走査・再送しない。受信したeventIdを重複抑止し、同一会話の処理は受信順で直列化する。
3. 回答本文は既存C37 requestを使って取得する。`retrieved` かつ `completeness: confirmed` の場合だけ挿入する。`pending` のみ最大2回まで短い待機を挟んで再取得し、それ以外の結果は自動挿入しない。C欄へ短い成功/未反映状態を出し、既存の手動取得・挿入を維持する。
4. C37応答後に現在route、会話別ON状態、editorの存在・編集可否・IME状態を確認する。末尾専用adapterは通常のChatGPT/ProseMirror入力経路を使い、現在の選択を挿入範囲に使わず、入力前の選択Rangeを復元する。既存本文や添付・複雑な非テキスト内容は保持し、編集不能・IME中・未対応の複雑内容は挿入しない。送信・Enter・send button・clipboard APIは使わない。
5. 自動反映の本文は既存C37応答として一時利用するだけで、別途storage・ログ・診断へ書かない。

## UIと設定

- C欄に「監視終了時に最終回答を入力欄へ自動反映」の独立したcheckboxを追加する。
- 初期値はOFF。会話単位に保存し、同じ会話のreload後も保持する。ONにした時刻も保持し、その時刻より前に保存されたeventの遅延配信を除外する。
- C46自動監視、通知mute、音声設定とは別の設定項目として扱う。
- 通知を受信した時点でOFFなら当該eventは処理済み扱いにし、後からONにしても遡及反映しない。
- パネルを最小化・詳細折りたたみしていてもcontent componentが存続する配置にする。

## 失敗時の扱い

- owner tab不在、会話route不一致、OFF、event重複、取得失敗/未確定、editor不在、編集不可、IME中、複雑content、挿入検証失敗は未反映状態を示し、自動送信はしない。
- 異なる会話・別tabへ送らない。backgroundが指定するownerTabIdだけに配信し、content側もownerConversationIdと現在routeを照合する。
- startup/worker restoreで既存eventを再送しない。C45の新規保存callback以外からauto-reflectを起動しない。

## 検証範囲

自動テストでは設定既定値/永続化、末尾追記と選択・添付保持、IME/編集不能/複雑content拒否、terminal新規保存後のowner限定dispatch、audio/mute独立、再送/重複抑止、route/設定/connection/event検証、pending有界retry、複数event直列順序、送信操作なし、既存C37/C45/C46回帰を確認する。Chrome実機はユーザーがbuild後に拡張reloadとChatGPT F5を行うまでNOT_RUNとする。
