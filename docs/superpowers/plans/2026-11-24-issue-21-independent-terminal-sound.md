# Issue #21 独立したCodex監視終了音

## 要件

- ChatGPT回答完了音とCodex監視終了音の有効状態・音源・音量・選択音試聴を独立させる。
- 共通のカスタム音源ライブラリ、単一出力先、再生経路を再利用する。
- ChatGPT回答完了音の再生・会話別ミュート経路を変えず、Codex側だけ専用設定へ切り替える。
- Codexの初期値は無効・`two-tone`・60%。schema 1を維持する。
- Codex設定の各未設定項目は対応する旧ChatGPT設定の正規値から補完する。保存またはJSON export後はCodex値が明示され、ChatGPT設定から独立する。
- 共通音源を削除する前に保存済み両選択を必要な分だけ既定音へ保存する。両UIドラフトも同じ音源を選択中なら該当欄だけリセットする。読込・保存失敗時は削除しない。
- 終端eventの重複防止、mute/owner guard、初回既終了状態と手動監視解除の非通知、音量0・OFF・音源欠落の意味を維持する。

## 変更順序

1. 設定schema/default/validator/JSONとrepository競合経路のテストを追加する。
2. Codex通知の専用設定、ChatGPT側からの独立、OFF・音量0・欠落音源・mute/owner guardのテストを追加する。
3. Optionsの2通知UI、共通ライブラリ/出力先の単一表示、両保存値/ドラフトを考慮した音源削除テストを追加する。
4. 最小変更でschema/repository、通知、Optionsを実装し、既存ChatGPT完了音・終端判定経路を保持する。
5. C51受入手順を追加し、自動検証を行う。Chrome受入はユーザー実施のためNOT_RUNとする。

## 検証

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 受入制約

- 出力デバイスは現行の単一選択のままとし、Issue #20の複数デバイス化は含めない。
- 自動送信、音声自動承認、会話別ミュート意味の変更、Codex終端判定変更を含めない。
- Chrome reloadや実機操作は行わない。C48/C49/C50の既存記録は保持する。
