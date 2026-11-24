# C47 実装計画: 最終回答の下書き自動反映

## 目標と構成

C45で新規保存されたterminal eventだけを起点に、明示ONのowner会話へC37確定最終回答を未送信のまま末尾追記する。identity-only background message、会話別storage設定、C欄control、C37既存取得API、末尾専用editor adapterを使う。詳細仕様は `docs/superpowers/specs/2026-11-24-c47-terminal-answer-auto-reflect-design.md`。

## 全体制約

- 実装・テスト・文書はこのcheckout内で行い、C46 doc-only commit `99defc201541b160b9feb267fd8b18618ac11296` の後にC47を別commitにする。
- C46動作を変えず、新規保存後のowner tab identity dispatchだけをC45へ追加する。restore時の再送、本文の永続化/ログ、送信、Enter、clipboardは追加しない。
- `insertAtCaret`を自動反映に使わない。現route、設定、owner/event、接続、editor/editability、IMEを必要な時点で確認し、過剰なDOM一致ゲートは追加しない。
- C47コード/testsは各ファイル500行・32 KiB以内。Chrome/Bridge実操作、dist以外への配備、push/merge、worktree/subagentは禁止。

## 作業手順

1. 会話別設定のdefault OFF・旧保存状態fallback・update/reload永続化・ON時刻より前のevent除外を先に表すテストを追加し、focused testでREDを確認してからrepository型/validatorを拡張する。
2. 末尾adapterのテストを追加する。空欄の生テキスト、既存末尾への改行付き追記、選択範囲維持、添付維持、IME/非編集可能/複雑内容拒否、送信操作なしをRED確認後に実装する。
3. monitor新規terminal保存callbackのテストを追加する。新しいeventのみ・重複/restoreなし、mute/notification成否から独立、owner identity-onlyを確認してからdispatch hookとbackground配線を実装する。
4. protocolとcontent flowのfocused testsを追加する。OFF、過去event非再生、owner別tab/別会話/SPA route変更、connection/event/C37結果不一致、event重複、手動watch、複数同時完了の直列順序、pendingのみ有界retry、confirmed retrievedのみ挿入をRED確認後に実装する。
5. C欄へ小さな会話別ON/OFF/status controlを追加する。最小化/詳細折りたたみ中もlistenerが存続し、C46 auto-watch/mute/audioとは独立することを確認する。既存C37手動取得/挿入は維持する。
6. C47受入文書を作成し、main checklist/progressへC47状態とユーザー担当のChrome手順を追加する。C37/C45/C46既存記録や未確認判定を上書きしない。
7. 要求された順序で `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm check:size`、`pnpm build`、`git diff --check` を実行し、全終了状態を記録する。Chrome実機はNOT_RUN。
8. C47差分を自己レビューし、対象ファイルだけstage/commitする。別commit後のbranch/HEAD/statusがcleanであることを確認する。

## 受入レビュー焦点

- C37の厳格な既存owner/auth/connection/target/turn検証を迂回しない。
- owner tabへのeventId-only通知とeventId単位dedupeにより、同会話の別tabや別会話へ二重挿入しない。
- 受信順queueが同会話の挿入順を決め、failed eventは手動取得可能なまま残る。
- 既存draft/選択/添付を壊さず、挿入APIはChatGPT editorの標準入力イベントを使う。submit/sendを起動しない。
- `pending` retryは上限があり、OFF/route change/設定変化/connection change時に中断する。
- event本文はC37応答以外に保存・出力されない。
