# Codex作業中モード

- 文書ID: CPP-DESIGN-14
- 状態: 設計案（未実装。UI・状態範囲の選択は実装着手前に確定する）
- 依存: 00-architecture.md、05-settings-storage.md、06-options-page.md、08-lifecycle.md、13-answer-completion-sound.md
- 調査基準: ChatPanelPlus の回答完了音実装時点、および CodexBridge の HEAD `2a0e18817db1051fd7bcb5a069b69cb67e916229`
- 目的: ChatPanelPlus 上でユーザーが Codex 作業中であることを手動表示する機能の責務と、将来の連携境界を定める。

## 1. 位置づけ

Codex作業中モードは、ユーザーが手動で切り替える表示状態である。Codexプロセス、スレッド、実行状態を検知または保証するものではない。UIでは「Codex作業中（手動）」のように、手動で申告した状態だと分かる表現を用いる。

初期範囲に含めるのは、ChatPanelPlusパネル上の切替と状態表示、状態の保存だけとする。CodexBridgeへの接続、プロセス監視、スレッドの列挙、会話内容・活動の読取、外部通信、自動検出は含めない。既存の全体アーキテクチャがCodex連携の実機能を対象外としている範囲を越えず、将来連携の責務境界だけを示す。

## 2. 推奨UI案

- パネル内に「Codex作業中」切替を1つ置き、現在のON/OFFを同じ領域で示す。
- ON時はラベルと控えめな色・アイコンを併用する。色だけで状態を表さず、スクリーンリーダーからも状態を取得できるようにする。
- パネルの既存操作・Composer・送信挙動を変更しない。ChatGPTのページ全面を覆うオーバーレイは初版案に含めない。
- ONは「Codexが実際に稼働中」という意味を持たせない。ユーザーがモードをOFFにするまで、表示状態を維持する。
- パネル最小化中に状態を表示する場所と、切替をヘッダー・設定画面のどちらに置くかは、実装前にUI配置として選択する。初版候補はパネルヘッダー内のコンパクトな切替である。

## 3. 状態保存案

既存の設定本体 `chatPanelPlus.config` はレイアウトや回答完了音などの設定に使われ、ビュー状態は `chatPanelPlus.viewState` に分離されている。Codex作業中はレイアウト設定ではなく操作状態なので、保存する場合は `viewState` に `codexWorkModeEnabled: boolean` を追加する案を推奨する。未設定の旧データはOFFとして扱い、設定JSONのimport/exportには含めない。

状態の共有範囲は未確定であり、次の二案がある。

| 案 | 保存と見え方 | 向く使い方 |
| --- | --- | --- |
| ブラウザ全体で共有 | 既存の `chrome.storage.local` のビュー状態に保存し、ChatGPTを開く全タブで共有。ブラウザ再起動後もONを復元する | Codex作業中をブラウザ全体のモードとして使う |
| タブごと・ブラウザ終了まで | タブ固有状態またはセッション限定の保存を使い、他タブへの反映と再起動後の復元を避ける | ChatGPTタブごとに作業状態を分ける |

現行のビュー状態Repositoryはlocalストレージに単一キーを保存するため、グローバル案は既存経路を最も再利用しやすい。一方、再起動後もONになる挙動が意図に合うかは製品判断が必要である。状態範囲は実装時に確定し、配列順やDOM位置をタブ識別子の代わりに使わない。

## 4. 回答完了音との関係

回答完了音の有効・無効は独立設定のままにする案を推奨する。Codex作業中への切替で音を暗黙に停止・再開させず、音の設定が有効なら、回答完了音の設計で定めたイベント判定に従う。モードによる音の自動抑制を加える場合は、切替状態と音設定の優先順位を別途決める必要がある。

## 5. CodexBridgeとの責務境界

CodexBridgeはCodex App Serverとの会話・実行を仲介し、スレッド状態、承認・入力要求、活動情報を扱う。ChatPanelPlusはChatGPTページ上の手動モード表示を担当する。この二つの責務を混同しない。

調査時点のCodexBridgeは、MCP向けStreamable HTTP経路と、デスクトップConsole向けloopback UI APIを別に持つ。現在のthread status応答には状態だけでなく、thread/turn識別子、最新のAgentメッセージ、差分、保留要求、エラー、最近の活動が含まれる。活動イベントにもthread/turn/item識別子、summary、detailsがある。したがって、既存status APIをChatPanelPlusの表示用状態源としてそのまま読む設計は採らない。

将来、ユーザーがBridge連携を明示的に希望した場合に検討できるのは、Bridgeが別途提供する最小の状態契約である。たとえば `available` と正規化済みの `in_progress | needs_input | needs_approval | completed | interrupted | failed` だけを返すread-only状態APIをBridge側で設計する。メッセージ本文、diff、認証・承認材料、活動details、ローカルパス、スレッド識別子を拡張へ返さない。Bridge側にその契約がない間、ChatPanelPlusが既存APIを推測で読み替えない。

CodexBridgeの現在のGET status/eventsルートは、shutdown/approvalなどの制御ルートと同じBearer token検査を行わない実装であり、loopback bindとHost制限はあるものの、ChatPanelPlusから既存の内容を取得する根拠にはならない。ChatPanelPlusは制御要求を発行せず、承認・ユーザー入力への回答、スレッド作成・継続・中断、Codexプロセス操作を行わない。

## 6. 権限・接続案

| 段階 | 必要な権限 | 方針 |
| --- | --- | --- |
| 手動切替・保存 | 現行の `storage` 権限 | 追加権限なし。Bridgeやネットワークには接続しない |
| 将来のloopback状態連携 | Service Workerからのfetch用に、ユーザーが選んだ `http://127.0.0.1:<port>/*` へのoptional host permissionを要求する案 | 実際のBridge契約・ポート設定が定まった後に別設計する。`<all_urls>`やChatGPTページ上のContent Scriptからの直接fetchは使わない |
| Native Messaging案 | `nativeMessaging` と、拡張IDを許可するNative Host登録 | 現行CodexBridgeにその接続アダプターはなく、初版では選択しない |

Chrome拡張Service Workerから別オリジンへfetchするにはhost permissionが関わり、Content ScriptのfetchはChatGPTページのオリジン制約を受ける。host permissionは対象を絞り、必要時にoptional権限として要求する。Native Messagingを選ぶ場合はホスト登録・許可origin・新権限が必要になるため、既存構成を流用できるとはみなさない。

参照したChrome公式資料: [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)、[Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)、[Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。CodexBridgeの責務・API形状は調査時点のREADMEと実装に基づく。

## 7. 実装に入る前の選択事項

1. 状態を全ChatGPTタブで共有し、ブラウザ再起動後も復元するか、タブまたはブラウザセッションに限定するか。
2. 切替をパネルヘッダーに置くか、Optionsに置くか。最小化中にも状態表示・操作を可能にするか。
3. 回答完了音をモード中も独立設定どおりに鳴らすか。推奨案は独立動作。
4. 将来のBridge連携を行う場合、Bridge側に最小のread-only状態契約を追加するか。これは本書の初版実装範囲外。

## 8. 将来実装時の確認項目

- 旧viewStateに項目がない場合はOFF、値が不正な場合の既存状態復旧を既存Repositoryの契約に合わせてテストする。
- 複数タブ同期を選ぶ場合、ストレージ変更通知で状態が揃うことを確認する。
- 手動モードON/OFF、最小化、SPA遷移、F5、パネル再マウント後の表示を確認する。
- 回答完了音設定とモードの組み合わせを確認し、どちらかの切替が他方を意図せず変更しないことを確かめる。
- Chrome実機でのみ確定できるパネル表示と、将来のloopback通信権限・ローカルネットワーク挙動を自動テスト結果と分けて記録する。
