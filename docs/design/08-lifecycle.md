# Content Script ライフサイクル・DOM復旧設計

- 文書ID: CPP-DESIGN-08
- 状態: 初版
- 依存: 00-architecture.md、01-editor-adapter.md、02-panel-ui.md
- 移植元: Tampermonkey v7.2 の needsBuild、buildUI、MutationObserver、fallbackTimer
- 現行: src/content/main.tsx の初回 Shadow Root マウントが基盤。

## 1. 目的

ChatGPT のシングルページ遷移、新しい会話、既存会話の復帰、Composer の再生成に対し、パネルが重複・消失・不正な入力欄操作を起こさず動作するようにする。会話読み込みの HTTP リクエストや内部 API に干渉しない。

## 2. ライフサイクルの状態

- waiting: 対象 Composer がない。ページ本体は変更せず復帰待ち。
- attached: 現在の有効 Composer に対応するホストと React Root が存在する。
- detached: ホスト要素・対象 Composer の切断を検知し、再配置を必要とする。
- disposed: 不要になった監視・イベント・タイマーが解除されている。

状態名は設計上のものであり、実装は過剰な状態機械にしなくてよい。

## 3. マウント・再配置

- 初回は既存 main.tsx の Content Script を起点に、ホストと Shadow Root と React Root を一度だけ作成する。
- Composer の参照・位置はエディタの探索機構を共用し、見えている Composer に対応する表示位置を決定する。
- 元 v7.2 は getComposerHost(editor) により form や data-chatgpt-composer 等を探索し、host.insertBefore(container, host.firstChild) で入力欄上部へ配置する。拡張版は Shadow Root ホストを同様の視覚位置へ置くが、Composer の送信処理や DOM 内部を破壊しない。
- マウント先が失われた場合は同じ React Root/ホストを再利用できるか検討し、不必要な二重ルート・イベント購読を作らない。
- React 再描画はユーザーの未送信 Composer を操作しない。再配置時に selection の参照を失った場合は、無効な Range を再利用しない。
- Shadow Root にある UI のスタイルは他要素へ漏らさない。既存 Chrome v0.1.5 の機能を壊さない段階的変更を行う。

## 4. 監視コスト・自己ループ防止

- v7.2 は document.documentElement に childList/subtree の MutationObserver を置き、250ms の coalescing で UI 生存確認し、5秒周期の補助チェックを行う。
- これらの数値は移植時の初期参考値であり、ChatGPT の現行 DOM・負荷で測定して最終決定する。
- MutationObserver の通知ごとに全DOM探索や React 再マウントをしない。ホスト・Composer の既知参照が接続済みなら軽量判定する。
- 自身の DOM 追加・スタイル変更でも observer が通知されることを想定し、同一状態なら no-op とする。
- タイマー登録・observer の重複を防ぎ、実行中の pending check の数を抑える。
- ページ非表示中の監視頻度・復帰後の再検出は通常操作に影響しない範囲で調整する。

### 4.1 会話統計の監視

- 統計監視は現在の `main` を対象とし、`data-turn-key`、`data-chatgpt-selection-message-id`、`data-dil-message-id`、`data-talvt-turn-state` と User マーカーの属性、子孫追加、文字変更だけを見る。会話DOM全体の本文再走査は再集計ボタンに限定する。
- 会話IDはURLの `/c/{id}` から取得する。popstate/pageshow と低頻度のURL/root確認でSPA遷移を検出し、遷移時は旧Conversation IDのObserver、Composer form listener、pending timer、DOM参照を解放する。
- 初期DOMは識別子と回答状態の基準化に使い、本文を読まない。通常フォームの `submit` を監視するが、preventDefault/stopPropagationを行わず、送信後に末尾へ追加されたUserターンだけを自動計測する。
- 初期化後のスクロールで初めてDOMへ現れたTurn Keyは自動計測しない。既知ターンはAssistant IDまたは生成状態が変化した場合だけ対象回答を確認する。
- Composer再生成後もフォームsubmit監視を付け直す。フォームの内容、Selection、IME、Undo/Redoには触れない。

## 5. ページ遷移とエラー復旧

- 新規チャット、過去の会話への SPA 遷移、ブラウザ Back/Forward、別画面からの復帰に対して正常に表示される。
- スクロール・画面リサイズ・UI 表示幅変更時にパネルが Composer と無関係な場所へ残らない。
- 一時的に Composer が不在になってもコンソールへの連続エラーや無限リトライを起こさない。
- 想定外の DOM に遭遇した場合は誤入力欄への操作より安全な待機・表示停止を優先する。
- Content Script 初期化に失敗しても ChatGPT 本体の読み込みを妨げず、回復可能なエラーは次の確認周期で再試行する。
- 旧 ID で発生した HTTP 429 の原因は未解明。これを拡張機能自身の DOM 監視に起因すると決めつけない。ネットワーク API の再試行やスクレイピングは実装しない。

## 6. リソース解放

- Document 単位の監視・リスナー・タイマーを重複登録しない。
- 必要な場合だけ React Root を unmount し、古い Composer 参照・SelectionSnapshot を解放する。
- beforeunload／ページ離脱／ホストの論理破棄時に observer とタイマーを解放する。
- デバッグログはトグル式とし、会話本文・クリップボード内容を出力しない。

## 7. 受入条件

- 表示済みのパネルが DOM 再構築後に自動復帰する。
- 同一画面で複数のパネル・React Root・監視処理を増殖させない。
- 新規会話と既存会話間の往復でタブ・最小化設定が保持される。
- 入力欄に文章を入れた状態で UI が復元されても、その文章を変更しない。
- SPA 遷移中に旧 Composer へ定型文を挿入しない。
- 高頻度 DOM 更新（回答生成中）で observer が無制限に全DOM探索せず、CPU 使用率や UI 応答性が著しく悪化しない。
- Chrome 実機で通常の会話読み込みと送受信を妨げない。
