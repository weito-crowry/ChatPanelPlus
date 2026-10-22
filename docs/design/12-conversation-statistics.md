# 会話統計仕様

- 文書ID: CPP-DESIGN-12
- 状態: Phase 3実装基準
- 依存: 00-architecture.md、02-panel-ui.md、05-settings-storage.md、08-lifecycle.md、09-testing.md
- 基準日: 2026-10-22
- 対象: ChatGPT会話ごとのTurns、INPUT/OUTPUT/総文字数

## 1. 機能スコープ

- ユーザー発言1件を1 Turn Keyで記録し、Turnsは同一Conversation IDの計測済みユニークTurn Keyの累積数とする。AI回答の再生成ではTurn数を増やさず、ユーザー発言の編集で新しいTurn Keyが生じた場合は旧・新の計測済みキーをともに数える。
- 新しく送信したユーザー発言は自動でINPUT文字数を記録する。選択中のAssistant回答が完了した後にOUTPUT文字数を記録する。
- 初回ページ表示では履歴を自動スクロールしない。通常のユーザースクロールで表示範囲に入った未計測ターンは自動収集し、「全履歴を集計」はユーザーが明示的に開始する。
- API、非公開エンドポイント、ChatGPT内部状態・通信を使わない。ChatGPT本来の送信処理を取り消し・遅延・代替しない。
- 会話本文を永続化しない。統計値はコンテキスト使用量や残トークン数を表さない。

## 2. DOM識別方式

Conversation ID は現在のURLの `/c/{id}` から取得する。現在DOMでは `data-message-id` と `data-message-author-role` を確認できなかったため、これらを識別根拠にしない。

Turnは `[data-turn-key]` で識別する。Phase 0で共有されたDOMスナップショットでは、Turn Key要素の子孫に `[data-talvt-turn-state]` があり、その状態要素の子孫に `[data-user-message-bubble]` と `[data-chatgpt-selection-message-id]` があった。Assistant側の子孫 `[data-dil-message-id]` はAssistant識別要素と同じIDを持つ例を確認した。

確認された `data-talvt-turn-state` 値は `in_progress` と `complete`。初回スナップショット時は完了3件、生成中1件で、生成中にはUserマーカーがありAssistant IDがなかった。生成中から完了への遷移そのもの、および生成途中にAssistant IDが現れる条件は未確認である。

DOM属性と親子関係はChatGPTの公開・恒久仕様ではない。状態が未知、複数状態が混在、IDが不一致、本文領域を安定して特定できない場合、推測したOUTPUT文字数は保存しない。

## 3. 文字数

- Unicodeコードポイント数を使い、改行と空白を含める。UTF-16コード単位では数えない。
- ユーザーBubbleとAssistant本文を別々に計測する。表示テキストを取得し、ボタン・操作UI、非表示UI、添付実体にあたる要素を除外する。
- 画像、動画、音声、ファイルそのものは数えない。コードブロックは表示された文字を数える。
- 同じTurn Keyや同じ本文テキストが重複DOM表示された場合は1回だけ採用する。Assistant本文は対応するDIL領域が一意に見つかればそれを優先する。
- `complete`だけで本文取得成功とはみなさない。Assistant ID、状態、安定した非空本文領域の取得が揃ったOUTPUTだけを確定する。DIL IDがAssistant IDと食い違う場合や特殊表示の文字列を確定できない場合はOUTPUTを未取得にする。
- 表示装飾のMarkdown記号はDOM上の表示本文に存在しない限り含まれない。ソースMarkdownの復元・推測はしない。

## 4. 保存スキーマとプライバシー

Storage key は既存の `chatPanelPlus.config` と `chatPanelPlus.viewState` から分離した `chatPanelPlus.statistics`。v1の形は次のとおり。

```json
{
  "schemaVersion": 1,
  "conversations": {
    "CONVERSATION_ID": {
      "turnOrder": ["TURN_KEY"],
      "turns": {
        "TURN_KEY": {
          "inputChars": 12,
          "assistantMessageId": "ASSISTANT_ID",
          "outputChars": 34
        }
      }
    }
  }
}
```

許可する保存値はConversation ID、Turn Key、Assistant Message ID、INPUT/OUTPUT文字数、DOM観測順・分岐追跡用のTurn Key順序、およびスキーマ版だけ。未取得の文字数はフィールドを省略する。生成状態、本文、ハッシュ、HTML、Markdown、添付内容、時刻、不要なメタデータは保存しない。Turns・総文字数・集計済みフラグは台帳から導出し、Turn Key順序で累積合計を絞らない。

ストレージ値は読込時と書込前に検証する。未知バージョン・破損データは無確認で置き換えない。書き込みは差分を抑えたデバウンスで行い、失敗時は未保存状態を表示する。保存直前に既存のStorage Lock内で最新Storageを読み、基準スナップショット・保存候補・最新StorageをTurn Key単位で統合する。候補が基準から変わっていない値は最新Storageを使い、両側が同じ値を基準から変更していた場合も既にStorageへ確定した値を優先する。候補だけが変更した値は保存し、後続の最新読込からの訂正を可能にする。既存Turn Keyと別会話の行は削除しない。書込失敗時は保存済みデータを維持し、未保存・エラー状態を表示する。

TurnsはConversation IDごとに`turns`台帳にある、INPUT文字数を計測済みのユニークTurn Key数とする。INPUTが0文字の有効な計測行は1件として数え、IDだけの未計測行は数えない。集計は`turnOrder`でフィルタせず、同一Conversation IDに保存済みの旧分岐行も含める。INPUT/OUTPUT文字数は全保存行から再計算し、同一Turn Keyは1回だけ加算する。`turnOrder`はDOM順・分岐追跡のために保持する。

## 5. 自動集計と初期スナップショット

1. Conversation IDと`main`を確認し、初回DOMからTurn Key順序・Assistant ID・状態だけを取得する。本文は読まず、INPUT/OUTPUT文字数を埋めない。
2. 現在のComposer formに通常の`submit`イベントリスナーを付ける。リスナーは監視だけを行い、`preventDefault`、`stopPropagation`、Composer本文読取、クリック代行をしない。
3. submit後に末尾へ追加された未知Turn KeyにUserマーカーがあれば、その1ターンのINPUT文字数を取得する。履歴スクロール収集は独立した処理経路で行う。
4. 新規ターンが`in_progress`ならINPUTだけ確定し、OUTPUTは未取得にする。`complete`、Assistant ID、本文取得が揃った時点でOUTPUTを確定する。
5. 既知Turn KeyでAssistant IDが変わった場合は再生成とみなし、旧OUTPUTを新しいAssistant IDの値へ置換する。`in_progress`を確認した場合は旧OUTPUTを直ちに未取得へ戻し、生成完了後に新値を記録する。過去のINPUT本文は再取得しない。

同じTurn KeyとAssistant IDの再観測は加算処理ではなく同一行の置換なので二重計上しない。ページ再読込時は新しい初期スナップショットを作り、過去値を再加算しない。

通常スクロールで表示範囲へ入った既存DOMターンも収集対象とする。初期化時にターン要素をIntersectionObserverへ登録し、wheel・touch・スクロール用キー操作によるユーザー意図がある間に可視になった候補だけを計測する。追加DOMは追加部分の候補だけを登録する。画面を開いただけでは過去の本文を読み取らない。`in_progress`や状態不明のAssistant本文は完了出力として確定しない。

## 6. 手動再集計

ユーザーが過去までスクロールした後、「再集計」を押すと、その時点でDOMにあるTurn Keyを重複排除して一度だけ走査する。各TurnのUser本文、Assistant ID、`complete`状態、OUTPUT本文を確認し、保存済み同一ID行を更新し、新しく確認した過去行を追加する。

この操作は履歴を自動スクロールせず、非公開APIを呼ばない。同じ表示範囲を何度再集計しても加算しない。DOMに存在しないだけでは台帳行を削除しない。

空DOMでの再集計は保存済み統計を変更しない。既存の累積Turns・文字数をDOM件数で置き換えず、新しく発見したTurn Keyを追加し、既存Turn Keyの計測値だけを更新する。

### 6.2 全履歴を集計

詳細小窓の「全履歴を集計」は現在DOMを先に計測し、会話ターンを含む祖先から実際に縦スクロール可能な領域を検出する。領域は`main`の外側にある場合も調べ、会話ターンを含まない要素、Composer、body/htmlは操作しない。安全な領域を特定できない場合は現在DOM分だけ保存して部分取得で終了する。

検出した領域を現在位置から過去側の先頭まで段階的に移動し、次に先頭から新しい側の末尾まで進める。各移動後にDOM更新を待ち、その時点のスナップショットを累積保存するため、DOM仮想化で要素が外れても取得済み統計を保つ。1走査は最大240移動または90秒で終了し、停滞、会話切替、パネル破棄、ユーザーのスクロール操作、中止要求でも終了する。中止時・部分取得時も、それまでに保存した行を保持する。

走査開始時のスクロール位置とフォーカスは可能な場合に復元する。ユーザー操作でスクロールが競合した場合や元の領域が無効になった場合、スクロール位置を推測で戻さない。走査終了はChatGPT側の全履歴取得を保証しないため、統計の部分計測表示を維持する。

## 7. 分岐、編集、部分DOM

- `turnOrder`は現在観測できたTurn Key順序のアンカーとして使う。編集でTurn Keyが置き換わった場合、確認済みの直前ターンまでは維持し、置換位置より後ろの未確認行は現在分岐の追跡順から外す。
- 回答再生成はTurn Keyを維持しAssistant IDだけを置換する。同じ行のOUTPUT値を更新し、旧回答を合算しない。
- 古い分岐の台帳行は削除しない。同じConversation IDに計測済みとして保存されていれば、現在の分岐に属するかに関係なく累積Turns・文字数へ含める。
- `turnOrder`は現在のDOM順と分岐変更を追跡するための情報であり、累積合計を絞り込む条件にしない。表示中のDOMが小さくなったり空になったりしても累積値を下げない。
- 保存済み行のINPUTが未取得ならTurnsへ加算せず、取得済みINPUT/OUTPUT文字数だけを合計する。未読込履歴がある可能性や未取得文字数は部分計測として説明する。実際のチャット利用上限を判定できるとは表示しない。

## 8. UI

- メインパネルには同じConversation IDの累積計測Turnsだけ（例: `128 Turns`）をコンパクトに表示する。DOM件数やチャットの実際の利用上限を表す数値ではない。
- ホバーのツールチップは総文字数を示す。未取得範囲があり得る場合は「集計済み総文字数」と表示する。
- クリックでShadow DOM内に小窓を開き、Turns、INPUT文字数、OUTPUT文字数、総文字数を表示する。小窓の最下部に「再集計」と「全履歴を集計」を横並びに置き、走査中は後者を「中止」に切り替える。
- 小窓はComposerの位置と画面サイズに合わせたfixed配置で、原則としてTurns表示の上側に開く。内容部だけをスクロール可能にし、アクションボタンを常に表示する。パネル最小化時は非表示。閉じる操作またはEscapeで閉じる。IME変換、Undo/Redo、文字選択、Composerフォーカス管理には介入しない。
- 未取得、部分取得、走査中のTurns・確認件数、新規計測件数、正常終了・中止・エラー、保存中、保存失敗、未保存の各状態を必要に応じて表示する。統計のためのキー操作やボタンは`type="button"`とする。

## 9. 性能・ライフサイクル

- MutationObserverは現在の`main` subtreeに限り、Turn Key/Assistant ID/DIL ID/状態/Userマーカーの属性と子孫追加・本文変更を監視する。
- 通常変化ではMutationRecordから影響したTurn候補だけを特定する。履歴スクロール収集はMutationObserverで追加候補を登録し、IntersectionObserverで可視候補を維持する。ユーザー操作後の可視範囲処理を間引き、候補計測をデバウンスする。全履歴を集計する操作以外では自動スクロールしない。
- 既知Assistantの本文走査は生成状態/ID変化時、新規末尾ターンの本文走査はsubmit後に限定する。走査以外で会話DOM全体の本文を繰り返し走査しない。
- SPAのConversation IDまたは`main`が変わったら、旧Observer、form submit listener、タイマー、DOM参照を破棄する。監視・保存の失敗はChatGPTの入力や送信を妨げない。

## 10. 既知の制限と受入確認

- DOM属性と表示領域はChatGPTの更新で変わり得る。現在観測した属性は公開APIではない。
- ストリーミング中の`in_progress`から`complete`への実遷移とAssistant IDの出現タイミングは実機未確認。状態変化を検知できない環境ではOUTPUTが未取得のままになる。
- 現在DOMに存在しない履歴は、手動再集計でも取得できない。
- Chrome実機で未確認の項目: 現行ChatGPTで会話本文の実スクロール領域がどの祖先にあり、`main`外側の候補が正しく検出されるか。過去方向・新しい方向それぞれの段階読み込みとDOM仮想化の実際の挙動。生成中にDOMが更新された際の安定待ちと手動スクロール競合時の復元。ポップオーバーとComposerの実画面上の重なり。
- Chrome実機では新規発言、回答完了、F5、SPA遷移、通常履歴スクロール、全履歴走査・中止、再生成、ユーザー編集、分岐切替、入力欄の未送信保持、意図しない送信がないことを確認する。
- 単体試験はDOM fixtureによる観測可能な構造を検証するものであり、ChatGPT実機互換の保証ではない。
