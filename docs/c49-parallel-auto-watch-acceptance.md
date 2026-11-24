# C49 同一Bridge/target上の会話別自動監視 — Chrome受入手順

## 目的

同一Bridge接続・同一targetで、異なるChatGPT会話がそれぞれ回答完了時の自動監視登録を有効化し、別々のthreadを所有できることを確認する。既存のC46候補照合、C45 watch/通知、C47最終回答自動反映、C48通知表示の意味は変えない。

回答完了イベント後に、その会話の確定済assistant回答に含まれるBridge `running_only=true`由来live IDだけを厳密一致で照合する。回答本文のID一致は起動元を暗号学的に証明するものではない。候補がない・曖昧・非live・別会話・別connectionの場合は登録しない。全running threadの周期走査・一括登録はしない。

## 準備

1. 実ロード元のrepo直下`dist/`を拡張機能画面からユーザーがreloadし、対象ChatGPTページをF5する。Chrome操作は自動化しない。
2. 同じBridge connectionとtargetを選んだ、互いに異なる専用ChatGPT会話A/Bを用意する。A/Bで同時に動いている別threadを使い、回答・会話本文・thread IDは記録へコピーしない。
3. 実機で安全な専用threadを用意できない項目は`NOT_RUN`とし、手順のために無関係なwatch/eventを削除しない。

## 確認手順

1. Aだけ自動監視登録をONにする。BはOFFのまま、エラーや「別会話が有効」という競合表示にならないこと、ONだけではrunning候補照会・watch登録が発生しないことを確認する。
2. BでもONにする。両会話が有効表示となり、対象マシンが同一であることを確認する。
3. A/Bそれぞれで、各会話の確定済assistant回答に、同一targetの異なるlive Bridge IDを一つずつ含めて回答完了させる。各IDが対応する会話ownerのwatchだけに登録され、片方の会話の完了で他方のwatchを作らないことを確認する。
4. 両回答で同じlive canonical threadが候補になる条件を用意できる場合、同時完了させる。watchが一つだけ作成され所有者が固定されること、負けた側に同一threadの所有競合が表示されること、負けた側の別候補は登録が続くことを確認する。後勝ちのowner移管がないことも確認する。条件を作れない場合は`NOT_RUN`とする。
5. AをOFFにし、Bの設定/statusとB ownerのwatch/eventが変化しないことを確認する。OFF後も既存watch/eventは残る。
6. Bのwatchを手動停止する。Bの対応するexecutionだけskipに記録され、A側のskip/settings/watch/eventが変化しないことを確認する。muteやBridge照会失敗が発生した場合も、failure/mute revisionが対象会話だけに帰属することを確認する。
7. connectionを切り替える場合、新connectionで旧entryがON扱い・自動選択されず、接続不一致中は登録しないことを確認する。connectionを元に戻した時に既存設定が表示されるかを含め、実測した表示をそのまま記録する。
8. 同じChatGPT会話を別tabで開く。稼働中のowner tabを別tabが奪わないことを確認する。安全に閉じた旧owner tabを確認できる場合のみ、明示ONによる同一会話の再bindを確認する。
9. Bridge応答待ちにowner tabを別会話へSPA遷移させる。古い回答の候補・失敗・登録が遷移後の会話へ混ざらないことを確認する。A/B間の切替、reload後も各会話の設定とwatch帰属が保たれることを確認する。
10. 既存watchの通知・ACK・タイトル●とC47最終回答自動反映が、各watch owner会話に帰属することを必要範囲で確認する。C48の未実施項目は本受入でPASS扱いにしない。

## 実機受入の記録（2026-11-24）

ユーザー報告に基づく部分結果。C49全体の実機受入完了とは扱わない。

| 項目 | 判定 | 観測範囲 |
|---|---|---|
| 異なる2つのChatGPT会話で自動監視をONにできる | PASS | 2会話それぞれでONにできたとの報告。回答完了時の候補照合・監視登録は未確認。 |
| 片方をOFFにしても、もう片方に影響しない | PASS | 報告された範囲のみ。watch/event、skip、mute、failure等の状態独立性は未確認。 |
| F5後も会話ごとの設定が維持される | PASS | 会話ごとの設定保持のみ確認。watch/eventの復元・owner帰属・拡張機能reload後の状態は未確認。 |
| 各会話から別々のCodexスレッドを起動した際の自動登録 | NOT_RUN | 未報告。 |
| 会話間で監視対象が混在しない | NOT_RUN | 未報告。 |
| Codex終了通知の会話owner帰属 | NOT_RUN | 未報告。 |
| C47最終回答の正しい会話への自動反映 | NOT_RUN | 未報告。 |
| 同一thread競合、skip/mute/failure、接続変更、別tab、SPA等のその他の詳細手順 | NOT_RUN | 未報告項目は未確認のまま維持する。 |

## 記録

- 各項目を`PASS` / `FAIL` / `NOT_RUN`で記録し、同一thread競合の未再現は`NOT_RUN`とする。
- 会話本文、回答本文、thread ID、秘密情報を記録へ含めない。connection/target名は必要な場合も匿名化する。
- C49全体は部分PASSとし、残項目があるため実機受入完了扱いにしない。結果は最終チェックリストC49行にも追記する。C48は自動801/801 PASS・Chrome `NOT_RUN`の既存記録を保持する。
