# C55 共通running snapshot・更新周期 受入手順

## 状態

**NOT_RUN（Chrome実機受入はユーザー実施）**。自動テスト・build結果を実機PASSへ読み替えない。C48〜C54の既存判定と記録は変更しない。

## 準備

1. `pnpm build`後、Chromeの登録済みrepo直下`dist/`を再読み込みし、ChatGPTをF5する。
2. 既知の対象マシンと、実行中/終了を作れるthreadを用意する。tokenや会話本文をログ・スクリーンショットへ残さない。
3. 時刻、表示mode、対象、実測更新間隔、Bridge応答のlive/estimated/persisted情報を記録する。

## 前面・背面の更新と一覧操作

1. 同じtargetを2つ以上のChatGPT会話tabで開く。実行中一覧を表示し、threadを選択する。
2. 監視登録されていないthreadを開始・終了し、終了eventを発生させずに一覧と件数が前面で約5秒周期に追従することを確認する。件数が0へ変わる場合は、Bridgeから完全なfresh snapshotを取得したことを確認する。
3. 一方のtabを背面化または最小化し、約30秒周期になることを確認する。前面へ戻すと約5秒周期へ戻ること、同じtargetのtab数を増やしてもBridge側readがtab数に比例して増えないことをBridgeログで確認する。
4. 通常一覧へ切り替え、2ページ目以降へ進みthreadを選択する。手動更新後も通常一覧のcursor位置・選択が保たれ、実行中件数だけが更新されることを確認する。
5. 実行中一覧の「thread一覧を更新」を押し、TTL内でも再取得されることを確認する。選択中threadが存在し続ける場合は選択状態を維持する。

## stale・接続切替・watch継続

1. 実行中一覧を一度取得した後、Bridgeへのreadを失敗させるか`running_only`非対応targetへ切り替える。古い件数が最新の0件/件数として表示されず、stale・error・未確認の状態が分かることを確認する。
2. endpoint、session token、host permissionのいずれかを切り替え、切替前の応答・件数・候補IDが新しい接続へ混ざらないことを確認する。接続復旧後に現在の設定から再取得する。
3. 監視中threadがfresh・完全なrunning snapshotから消えるケースを作る。該当threadの`codex_status`確認が優先されることを確認するが、一覧から消えただけではwatch/event/通知を終了扱いにしない。
4. `running_only`がunsupported、失敗、timeout、stale、estimated/persistedを返す状況でも、個別watchのstatus pollが継続することを確認する。live execution/evidenceが確定しない場合は#24の終端ルールに従って保留する。

## 自動候補・worker復旧・回帰

1. 現在のassistant回答に明示された正確なthread IDが、fresh snapshotのlive executionと一致する場合だけ候補が出ることを確認する。別会話のID、history/persisted/estimated/unknown、staleだけの情報では候補が出ず、自動watchが一括登録されないことを確認する。
2. 候補表示後にowner会話/tab、target、接続世代を切り替え、古い候補で登録されないことを確認する。skip/mute/owner leaseと同一会話owner rebindも従来どおり維持する。
3. watchを保存した状態でService Workerを停止・再起動する。再起動後に保存watchの既存alarmが復旧し、閲覧tabがない時は一覧周期更新が動き続けないことを確認する。
4. 既存のterminal event一意性、通知重複防止、会話分離、最終回答反映、下書き未送信、音声/muteの回帰を確認する。結果はC48〜C54へ遡及せず、必要なら新しい行へ記録する。

各項目は実際に観測した結果だけを記録し、確認できないケースは`NOT_RUN`のままにする。
