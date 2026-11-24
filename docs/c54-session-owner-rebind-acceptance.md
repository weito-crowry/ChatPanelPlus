# C54 Chrome session後の自動監視owner再bind — 受入手順

この手順はIssue #23の通常Chrome受入用。登録済みのrepo直下`dist/`を対象にし、兄弟Probeや別Chrome profileは使わない。Chrome操作はユーザーが行う。自動テスト・typecheck・buildは実機受入の代わりにしない。

## 準備

1. 作業branchの`pnpm build`完了後、`chrome://extensions`で登録済みChatPanelPlusをReloadする。
2. ChatGPTをF5し、C欄の「この会話全体の自動登録」がONの専用会話Aと、並行確認用の別会話Bを用意する。
3. 監視中watch、skip済みthread、通知/既読event、最終回答の手動取得状態、C47設定、C50 template、C51/C52音声と会話別muteを必要な範囲で記録する。会話本文、Bridge token、認証情報を記録へ貼らない。
4. 旧tab IDはUIから直接見えない場合がある。Chrome再起動後に旧tab IDを使わず同じ会話で自動復帰する挙動を確認し、ID再利用自体を観測できない場合はその条件を未確認のままにする。

## ケース

| ID | 操作 | 期待結果 | 判定 | 観測 |
|---|---|---|---|---|
| C54-01 Service Worker再起動 | 会話AをONにしたままService Workerを停止/再起動し、既存tabをそのまま使う。 | session owner leaseが維持され、同じtabがownerのまま。再ONなしで状態が復帰し、watchを重複登録しない。 | NOT_RUN | |
| C54-02 Chrome再起動 | Chromeを終了・再起動し、会話Aを再表示する。設定を切り替えずC欄、watch/event一覧、次回pollを確認する。 | `chrome.storage.session`消失後は旧tab IDをleaseとして扱わず、現在の会話tabが自動claim/rebindする。ON、watch、skip、既読、最終回答状態を保つ。 | NOT_RUN | |
| C54-03 拡張reload | Chromeを起動したまま拡張をReloadし、ChatGPT会話AをF5する。 | session leaseを新しいものとして取得し、既存の永続設定と同一会話のwatch/eventを再bindする。再ON・再登録を要求しない。 | NOT_RUN | |
| C54-04 初期化遅延・一時無応答 | owner tabを開いた直後や初回応答が遅れる条件でC欄を表示する。 | 「owner再確認中」と表示して再試行する。生存ownerを奪わず、「別tabが実行中」と区別する。復旧後は自動でreadyへ戻る。 | NOT_RUN | |
| C54-05 同一会話2 tab | 会話Aを2 tabで開き、両方のC欄を確認する。 | session内のownerは一方だけ。もう一方は別tab実行中と表示し、自動処理・event配送・音声を重複させない。会話全体の明示OFFは永続設定を切る。 | NOT_RUN | |
| C54-06 異会話並行 | 会話A/Bを同じBridge/targetで同時にONにし、別threadを各会話で完了させる。片側をOFFにする。 | 片側のowner待ち、skip、mute、失敗、OFFが他方の設定・候補・watch/eventへ影響しない。canonical threadのowner排他は一人のまま。 | NOT_RUN | |
| C54-07 SPA遷移・owner閉鎖 | owner tabを別会話へSPA遷移させるか閉じ、同じ会話を別tabで開く。 | 旧tabの会話identity不一致または閉鎖を確認した後だけ同一identityへrebindする。別会話へのwatch移管はしない。 | NOT_RUN | |
| C54-08 旧format互換 | 既存の永続自動設定/watch/eventを残した状態で更新後の会話を開く。 | 旧formatを読み込み、設定・watch/event・skip・通知/既読・最終回答を保持して必要なowner hintだけ更新する。既存eventをpending配送対象へ変換しない。 | NOT_RUN | |
| C54-09 owner不在中の新規event | owner tab不在の間に監視対象threadを終端させ、同じ会話で次回claimする。 | 新規未配送eventだけをpendingから一度配送する。identity-only通知を正しい会話へ送り、C47設定時刻・既存dedupeに従う。 | NOT_RUN | |
| C54-10 配送結果不明・手動取得 | event送信後に応答結果を確認できない状態を作れる範囲で確認し、その後workerを再起動する。 | `requested` eventを自動再挿入・再送しない。二重下書きや音声再生が起きず、最終回答は既存の手動取得から参照できる。 | NOT_RUN | |
| C54-11 mute・音声・通知状態 | mute ON/OFF、未読event、owner再bind、owner不在中の終端音を確認する。 | rebind時は現在ownerのmute/revisionを使う。owner/mute不明時の終端音はskipし、後から過去音を鳴らさない。skip・既読・通知stateを保持する。 | NOT_RUN | |
| C54-12 C47/C49/C50回帰 | C47有効時刻と会話、異会話2本のC49、C50 templateを維持したまま再起動後に終端eventを発生させる。 | C47の対象会話・有効時刻・下書き重複防止、C49独立性、C50置換結果を維持する。自動送信しない。 | NOT_RUN | |
| C54-13 C51/C52/C53回帰 | C51/C52の通知設定とmuteを維持し、C53で扱う確定終端・保留条件のwatchを含めて再起動後pollを確認する。 | 通知音設定と既存終端判定が維持される。C53未報告の観測項目はC53側の`NOT_RUN`を維持し、本受入でPASSへ拡張しない。 | NOT_RUN | |
| C54-14 Bridge認証 | session reset後にBridge tokenが別途必要な環境では既存認証状態を確認する。 | owner lease復帰とBridge認証を別の状態として表示・判定する。認証情報の変更・再認証をIssue #23の受入結果に含めない。 | NOT_RUN | |

Chrome再起動後、Bridge tokenの再認証が必要なら既存の認証フローを別途行い、owner再bindの失敗と混同しない。手順外の初期化・削除をせず、実測したケースだけを更新する。未実施は`NOT_RUN`のままにする。
