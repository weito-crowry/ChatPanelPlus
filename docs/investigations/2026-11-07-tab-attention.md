# 非アクティブタブの点滅調査 (#5)

- 確認日: 2026-11-07
- 状態: 既存実装の維持を判断。Chrome実機の見え方は確認待ち
- 関連: [Issue #5](https://github.com/weito-crowry/ChatPanelPlus/issues/5)、[既存表示設計](../design/16-tab-completion-indicator.md)、[統合確認表](../manual-verification-2026-11-07.md)

## 現在の実装と確認済み事実

`src/content/tab-completion-indicator.ts`には、非表示Documentで回答完了した際にtitle先頭へ`● `を付け、専用SVG faviconを赤→黄の2相で切り替える処理がある。500ms指定のtimerで6回切り替えたあと赤い未読印を残す。実装されていないことが点滅しない原因だとはいえない。

既存faviconの属性を書き換えず、専用linkをhead末尾へ追加する。head/title/faviconがChatGPTに差し替えられた場合は追随し、visible復帰で自分の追加分を除く。titleは現在値を自分が所有している場合だけ戻す。視覚通知と音声は`answer-completion-notifications.ts`で独立しており、音OFF/音量0/再生失敗でも視覚通知へ影響させない。

Issue本文には「通常Chromeで●は見えるが期待した点滅は見えない」「●が分かるので当面はよい」という過去の実機報告がある。今回はChromeを操作しておらず、現行ビルドで同じ結果を再確認したとはしない。単体テストがtimerとDOM更新を検証しても、ChromeのタブUIがfavicon候補を描画したことの証明にはならない。

## 原因候補と比較

Chromeは非表示ページのtimerを条件に応じて間引く。したがって500ms指定どおりの点滅間隔・回数が画面に現れるとは限らない。以下のChrome公式記事はChrome 88時点の制御説明であり、ユーザーの現在のChromeで同じ時間条件が適用された証拠ではない。[Chrome公式: Heavy throttling of chained JS timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/)

| 案 | 評価 | 判断 |
| --- | --- | --- |
| 既存●と赤黄favicon切替を維持 | ●は過去の実機で確認済み。背景timerが遅れても未読表示が残る | 採用 |
| title自体を交互に点滅 | faviconの候補選択には依存しないが、背景timer制御は残る。見え方と煩わしさが変わる | 追加しない |
| 点滅方式やON/OFFの新設定 | ユーザーの選択肢は増えるが、原因未特定で設定項目だけが増える | 追加しない |
| タブUI自体の点滅 | 現実装はDocumentのtitle/favicon変更。Chromeタブ自体を点滅させるAPIの採用可能性は未検証 | 採用しない |

**今回の判断は既存のfavicon切替と●をそのまま維持する。** 点滅が見えない原因を断定せず、title点滅・追加設定・権限追加は行わない。Chromeでどのfavicon候補が採用されるか、timerがいつ実行されたか、描画されたかを次回の手動確認で分ける。

## ユーザー通常Chromeでの確認

固定ロード元・対象commit・Chrome版を[統合確認表](../manual-verification-2026-11-07.md)へ記録し、以下を手動確認する。一時プロファイルやChrome自動操作は行わない。

| 条件 | 期待/観測項目 | 今回 |
| --- | --- | --- |
| 別タブへ切替後、回答が完了 | ●が付き、faviconの変化が見えるか。切替終了後も未読印が残る | 未確認 |
| 最小化/長時間非表示 | 点滅の遅延/欠落と、●の残存を別々に記録する | 未確認 |
| 対象タブを開く | 最新のtitle/faviconへ復帰し、未読印が解除される | 未確認 |
| 複数ChatGPTタブ、SPA遷移 | タブごとに独立し、title差替えで●が重複しない | 未確認 |
| 音OFF、音量0、出力先利用不可 | 視覚表示が音声の結果に依存しない | 未確認 |

timerを正確に数えることは受入条件にしない。●の保持とvisible復帰時の解除を優先して確認し、点滅が見えない場合はその結果を残す。●自体が消える/戻らない問題があれば、点滅の改善とは分けて追跡する。既存通知・DOM互換の境界は[Composer互換性調査](2026-11-07-composer-compatibility.md)も参照する。
