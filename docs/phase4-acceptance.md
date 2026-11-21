# Phase 4 — Bridge監視の会話別所有・通知・認可

## 自動受入結果

- 状態: **自動検証PASS／dist配備待ち**。登録済みdist配備が成功したら自動受入を確定する。Chrome実機操作はPhase 5の統合チェックリストへ延期し、未実施項目をPASSとしていない。
- Phase 3の全テスト518件を基準に、Phase 4変更後は隔離コピーで全テスト527/527 PASS（9件追加）。Bridge関連の焦点テストは39/39 PASS。
- `pnpm typecheck`: PASS。`pnpm lint`: PASS（500行／32 KiB検査を含む）。`git diff --check`: PASS。
- 全テストは`dist/`を除いた一時ソースコピーで実行し、`node_modules`のみリンクした。実行前後で登録済みrepo直下`dist/`の11ファイルについて相対パス・サイズ・SHA-256が一致した。
- MCP APIを追加せず、既存Chrome runtime messageと共有watch/event保存形式を内部拡張した。
- 配備前記録。実装コミット後に、repo直下の登録済み`dist/`をバックアップ・全件ハッシュ照合してから`pnpm build`で更新し、配備結果をこの記録へ追記する。

## 変更した境界

- 監視開始時にbackgroundが信頼済みsenderのtab IDと検証済みconversation IDをownerとして記録する。同一watch identityのownerは単一・不変。別会話からの重複開始はowner conflict、owner変更は解除後の再登録とする。
- WATCH_LISTとWATCH_FOREGROUND_REFRESHの両方をbackgroundでowner会話に絞る。WATCH_READ、WATCH_STOP、WATCH_READ_FINAL_ANSWER、終了event ACKもsender会話を認証し、他会話のデータ・件数・存在を返さない。
- 終了eventは作成時のwatch owner identityをsnapshotする。watch解除、後日の別owner再登録、tab終了でも過去eventの帰属を変更しない。ownerの生IDはpanel表示に露出しない。
- 同一conversation IDの複数タブでは通知一覧と件数を共有する。最終回答の取得はevent ownerと要求sender会話が一致する場合だけ許可し、content側もroute変更中の選択・取得結果を破棄し、copy／入力欄挿入直前に再確認する。
- 件数は「監視中」と「監視スレッドが終了した未確認」の2種。後者はowner会話の未確認Turn eventを含む一意watch identity数。通知再生状態とユーザー確認状態は別に保持し、確認はevent ID単位で冪等に処理する。
- Bridge完了音は登録元tab＋会話の最新mute判定に従う。tab別session値がなくてもwatch/eventの最終既知muteを使い、ownerまたはmuteが不明なら音声をskipする。active tabへのfallbackはしない。共有音声有効化、音量、出力先の設定は維持する。
- ownerなしの旧watch/eventは共有保存を保つが、通常の会話別panel表示・件数から除外する。所有先を推測しない。旧watchの音声はskipし、UIから他会話情報を漏らさない。

## 保留・実機未確認

- event台帳の総保持数上限は未決定。未確認eventは件数を誤らせないため削除せず保持し、確認済み履歴は別枠で最新128件を保持する。未確認eventが128件以上あれば総数は128件を超える。より厳密な総保持方針は決めていない。
- Bridgeが返す最終回答本文の完全性は確認できない。UIは切詰め情報がない点を表示し、別のmessageを最終回答として推測しない。
- 通常回答完了音でconversation IDを取得できない場合の扱い、Optionsの「既定値に戻す」が会話別状態へ及ぼす範囲は引き続き未決定。
- Chromeでの実ジョブ開始、Bridge終了通知・実音声、実画面の会話分離、legacy ownerlessの運用保守、Service Worker／Bridge再起動、final-answer取得・copy・挿入、SPA raceは未実施。Phase 5チェックリストで**NOT_RUN**として確認する。

## Phase 4の主な自動テスト

- 会話A/Bの一覧・summary・ACK・read・stop・final-answer分離、sender URL不整合とownerless隔離。
- 同一会話の別tab共有、watch stop後も不変なevent owner、別owner再登録の衝突。
- 未確認eventが128件を超える場合の保持、確認済みeventの保持範囲、重複TurnとACK race。
- Bridge音のowner mute、owner不明時のskip、再生直前mute更新の直列化。
- SPA route変更中のwatch操作、final-answer取得・copy・入力欄挿入キャンセル。
