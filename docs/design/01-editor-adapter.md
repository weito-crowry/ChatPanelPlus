# ChatGPT 入力欄アダプター設計

- 文書ID: CPP-DESIGN-01
- 状態: 初版（実装承認ではない）
- 依存: 00-architecture.md
- 移植元: ChatGPT 定型ボタン v7.2 の getPromptEditor / insertAtTop / pasteAtCaret / clearEditor 周辺

## 1. 目的

ChatGPT の入力欄（Composer）を対象に、定型文の先頭挿入、JST 時刻挿入、クリップボードの現在位置挿入、全文クリアを実装するための境界を定義する。UI コンポーネントは要素検索や Range 操作を知らず、アダプターの公開 API だけを使用する。

不変条件: 自動送信しない。編集前の未送信本文を意図なく破壊しない。部分編集のために全文を読み出して置換しない。ユーザーの空白・改行・選択範囲を保護する。

## 2. 実装場所と境界（提案）

- src/content/editor/ へ純粋なエディタアダプターを分離する。既存 src/content/main.tsx と Panel.tsx には DOM 編集処理を追加しない。
- DOM API に依存するため Content Script 側で実行する。Service Worker、Options、React の表示層から直接 DOM を触らない。
- 公開インターフェース例（名前は実装時に確定）:
  - findActiveEditor(): HTMLElement | null
  - insertAtBeginning(text: string): EditResult
  - replaceCurrentSelection(text: string, snapshot?: SelectionSnapshot): EditResult
  - clearComposer(): EditResult
  - captureSelectionForPaste(): SelectionSnapshot
- EditResult は ok / reason の型付き結果とし、UI はエラー時にトーストを表示する。理由例: editor-not-found、editor-hidden、selection-invalid、edit-rejected、composer-changed、unexpected-error。
- SelectionSnapshot は取得開始時の Composer Element 参照（未検出なら null）と複製済み Range（取得できない場合は null）を保持する一時構造であり、永続化・メッセージ通信・ログ記録の対象外。

## 3. Composer の検出

v7.2 が使う優先候補（将来の DOM 変化に対する推定ではなく既存仕様）:

1. #prompt-textarea[contenteditable="true"]
2. [data-testid="prompt-textarea"][contenteditable="true"]
3. form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]
4. form [contenteditable="true"][data-lexical-editor="true"][role="textbox"]
5. form [contenteditable="true"].ProseMirror[role="textbox"]
6. form [contenteditable="true"].ProseMirror

- 各候補の isConnected、表示状態、フォーム所属、disabled / readOnly 相当を確認する。
- 見えない候補、過去の Composer、返信編集欄や別フォームを操作しない。複数候補が存在し対象を安全に特定できない場合は失敗を返す。
- v7.2 は表示要素を優先しつつ最初の候補をフォールバックとして返すが、新版では不可視要素への誤操作防止を優先する。この差分は実機テストで明示的に検証する。
- セレクタ群は一か所に集約する。DOM の変更を扱うために ChatGPT の内部状態・非公開 API・fetch の呼出しを追加しない。

## 4. 編集前の保護

- 編集直前に最新の Composer を再検出し、Element の接続・可視性を再確認する。
- selection が Composer 内部の Range である場合に限って複製して利用する。
- 既存テキストの形式や空白を正規化しない。入力済みテキスト全体の innerHTML、innerText、textContent を書き換えて挿入処理を実現しない。
- ドラッグ選択や IME 変換中に干渉しないようにする。IME 合成中の編集は拒否・延期等の安全な方式を選び、実機挙動を検証する。
- 添付画像・複雑なノード等が含まれる Composer を一律にクリアしない。クリアは明示操作時だけで、消去対象を仕様として明示する。

## 5. 先頭への定型文挿入

入力: 挿入テキスト。改行を含む任意の文字列を、定型文のまま扱う。

処理の規則:
1. Composer がなければ変更せず失敗を通知。
2. テキストが空の場合は何も変更しない。
3. 入力欄に既存テキストがある場合、指定の定型文が改行で終わらず、元の先頭文字が改行でないときだけ、境界の改行 1 個を補う（v7.2 の insertAtTop と同じ）。
4. Composer の先頭へ選択 Range を設定して必要最小限のテキストを挿入する。
5. DOM 編集がアプリのエディタモデルに反映されたことを検証できる方式を採用する。自動送信しない。

- v7.2 は document.execCommand('insertText') を通常経路として使い、失敗時は Range 操作と input イベントを使う。移植時は同様の効果が必要だが、execCommand が全環境で動くとは仮定しない。
- 通常経路の挿入時には既存本文の全走査・再構築を禁止。境界の改行判定に必要な先頭文字の参照だけを許容する。
- 既存文字列の末尾など、対象外の本文を変更しない。空白・改行のテストケースを設ける。

## 6. クリップボードの選択位置への挿入

- クリップボード取得は別モジュールが担当し、エディタには取得済みテキストを渡す。
- クリップボード取得開始時に対象 Composer Element 参照と、ボタン操作でフォーカスが失われる直前の選択範囲を captureSelectionForPaste() で保存する。ボタンの pointer / mouse 操作順と React イベントを Chrome 実機で確認する。
- 挿入直前に最新 Composer Element を再検出し、取得開始時に保存した参照と同一であることを確認する。異なる場合は、同じ会話で DOM だけが再生成された場合も含め、自動挿入を中止して composer-changed を返し、明示的な再試行を促す。新しい Composer への選択位置／末尾フォールバック挿入は禁止する。
- Composer Element が同一で保存 Range が有効かつその内部にある場合は復元し、選択範囲を置換する。通常の Ctrl+V と同等の位置意味論を要求する。
- 保存 Range が無効でも Composer Element が同一なら、最新 Composer 内で有効な Range があれば利用し、なければその末尾へ挿入する（v7.2 互換）。
- 一度のクリックで一度だけ挿入する。連続クリックや非同期完了順の逆転を想定し、再入や状態の扱いをテストする。
- CRLF → LF の変換は v7.2 のクリップボード処理との互換として許容。それ以外の入力テキストのトリミング・全文正規化は禁止。
- 空文字・ユーザーキャンセルなら無変更。

## 7. 明示的なクリア操作

- クリアは「クリア」ボタンの押下時のみ。
- Composer 内部全体を選択し document.execCommand('delete') 相当で削除する。通常入力としてモデル更新されることを確認する。
- v7.2 は最後のフォールバックで editor.replaceChildren() と input イベントを使う。新版ではエディタ状態との不整合を起こさないかを重点検証し、失敗時は不成功を通知する。
- Undo / Redo が壊れる経路、添付ファイルの挙動、入力中 IME での操作は未検証のため、機能別テストで扱う。
- ページ全体のメッセージ、履歴、別編集欄を消さない。

## 8. 操作結果と UI 連携

- アダプターは DOM やクリップボードの本文をログに出さず、成功可否と構造化理由だけ返す。
- UI はエラー時に読み取り可能な日本語のトーストを表示する。成功トーストは不要な操作では既定表示しない。
- UI のマウスイベント中に preventDefault を使う場合、テキスト選択の保持とボタンのアクセシビリティを両立させる。キーボード操作でも適切に機能することを別途確認する。
- InputEvent を合成しただけで成功扱いにしない。編集モデル反映や Chrome 実機の観察結果を受入条件とする。

## 9. 単体・統合・実機テスト

自動テスト用の DOM 環境が実挙動を再現できない場合は、その限界を明示し、実機テストを必須とする。

最低限の受入シナリオ:
- 空 Composer へ「全文」挿入: 指定文だけが入力され、送信なし。
- 既存文字列あり: 本文先頭へ挿入され元本文・空白・改行は保持される。
- 挿入文字列が改行で終わる/元本文が改行で始まる: 不要な境界改行が追加されない。
- 途中カーソルへのペースト: 途中に挿入される。
- テキスト選択へのペースト: 選択範囲だけ置換される。
- クリップボード読取拒否・空文字・手動貼り付け: 仕様どおりの通知と動作になる。
- ボタン押下でフォーカスが切り替わっても、カーソル位置が保護される。
- 新規チャットへの SPA 遷移直後・Composer 再生成直後: 古い要素を編集しない。
- Composer 不在、複数候補、不可視状態: 別入力欄へ誤挿入しない。
- クリア: 入力欄だけを消し、会話本文や外部 DOM に影響しない。
- ProseMirror、Lexical に該当する入力欄構造で確認する。
- React パネルの再描画・最小化・タブ切替と相互干渉しない。

## 10. 完了条件

- React UI から DOM 操作を切り離した型付き API がある。
- v7.2 と同じ定型文先頭挿入・コピペ位置挿入・クリアの意味論を満たす。
- 既存本文・改行・選択範囲を保護し、自動送信しない。
- 不明な入力欄を推測で編集せず、失敗を検知できる。
- 静的検査・サイズ制限・対応テストに合格し、Chrome 実機の受入条件を満たす。
- 本文を無断保存・ログ化しない。
