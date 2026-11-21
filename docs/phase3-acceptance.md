# Phase 3 — 会話別パネル状態と音声ミュート

## 自動受入結果

- 状態: **自動検証PASS／Chrome実機確認DEFERRED**。実機項目はPhase 5後の統合チェックリストに集約する。
- 基準: Phase 2 全テスト501/501 PASS。Phase 3変更後は隔離コピーで `pnpm test` を実行し、518/518 PASSを確認した。
- `pnpm typecheck`: PASS。`pnpm lint`: PASS（サイズ検査を含む）。
- 全テストはrepoの `dist/` を除外した一時コピーで実行し、`node_modules` のみrepoからリンクした。実行前後でライブ `dist/` の11ファイルの相対パス・サイズ・SHA-256が一致した。
- Phase 3実装コミット: `132218761d66a566c1e91d2831a5d292ffa6aa74`。
- 登録済みrepo直下 `dist/` へ `pnpm build` で直接配備。終了コード0、Manifest V3/version `0.1.5`、必須6ファイル、manifest/HTML参照、Phase 3ミュートUI文字列を確認した。配備後11ファイル。
- 配備前にrepo兄弟 `ChatPanelPlus-dist-phase3-predeploy-backup-20261121-115030-360-81eb8352` へ全ファイルを複製し、11ファイルの相対パス・サイズ・SHA-256一致を確認。照合用一覧も兄弟の `.sha256.txt` に保存した。
- ビルド後もbranch/HEADは不変、Git clean。Chromeの再読み込み・操作は行っていない。

## 変更した保存境界

- `chatPanelPlus.viewState` は読み書きせず、そのまま保持する。自動移行・削除は行わない。
- selected tab、最小化、Bridge詳細展開を、versioned `chrome.storage.local` の会話ID別状態へ保存する。同じ会話を開く複数Chromeタブは共有し、別会話は分離する。conversation ID不明時は読込・保存しない。
- 会話別表示状態は変更項目だけを更新し、Web Locksが使えるChromeでは複数タブのread-modify-writeを直列化する。外部storage変更は同じ会話だけ反映し、SPA遷移後の古い非同期読込は破棄する。
- 音声ミュートはbackground所有の `chrome.storage.session` にChrome `tabId`＋検証済みconversation IDで保存する。同じ会話の別Chromeタブも別ミュート状態を持ち、タブ終了時にそのタブの値を整理する。
- パネルの共有音声有効化操作と会話別ミュート操作を分離した。音量、音色、出力デバイス、音源assetのOptions設定には変更を加えていない。
- 回答完了音の通常経路はイベント時conversation IDと現在routeを照合する。既定出力は再生直前のmute revisionを照合し、Offscreen出力はbackgroundでmute確認と再生開始を直列化する。mute状態が取得できない経路では音声をskipする。
- Codex作業中モードの既存tab＋conversation保存契約、Bridge監視処理、MCP APIは変更していない。Bridge owner muteとの接続はPhase 4対象。

## 保留・実機で未確認

- 通常回答完了イベントでconversation IDを取得できない場合、音を鳴らすかどうかは未決定。実装では会話別muteを適用せず既存経路を保っているが、仕様確定とは扱わない。
- Optionsの「既定値に戻す」が新しい会話別表示状態へ及ぼす範囲は未決定。現状のOptions reset挙動を変更していない。
- Chrome再読み込み後の状態復元、SPA遷移、複数会話／複数タブの表示とミュート分離、既定／Offscreenの実音声、タブ終了後のsession整理は自動テストのみ。最終チェックリストで実機確認する。
- Chrome実機受入結果は **NOT_RUN**。個々の手動確認をPASSとは記録しない。

## 手動受入項目

- [ ] 同一会話の再読込と複数タブで選択タブ・最小化・Bridge詳細状態が共有される。
- [ ] 別会話へ移動すると表示状態が分離され、SPA遷移・再読込後に各会話の状態が復元される。
- [ ] 同一会話を別Chromeタブで開いた場合、ミュート状態はタブ間で独立する。
- [ ] 共有回答完了音ON/OFF・音量・音色・出力先は既存のブラウザ共通設定として維持される。
- [ ] ミュート切替直後の回答完了音、既定出力と選択デバイス出力、SPA切替中の完了通知を確認する。
- [ ] タブ終了後にミュート値が整理され、Codex作業中モードの状態に影響しない。
