# 回答完了音

- 文書ID: CPP-DESIGN-13
- 状態: 初版
- 依存: 00-architecture.md、05-settings-storage.md、06-options-page.md、08-lifecycle.md、09-testing.md、12-conversation-statistics.md
- 目的: ChatGPTの回答生成完了を、ユーザーが有効にした場合だけ短い音で知らせる。

## 1. 対象と設定

- Optionsの「回答完了音」で有効・無効を切り替え、既存の設定保存・JSON import/export経路を使う。
- 初期値は `false`。既存のschemaVersion 1設定で項目が欠けている場合も `false` として扱う。これは既存設定を読み込める追加項目であり、schemaVersionは変更しない。
- Manifestの権限は追加しない。設定保存には既存の `storage` 権限を使う。
- 音声はChatGPTページ内のWeb Audio APIで短い合成音を再生する。AudioContextは音が有効な間だけ保持し、ChatGPTページ上のユーザー操作を受けて作成またはresumeする。操作前、ブラウザが停止中、またはAPIが利用できない場合は鳴らさず、操作・表示を妨げない。

## 2. 完了イベントの判定

- `data-turn-key`、`data-chatgpt-selection-message-id`、`data-talvt-turn-state` を使う既存の会話統計DOM識別だけを利用する。本文、本文ハッシュ、時刻、音声イベント履歴は保存しない。
- Conversation Statistics Controllerが初回の会話識別情報を読み込む時点で、各Turnの基準状態を無音で登録する。初回DOMに存在する `complete` は通知しない。初回に `in_progress` だった回答は生成中として追跡するが、後続の `complete` を観測するまでは通知しない。
- 基準化後、同一Turn Keyが `in_progress` になったサイクルを記録する。その後 `complete` と有効なAssistant Message IDを確認したときだけ完了イベントを発行する。最初の `in_progress` が後からDOMに現れたTurnも追跡できる。
- 完了イベントを1回発行したサイクルは閉じる。同じDOM更新の反復では再通知しない。次の `in_progress` が観測された場合は同じTurn Keyでも新しいサイクルとして扱う。
- `unknown`、Assistant ID欠落、ID変更だけで `in_progress` を観測していない場合は通知しない。完了時点でIDがまだ欠落している場合は保留し、同じサイクルで `complete` とIDの両方を識別できた後だけ通知する。
- 初回基準化、F5、SPA遷移、それだけで行う再集計・過去履歴の描画は通知理由にしない。初回表示時に進行中の回答は後続完了で通知する。再生成は実行中状態を観測できた場合に限り、別サイクルとして扱う。
- 重複抑止の状態は各ページDocument内のメモリだけに置く。初版では複数のChatGPTタブをまたぐ一回限りの通知制御は行わない。

## 3. 監視と責務

- 既存のConversation Statistics Controllerが初回識別情報とObserverの候補Turnを追跡器へ渡す。新しいdocument-wide MutationObserverは作らない。
- 完了サイクル判定は専用の純粋な追跡器に分離し、音声出力は別のPlayerに分ける。統計保存値、Turn集計、Conversation切替処理は変更しない。
- 統計UIの表示状態やパネル最小化状態は、音声の有効状態に影響させない。設定変更は現在開いているContent Scriptへ反映し、無効化後のイベントは再生しない。
- Observer、設定購読、ユーザー操作リスナー、AudioContextはContent Scriptの停止・再マウント時に解放する。

## 4. 検証と受入条件

- schema 1の旧設定を読み込めて、音の既定値が無効である。値の型が不正なら設定全体の保存を拒否する。
- Optionsから有効・無効を変更し、保存、再読込、JSON export/import後にも値が保たれる。設定の競合マージと既知フィールド初期化も値を失わない。
- 初回表示済み回答、F5・SPA遷移だけの変化、未知状態、IDなし、`in_progress`を観測しないID変更、同じ完了状態の反復では鳴らない。初期 `in_progress` は、その後の `complete` を観測したときだけ鳴る。
- 基準化後に観測した `in_progress` → `complete` は1回鳴る。同一Turn Keyで次の `in_progress` → `complete` を観測できた再生成はもう1回鳴る。
- 有効な完了イベントを設定OFF時に受けても再生せず、UI、Composer、送信処理へイベントを伝播・抑止しない。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm check:size`を実行する。Chrome実機の自動再生制約と実音は手動確認事項として別に報告する。

## 5. 実装上の制約

- Web Audioの利用可能性や自動再生許可を既成事実としない。Contextのresumeに失敗した場合は例外を表へ出さず無音で継続する。
- Web Audioの短い合成音を用い、音声ファイル取得、Offscreen Document、背景通信、通知API、追加権限は導入しない。
- 生成完了を既存DOM状態から確定できない場合は推測で通知しない。
