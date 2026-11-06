# #1 履歴スキャンの端判定

## 再現できた独立した欠陥

末尾 `scrollTop=800 / scrollHeight=1000 / clientHeight=200` に到着した後、最後の安定観測の非同期待機中に `clientHeight=100` へ変化すると、現在の末尾は900になる。旧コードは待機前の端判定を使い、安定signatureにclientHeightも含めないため、800で`completed`を返して900へ進むと現れる履歴を取得しなかった。

`tests/conversation-statistics-history-edge.test.ts` の決定的なlayout変更で再現した。初回は3テスト中この1件が意図したFAIL、履歴の高さ増加とscroll anchor変更は既存コードでもPASSだった。会話subtree外のlayout変化を模し、Chromeを起動せず、固定経過時間の競合にも依存しない。

## 最小修正方針

端の待機後に現在の位置・高さ・viewport高さを読み直し、現在も端かを再評価する。端でなくなったら安定観測をリセットして走査を続ける。安定signatureにもclientHeightを含める。待機時間・走査上限・キャンセル・位置復元・会話ごとの累積は既存値のまま。

## 原報告に残る不確実性

これは画面サイズ変化による端の誤確定の修正であり、上端で過去履歴の遅延読込を開始するChatGPT実DOMのloading兆候を特定したものではない。無変化の安定観測後に任意に遅れて始まる履歴読込を、有限時間の観測だけで否定できない。

根拠のないloadingセレクターや固定待ち時間の延長は追加しない。通常Chromeで原現象の時系列、読込中に現れる要素/属性、scrollHeight/scrollTop/clientHeightとturn追加の変化を確認して再開する。確認できない走査を完全履歴取得の証拠にしない。既存`completed`は走査手順が両端の安定観測まで終了したことを示し、ChatGPT側の全履歴不存在を保証しない。

## 検証と実機確認

最終的な修正結果・自動試験件数は [処理記録](../issue-progress-2026-11-07.md) に記録する。通常Chromeの上端遅延読込、下端、取消、上限、SPA、累積保全は [統合確認表H1/H2](../manual-verification-2026-11-07.md) に集約する。原報告の実機原因は未確定のためIssueはOpenを維持する。
