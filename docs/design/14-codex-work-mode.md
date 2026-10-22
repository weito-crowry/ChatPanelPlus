# Codex作業中モード

- 文書ID: CPP-DESIGN-14
- 状態: 実装済み（自動検証済み・Chrome実機確認待ち）
- 改訂日: 2026-10-22
- 依存: `00-architecture.md`、`05-settings-storage.md`、`06-options-page.md`、`08-lifecycle.md`、`09-testing.md`、`13-answer-completion-sound.md`
- 目的: ChatPanelPlus上で、ユーザーが手動で設定した「Codex作業中」状態を明確に表示・切り替え・保持する。

## 1. 機能の位置づけと初版の方針

Codex作業中モードは**Codexの実稼働状態を検知する機能ではなく、ユーザーが手動で切り替える表示モード**である。ONは「利用者がCodex作業中と表示するよう指定した」ことのみを意味し、プロセス、スレッド、ジョブの実際の状態を保証しない。

初版の実装仕様は以下のとおりとする。状態は同一Chromeプロファイル内で共有し、ブラウザ再起動後も復元する。

| 項目 | 初版の設計方針 |
| --- | --- |
| 切替 | ChatPanelPlusパネル内の手動ON/OFFのみ |
| 共有範囲 | **同一ChromeプロファイルのChatGPTタブ間で共有** |
| 保存期間 | **ブラウザ再起動後も復元**。手動でOFFにするまでONを保持 |
| 保存先 | `chrome.storage.local`の独立した`chatPanelPlus.codexWorkMode`キー |
| 初期値 | 未保存の場合はOFF |
| 展開時UI | パネルのヘッダー領域にコンパクトなトグルを置く |
| 最小化時UI | 最小化中も確認・切替できるコンパクトなトグルを残す |
| 回答完了音 | モードに連動させず、既存設定に従って独立動作 |
| 設定JSON | import/exportに含めない |
| 接続・権限 | 外部連携なし。Chrome権限追加なし |

### 対象外

- CodexBridge、Codex App、プロセス、スレッド、ジョブとの通信・状態同期
- Codexの稼働自動検出、会話・作業内容の読取、外部ネットワーク通信
- ChatGPTへの自動送信、承認操作の自動化、Composer編集への介入
- ページ全面オーバーレイや、既存ChatGPT操作を遮断する表示
- タブごとの独立状態、セッション終了時の自動OFF、自動タイムアウト

## 2. UI・操作仕様

### 2.1 展開時

- パネルのヘッダー領域に「Codex作業中」の手動切替ボタンを1つ設置する。タイトルと会話統計表示を妨げない寸法・配置とする。
- 現在値をON/OFFの文字で示し、補助的にアイコンまたは控えめな色を使う。色だけで状態を区別しない。
- 操作要素は`button`を基本とし、`aria-pressed`で現在の押下状態を公開する。
- ラベル・`title`・アクセシブルな説明のいずれかで「手動表示」であることを明示する。「Codex接続済み」「実行中を検知」などの誤解を与える文言は使わない。
- クリック、Enter、Spaceで切り替えられ、フォーカスの可視性を維持する。

### 2.2 最小化時

- 現行のパネルでは`.panel-content`が最小化時に非表示になるため、**その内部だけに切替UIを置かない**。
- 最小化時は既存の復帰ボタンに隣接するコンパクトな「Codex ON / OFF」切替を`.panel-content`の外側に置く、または同等の可視構造で提供する。
- 最小化時にも状態の確認と切替を可能にする。復帰操作とCodex切替操作は別ボタンとし、誤って一緒に起動しない。
- 展開時と最小化時のトグルを同時に二重表示・二重フォーカスさせない。両方は同一状態を参照する。
- 狭い画面ではChatGPTのComposerや送信操作を塞がないようサイズ・配置を調整し、既存の最小化・復帰操作を維持する。

### 2.3 ロード・失敗時

- 保存値の読み込みが完了するまでON/OFFを確定表示せず、「確認中」相当の表示とし、誤った値の書込みを防ぐ。
- 読込・書込エラーは利用者に分かる範囲で通知する。書込み失敗を保存成功として扱わない。
- 不正または未知バージョンの保存データを自動的にOFFで上書きしない。状態を不明として扱い、再試行または明示的な初期化の導線を用意する。

## 3. 保存データ・同期

### 3.1 既存キーから分離する理由

現行の`settings-repository.ts`における`saveViewState()`は、`chatPanelPlus.viewState`へ`selectedTabId`と`minimized`のオブジェクト全体を書き込む。さらに`Panel.tsx`は保存時にこの2項目を渡している。

そのため、既存の`viewState`へ単に`codexWorkModeEnabled`を追加すると、タブ選択・最小化・レイアウト初期化などの既存経路によって新しい値が消える危険がある。初版では既存Repositoryの全書込経路を改修せず、**専用キーへ保存する**。

- `chatPanelPlus.config`: 既存の設定。変更しない。
- `chatPanelPlus.viewState`: 選択タブ・最小化。変更しない。
- `chatPanelPlus.statistics`: 会話統計。変更しない。
- `chatPanelPlus.codexWorkMode`: 本機能専用の状態。

この分離により、既存のレイアウト初期化、設定JSONのimport/export、会話統計の更新が本モードを上書きしない設計とする。

### 3.2 保存スキーマ

Storageキー: `chatPanelPlus.codexWorkMode`

```json
{
  "schemaVersion": 1,
  "enabled": true
}
```

- `schemaVersion`は数値の`1`、`enabled`はbooleanのみを有効とする。
- キー未存在時は`enabled: false`として読み込む。初回表示時にOFF値を自動書込みする必要はない。
- オブジェクト形式でない値、型不一致、未知バージョンは読み込みエラーとし、元データを暗黙に置換しない。
- モード値は現在の会話ID、タブID、DOM位置には紐付けない。
- エクスポート対象の設定本体ではなく、パネルの運用状態として扱う。

### 3.3 Repository責務

- 本機能専用の小さなRepositoryまたは責務分離されたAPIで、読込・保存・購読・解除を提供する。
- `chrome.storage.local.get/set`および既存の`chrome.storage.onChanged`を利用し、新しいChrome権限は追加しない。
- `storage.onChanged`で`areaName === 'local'`かつ対象キーの変更だけを受け取り、別タブの切替を反映する。
- 購読を先に確立してから初期読込を行う。読込中に変更通知を受けた場合は、後から到着した古い初期読込結果で最新状態を巻き戻さない。
- 同じキーへのほぼ同時の複数タブ書込みは、Chrome Storageが原子的比較交換を提供しないため**最終的な保存値が優先される（last-writer-wins）**。厳密な順序保証を実装済みと主張しない。
- 保存完了前に永続化成功を表示しない。書込失敗時には保存済みとみなさず、再試行できるようにする。
- 書込み中の連打、自己発行変更通知、他タブからの変更が矛盾した表示や無限保存ループにつながらないよう制御する。
- 購読リスナーはパネルのアンマウント時に解除する。必要以上のポーリングや新規document-wide `MutationObserver`を追加しない。

### 3.4 初期化と既存設定の互換性

- この機能の追加で`chatPanelPlus.config`のschemaVersionを変更しない。
- 既存`viewState`の形式や、`saveViewState()`・`resetViewState`相当の動作を変更しない。
- 「レイアウトをデフォルトに戻す」は本モードに作用しない。本モードのOFF操作はパネルから行う。
- 既存設定のJSON export/importは本モードを含めず、インポート時も本モードを変更しない。
- Chromeプロフィール内の複数ChatGPTタブで値を共有する。ただし、異なるプロフィール・別ブラウザ間での同期は保証しない。

## 4. 回答完了音との独立性

- 回答完了音の設定`answerCompletionSoundEnabled`は既存の`chatPanelPlus.config`で管理する。
- 本モードのON/OFFを理由に、回答完了音を自動的に停止・再開・設定変更しない。
- 回答完了イベントの判定、音声再生、再生成の扱いは`13-answer-completion-sound.md`を正とする。
- 本モードは会話統計の計測・保存・履歴走査にも影響しない。

## 5. UI実装と責務境界

- Reactパネルは現在のモード状態とユーザー操作を表示・中継する。Storage APIの詳細をUI要素内へ直接埋め込まない。
- 現行`Panel.tsx`の`viewState`（選択タブ・最小化）は維持し、Codexモードを別状態として管理する。
- 展開時／最小化時とも同一の状態ソースと切替処理を使う。
- ChatGPTのDOM探索、Composer・送信操作、会話統計Controllerへの変更は行わない。
- 音声機能・画面監視・既存パネルのアンマウント処理と競合しないよう、独立した購読とクリーンアップを実装する。
- UIの追加による`Panel.tsx`の500物理行／32KiB制限に注意し、必要なら責務ごとに小さなコンポーネントへ分割する。無関係な再構築はしない。

## 6. テスト仕様

単体・統合テストに最低限、次を含める。

1. 未保存データはOFFになり、読込みによって新しいキーを書き込まない。
2. ON/OFFの保存・再読み込みで同じ状態を復元する。
3. 旧`chatPanelPlus.viewState`の値を変更せず、既存設定と会話統計も維持する。
4. タブ切替、最小化／復帰、レイアウト初期化、設定JSONのimport/exportがモード状態を変えない。
5. 異なるChatGPTタブに相当する複数Repository間で変更通知が反映される。
6. 初期読込と変更通知が競合しても、古い読込値で最新状態を上書きしない。
7. 複数タブの競合書込時は、最終保存値に収束する。CAS相当の厳密な競合解決を保証したテストにはしない。
8. 不正値・未知バージョン・Storage読込失敗・保存失敗を安全に処理し、既存データを自動上書きしない。
9. 連打や自己変更通知によって無限保存・不必要な再描画を起こさない。
10. トグルの`aria-pressed`、キーボード操作、フォーカス可視性を検証する。
11. 展開中と最小化中で状態が一致し、最小化・復帰ボタンを阻害しない。
12. 回答完了音の設定と本モードのON/OFFが互いの状態や動作を変更しない。
13. SPA遷移、F5、再マウント後に保存状態を復元し、リスナーの多重登録・解除漏れを起こさない。
14. `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm check:size`が成功する。

### Chrome実機で確認する項目

- 展開・最小化・狭いウィンドウでの表示、Composerや送信ボタンとの非干渉
- キーボード操作、スクリーンリーダー向けの状態説明
- 複数のChatGPTタブ間の切替反映、F5、SPA遷移、ブラウザ再起動後の復元
- 回答完了音が有効な場合でもモードの切替で音が変化しないこと
- エラー時の通知が既存パネル操作を妨げないこと

自動テスト成功だけでChrome実機検証を完了扱いにしない。

## 7. 実装手順と受入条件

1. 専用Storageスキーマ、バリデータ、Repositoryと同期テストを用意する。
2. 表示・操作コンポーネントを分離し、展開時と最小化時の配置を実装する。
3. `Panel.tsx`のライフサイクルに統合するが、既存`viewState`と会話統計は変更しない。
4. UI・Storage・複数タブの回帰テストを実行する。
5. 自動検証後、ユーザーが行うChrome実機確認項目を列挙して報告する。

受入条件：

- 手動ON/OFFを展開・最小化の双方で操作できる。
- 同一Chromeプロファイル内のChatGPTタブで表示状態が揃う。
- ブラウザ再起動後も値が復元され、未保存時はOFFである。
- タブ選択・最小化・設定の初期化・会話統計の保存でモード値が失われない。
- 回答完了音の設定・実際の完了イベント処理に干渉しない。
- 新規権限・ネットワーク通信・Codex実稼働検知を追加しない。
- 指定の自動検証に合格し、実機未検証事項を別に報告する。

## 8. 実装状況・検証記録

本設計の手動表示、プロファイル共有、保存、失敗時の扱いを実装した。Codexの実稼働検出や外部連携は含まない。

- Repository: `src/shared/codex-work-mode-repository.ts` が専用キーの検証・読込・書込・変更購読を担当する。
- Controller: `src/content/codex-work-mode-controller.ts` が初期読込とStorage変更の競合、再試行、明示的なOFF初期化、保存中状態、購読解除を管理する。
- UI: `src/content/CodexWorkModeToggle.tsx` と `src/content/codex-work-mode-presentation.ts` が展開・最小化で共有する単一トグルと通知を表示する。
- テスト: `tests/codex-work-mode.test.ts`、`tests/codex-work-mode-controller.test.ts`、`tests/codex-work-mode-presentation.test.ts`、`tests/codex-work-mode-ui.test.mjs`。
- 実装は既存の `chatPanelPlus.config`、`chatPanelPlus.viewState`、`chatPanelPlus.statistics`、設定JSONの形式、回答完了音の設定を変更しない。
- `chrome.storage.local` の同一キーに複数書込みが競合した場合、Chrome Storageの最終保存値へ収束する。CASによる厳密な競合順序は保証しない。

### 自動検証結果（2026-10-22）

- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm check:size`: PASS（93ファイル、各500行・32KiB以内）
- `pnpm test`: PASS（285 tests、失敗0。拡張全体のビルドを含む）
- `pnpm build`: PASS（Options、Content Script、Service Worker）
- Codex作業モード対象テスト: PASS（Repository／Controller／表示15件、UI 2件）

### 実機確認待ち

Chrome実機で次を確認する。自動テストやビルド結果を実機確認の代わりにしない。

- 展開・最小化・狭いウィンドウでの表示とComposer／送信操作への非干渉
- キーボード操作、フォーカス表示、スクリーンリーダー向け状態説明
- 複数ChatGPTタブ間のStorage変更、F5、SPA遷移、ブラウザ再起動後の復元
- 回答完了音の有効・無効それぞれで、モードを切り替えても音の動作が変わらないこと
- 保存・読込失敗時の通知と既存パネル操作
