# Composer・表示・貼り付けの調査 (#2/#8/#15/#16/#13/#11/#12)

対象: 開始時HEAD `f993dae` と#14回収差分。Chrome実機は今回未操作。全Issue本文とコメントを取得した。

## #2 単独改行の誤送信 — Blocked

`src/content/editor/adapter.ts` の挿入経路は単一の `document.execCommand('insertText', false, text)`。定型文保存・dispatchに改行を削る処理は確認できず、src/options内に合成Enter・submit/requestSubmit呼出しは見当たらない。先頭/caret/選択置換は既存の選択範囲復元とEditor Adapterを通る。

単純なcontenteditableの挙動はChatGPT実ComposerのReact状態と同じとは限らないため、入力方法の推測変更はしない。根本原因は未特定。既存の診断フラグ `?cppDebugInteraction=1` でイベント種別・inputType・Enter・submitを比較できる。submitがないことだけでReact内部の送信がなかったとは証明できない。

再開条件: 通常Chromeの機密情報のない空チャットで、LF単独、CRLF、改行＋文字、複数行を先頭/caretで比較した結果。既存本文、選択置換、Undo/Redo、IMEの差を記録する。本文とInputEvent.dataは記録しない。統合確認表S1/S3参照。

## #8 改行以外の誤送信 — Blocked（診断改善は独立実装）

パネルのボタンは `type="button"`、パネルホストはComposerフォーム直前に配置される。無断送信を直接実行する箇所は見当たらない。レイアウト変更によるクリック到達先、実Composerのイベント解釈はソースだけで特定できない。

既存 `interaction-debug.ts` はHTMLElementだけを分類し、SVG/path子のクリックをpage、ボタン内spanをform-controlに分類してしまう。これは診断の欠陥として再現・修正可能。誤送信そのものの修正とは区別する。HTML/SVG子からの親ボタン分類、Shadow DOM内の分類、イベント非抑止、機密値非記録、停止時listener解除を回帰対象とする。

再開条件: 統合確認表S2の実クリック元と時系列。送信発生元が判明するまでComposerの挿入/貼付処理は変更しない。

## #15 改行・Markdown表示欠落 / #16 コピー成功表示 — Blocked

現行 `src/` と `options/src/` を検索したが、会話本文の表示枠・Markdownレンダラー・クリップボード書き込み/コピーボタンは見当たらない。パネルのactionは挿入・時刻・貼り付け・クリア。`clipboardRead` は貼り付け用でありコピー書き込み経路ではない。

したがってwhite-space変更やコピーUIの新規追加では、報告された対象を修正した証拠にならない。ChatGPT本体、別版、別UIの可能性を確定しない。追加権限や新規Markdown依存を導入しない。

再開条件: 該当ビルド、画面内の表示枠/ボタンの所在、機密情報のない最小テキスト、表示とコピー値の差。対象が特定できた後、取得→正規化→状態→DOM/CSS→コピーの各段階を比較する。#16は成功解決後のみチェック、1.5〜2秒復帰、失敗・連打・複数対象・unmount時のtimer解除を実装/検証する。統合確認表D1参照。

## #13 長文・リッチテキスト性能 — Blocked（実機計測待ち）

既存の `clipboard-metrics.ts` とPanelのreporterは `?cppDebugClipboard=1` の明示時だけ計測し、click-to-read/read/composer/selection/command/validation/edit/complete等を区別する。本文をログに含めず、文字数・一致判定・イベント属性・段階時間を扱う。

通常経路は `execCommandPaste`。debugフラグのみを付けるとinsertTextを選ぶため、通常経路を測る場合は `&cppDebugPaste=execCommandPaste` も明示する。`insertHTML` は実験経路。過去の成功時警告修正が現行Chromeでも妥当か、Node実行だけで判断しない。

再開条件: 統合確認表P1/P2の10k/100k、段落数、プレーン/HTML、通常Ctrl+Vとの各3回比較。段階別ms・成功/警告・重複/部分挿入・フォーカス・Reactとの一致を記録する。今回は計測値もボトルネックも未確定。効果の裏付けのない高速化は行わない。

## #11 ChatGPT DOM互換性 — Blocked（現行実機DOM待ち）

Composer候補は `editor/adapter.ts` に集中し、prompt-textarea ID/data-testid、composer-markdown、Lexical、ProseMirrorの候補を使う。可視/接続/編集可否・フォーカスと選択を検査する。会話DOMは `conversation-statistics-dom.ts` のturn/assistant抽出、content lifecycleはSPA/再マウントとobserver解除を扱う。

現行サイトDOMに実際に一致するかは取得していない。既存fixtureのPASSを現在のChatGPT互換性と同一視せず、未再現の障害へのフォールバックを追加しない。統合確認表C1/C2/R1で対象commitと候補の一致・検出不能・複数候補・遅延/仮想化・部分取得を確認する。

## #12 insertHTML実験経路 — Blocked（採用判断保留）

`clipboard-debug.ts` の明示debug切替でのみ選択。`experimental-insertion.ts` のinsertHTMLは入力文字列をHTMLエスケープしてwhite-space:pre-wrapのspanで挿入する。元の書式付きHTMLをそのまま保持する経路ではない。通常のinsertText/paste/caret経路は変更しない。

採用/不採用は未決定。統合確認表P2/S3で、改行、選択、React同期、Undo/Redo、検証時間・誤警告を比較する。現在の目的は実験評価であり正式機能への昇格は行わない。

## 自動検証の位置付け

基準の全404テスト・typecheck・lint・完全ビルドが成功。調査担当のEditor Adapter・検証・interaction-debug・button dispatch関連33テストも成功。いずれもChrome実機の誤送信非発生、現在DOMとの互換、長文実測を証明しない。最終版の全体結果と変更は [処理記録](../issue-progress-2026-11-07.md) に記録する。
