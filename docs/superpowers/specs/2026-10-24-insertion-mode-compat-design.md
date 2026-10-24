# insertionMode 互換性とカーソル位置挿入の設計

## 意図

保存済み `schemaVersion: 1` のカスタム挿入ボタンにある `insertionMode` を維持し、Options から編集でき、Composer の先頭または最後に有効だったカーソル位置へ定型文を挿入できるようにする。

## 目標と対象外

- `beginning` / `caret` を任意の挿入ボタン設定として厳格に検証し、読込・正規化・JSON入出力で保持する。
- Options の挿入ボタンに挿入位置の選択肢を表示する。
- caret は既存の Range snapshot と検証済み `insertText` 経路を再利用する。
- 設定の初期化・削除、schemaVersion 更新、クリップボード経路変更、Chrome自動操作は行わない。

## 制約

- schemaVersion は 1 のまま。
- `insertionMode` は `kind: 'insert'` の場合だけ許可し、未設定は従来の先頭挿入として扱う。
- 無関係な未知フィールドを引き続き拒否する。
- 選択範囲があるときはその範囲を置換する。snapshot が無効なら同一Composer内の現在選択、次にComposer末尾へフォールバックする。
- caret 用 snapshot と現在の pathname が異なる場合、別会話の位置として拒否する。共有のクリップボード編集経路にはこの条件を追加しない。

## 検討した方法

1. `insertionMode` を設定層で保持し、Options と既存エディタアダプタへ配線する（採用）。設定互換性と挿入実装を既存の責務に沿って修正できる。
2. OptionsやPanelだけで個別に値を保持する。正規化またはエクスポート時に値が落ちる既存問題を解決できないため不採用。
3. 新しいDOM編集機構を作る。既存の検証済みComposer編集経路と重複し、リッチテキスト構造やChatGPT入力イベントとの互換性を損なうため不採用。

## 実装者に残す判断

- 実際の型定義、テストfixtureの形、Options UIの配置は現行構造に合わせる。
- 実ブラウザChromeでの確認はユーザーが行う。
