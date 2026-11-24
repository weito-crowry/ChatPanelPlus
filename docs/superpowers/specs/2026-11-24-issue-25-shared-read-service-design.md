# Issue #25 共通CodexBridge read service設計

## 目的

実行中一覧・件数、個別watch、自動登録候補、最終回答読取で共有するMCPクライアントと読み取りスケジューラーをService Workerに置く。タブ単位の取得を同一接続・認証世代・targetのsnapshotへ集約し、一覧の更新を終了eventの発生に依存させない。

## 現行構成と変更範囲

- `codexbridge-panel.ts` はメッセージごとに設定・権限・tokenを読み、新しい`CodexBridgeMcpClient`を生成する。
- `codexbridge-thread-monitor.ts` は別のキャッシュclientを持つ。`thread-monitor.ts`はwatchごとに`codex_status`をscheduleする。
- `thread-monitor-auto-registration-candidates.ts`と`thread-monitor-auto-registration.ts`はtarget確認後に各々`running_only`を取得する。
- `CodexBridgeList.tsx`は初期化、手動更新、watch/terminal通知を契機に一覧と件数を更新し、定期取得はしない。

## 設計

### 共通read serviceと認証世代

新しい`CodexBridgeReadService`をService Workerで一つ生成し、panel handlerとthread monitorへ注入する。設定済みendpoint、session token、host permissionを毎回解決し、接続情報が変わったら単調増加するメモリ内generationを更新してclientとsnapshotを破棄する。`connectionId`は既存のendpoint由来の値を維持し、owner lease/watch identityを変えない。tokenはclient生成時にだけ渡し、ログ・storage・応答へ出さない。`storage.onChanged`のendpoint/token変更と`permissions.onRemoved`で即時invalidateし、各read完了時にもgenerationを再確認する。古いgenerationの応答は返却・cache・監視状態更新に使わず`connection-changed`として扱う。Service Worker再起動時にcacheは自然に失われる。

`readTargets`、通常thread page、`codex_status`、`codex_final_answer`、`running_only`を同じclientから読む。通常一覧のcursorとページ数は従来契約のままとし、cache対象にしない。完全な`running_only` pageだけをgeneration/target別に保持する。

### Snapshot鮮度・更新規則

前面TTLは5秒、背面TTLは30秒とする。ユーザーの手動更新はTTLを無視して取得する。自動候補表示は2秒以内のfresh snapshotだけを使い、登録確定時はowner/connection確認後に新しい`running_only`を取得して候補IDを再照合する。stale cacheだけで候補を返したり登録しない。

成功応答には`fresh`または`stale`、観測時刻、経過時間、直近失敗理由を付ける。取得失敗後に前回pageを返す場合は必ず`stale`とし、件数表示は`—`、一覧には古い情報であることを示す。snapshotがない失敗は`error`、まだ一度も取得していない状態は`unknown/loading`として扱い、古い0件を最新0件として表示しない。対象切替では別targetのpageを表示しない。

通常失敗は5秒を起点とする指数backoff、上限5分。`running-only-unsupported`は5分抑制し、明示手動更新は抑制を越えて再試行する。取得中のsnapshot requestは同一generation/targetでsingle-flightとし、成功後はTTL内の要求へ再利用する。

### Scheduling・周期・上限

ネットワークreadの実行枠はService Worker内で共有する。同時実行3件、待機上限48件、優先度は`urgent status > manual > foreground > candidate > background`、同一優先度内はFIFOとする。既存のwatch 1cycle最大12件・targetあたり最大3件の選別も維持する。同一status requestもgeneration/target/thread単位でsingle-flightし、queued中に優先度が上がった場合はqueue内で昇格する。

監視状態の永続化、通知準備/再生、event配送・claim、owner lease操作はMCP read queueの外で行う。通知・dispatch中にread枠を保持しない。watch poll、候補読取、登録確認は共通schedulerを一度だけ通し、nested lockを作らない。worker起動後は保存済みwatchを既存alarmで復旧する。alarm間隔は既存の30秒を維持し、watchがなければalarmを停止する。

### 一覧・watch・自動登録

閲覧中のA一覧または実行中件数を前面5秒・背面30秒で更新する。通常一覧モードではcursor pageと選択を維持しつつrunning summaryだけを更新する。実行中一覧モードでは現在のpageを更新し、selection reconciliationを使う。対象/会話/表示mode/minimize/SPA/unmount時は旧requestを無効化しtimer/listenerを解放する。同一targetの複数会話・tab要求はservice cache/single-flightに集約する。

watchのあるtargetではmonitor cycleからも`running_only` snapshotを一度要求する。freshかつcursorなしの完全snapshotに対象thread IDが存在しない場合、該当watchの`codex_status`をurgent優先で読む。存在時もwatchの`codex_status`を継続する。snapshotの欠落、失敗、非対応、stale、未知、推定状態だけからwatchを解除・終端判定しない。最終的な終端/復旧/evidence判定は#24の現行関数だけを使い、通知・event一意保存・owner配送経路は変更しない。

候補取得と登録確定はfreshな完全snapshotのみを利用する。候補は現在のassistant回答で明示されたIDとの既存照合後にだけ登録する。live execution/evidence、skip/mute、owner lease/rebind、connection/target隔離、全実行threadを自動登録しない規則を維持する。inferred/estimated/persisted/unknownをliveへ昇格しない。最終回答は共通clientを通すが、event identity、permission、turn確定経路を維持する。

## 受入・制約

- 自動試験でsingle-flight/freshness、target/auth generation境界、手動更新とpagination、未監視thread開始/終了の周期更新、fresh snapshot不在後のstatus優先、非対応/失敗時watch継続、候補鮮度/owner分離、worker restore、終端重複・自動反映を確認する。
- Chrome実機操作は行わず、C55受入手順とNOT_RUNを追加する。C48〜C54の既存結果は変更しない。
- 読取以外の権限を追加しない。全手書きコード/テストは500行・32 KiB以内。push、merge、Issue closeはしない。
- Optionsの明示接続テストは未保存endpointを対象にするため、monitor用共有clientへ混ぜない。
