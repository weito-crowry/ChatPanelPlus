# 非表示タブの回答完了表示

- 文書ID: CPP-DESIGN-16
- 状態: 実装反映版（2026-10-23）
- 依存: `00-architecture.md`、`08-lifecycle.md`、`12-conversation-statistics.md`、`13-answer-completion-sound.md`
- 目的: ChatGPTタブが非表示の間に回答が完了したことを、faviconとタイトルで短く知らせる。

## 1. 動作

- `ConversationStatisticsController` が既存の回答完了Trackerで確定したイベントを通知先へ渡す。初回DOMのcomplete、リロード、SPA遷移、再集計だけでは通知しない。再生成は既存Trackerの有効な完了イベントだけを使う。
- イベント時に `document.visibilityState === 'hidden'` の場合に限り、そのDocument内で未確認表示を開始する。visible時の完了ではタイトル・faviconを変更しない。
- 未確認表示は全ChatGPTタブで既定有効とし、設定トグルは設けない。状態はページ内メモリだけに置き、`chrome.storage` へ保存しない。別タブへは共有しない。
- タイトル先頭に `● ` を付け、headへ専用の `rel="icon"` linkを1つ追加する。faviconは外部通信を使わず、赤または黄の未読印を描いたSVG data URIを使う。既存favicon要素の`rel`、`sizes`、`href`は変更しない。
- 開始時点で赤い未読iconを表示してから点滅を始める。500ms間隔で赤・黄の2相を6回切り替え、赤いiconを固定表示する。2相とも未読印を含めるため、背景タイマーが停止・遅延しても未読iconとタイトルが残る。点滅の厳密な間隔・完了時間は保証しない。
- `document.visibilityState` がvisibleになった`visibilitychange`で直ちに解除する。`focus`、`pageshow`もvisibleの場合に限り解除へ使う。
- Content ScriptのReact effect終了と、BFCacheでない`pagehide`ではtimer、observer、listenerを解放し、自分が追加したfavicon linkを除去する。リロード後に未読状態を復元しない。

## 2. 責務とDOMの扱い

- `src/content/tab-completion-indicator.ts` がタイトル、favicon、点滅、表示復帰、破棄を管理する。`ConversationStatistics.tsx` は既存完了callbackから通知し、React effect cleanupで破棄する。
- `src/content/answer-completion-notifications.ts` は視覚通知を先に独立実行し、視覚側の例外で音声を止めず、音声の無効・0%・再生要求失敗で視覚表示を止めない。
- Observerは現在の`head`内の子孫と、`documentElement`直下のhead入替だけを監視する。全DocumentのDOMは監視しない。head内のtitle/faviconが後から差し替わった場合はサイトの最新titleを基準に接頭辞を付け直し、専用icon linkを最後へ戻す。
- 解除時は専用linkだけを除去する。タイトルは、現在の要素と値が通知側の最終書込と一致する場合だけ、監視中に得た最新のサイトtitleへ戻す。サイトが別の値へ更新済みならその値を上書きしない。通知時にtitle要素がなければ自分で作り、元のtitleが空のままであれば解除時にその要素も除去する。
- 通知は回答完了音のON/OFF、音量、Background/Offscreen出力先、再生結果に依存しない。Tracker、権限、Manifest、出力デバイス経路は変更しない。

## 3. 制約

- 判定はDocumentのVisibility APIによる。ブラウザーがDocumentをvisibleと報告する間は、別ウィンドウで隠れている・画面上で覆われている状態を必ずしも検出しない。
- Chrome/Chromiumはバックグラウンドページのtimerを遅延・間引き・一時停止できる。点滅はbest effortであり、固定未読表示と復帰時の解除を主な保証とする。
- favicon候補が複数ある場合でも元のlink群は変更せず、専用SVG linkを最後に配置して前面候補として示す。実際の候補選択と点滅の見え方はChrome実機で確認する。

## 4. 自動検証と手動確認

- 自動テストはvisible/hidden判定、未読表示の固定、点滅timerの遅延・停止・終了、複数完了、表示中完了、visibility/focus/pageshow解除、サイトtitle更新と復元、faviconなし・複数link・head交換、dispose/pagehide、StrictMode相当の再生成、音OFF・音量0・音声失敗との独立を確認する。
- Chrome実機では、拡張をユーザーが手動で再読込した後、ChatGPTタブを隠して回答を完了させ、faviconが数回変化して未読表示が残ることを確認する。対象タブを開いた際に最新のサイトtitleとfaviconへ戻ること、音OFFまたは出力先利用不可でも視覚表示されること、複数タブで独立することを確認する。
- 実機ではタイマー間隔とアニメーション回数を厳密に数えず、停止後の未読表示とvisible復帰時の解除を受入の中心とする。windowが裏にあるだけの状態で`visibilityState`がhiddenにならない場合は通知対象にならない。
