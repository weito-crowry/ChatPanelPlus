# ChatPanelPlus

## 現在の開発版

正式な開発用ロード元は、Chromeに登録済みの次のフォルダです。フォルダを移動・改名したり、拡張機能を再登録したりしないでください。

```text
[USER_WORKSPACE_ROOT]\Documents\src\codexapp\ChatPanelPlus-Content-Probe-20261021
```

このフォルダの0.1.5では、React/Shadow DOMパネル、Service Worker、Optionsページ、会話読み込みをChrome上で確認済みです。旧ID側の障害原因はChrome登録状態・ID・パス要因のいずれかに絞られていますが、根本原因は未特定です。旧IDと診断用フォルダ、各段階バックアップは調査用に保持します。

## ビルドとデプロイ

Node.js 22.12以降、pnpm 10.30.1以降を使います。通常の`pnpm build`は`public/manifest.json`を含む完全なMV3拡張機能を`dist/`に生成します。Optionsページ、ChatGPT用Content Script、Service Workerは既存のVite設定から順にビルドされます。manifestと`package.json`のバージョンは0.1.5で揃え、サイト対象は`https://chatgpt.com/*`のみです。

`pnpm build:noop`は旧来の原因切り分け用無機能版を`dist/`に別生成します。通常ビルドと出力先を共有するため、続けて開発版を使うときは`pnpm build`を実行してください。無機能版は権限・サイトアクセス・実行参照を持ちません。

新IDの登録済みフォルダへ反映する場合は、次を実行します。

```powershell
pnpm deploy:chrome
```

このコマンドは完全版を再ビルドし、manifest・参照ファイル・出力パスを検査します。固定された上記フォルダ以外は宛先にせず、対象とdist内のシンボリックリンクを拒否します。反映前に対象の全ファイルを同じ親ディレクトリの`ChatPanelPlus-Content-Probe-Backup-<時刻>`へ複製し、反映後にdistとのファイル名・SHA-256一致を確認します。失敗時はバックアップから対象フォルダを復元します。Chromeの起動、登録変更、再読み込みは行いません。

反映後はユーザーがChromeで`chrome://extensions`を開き、ChatPanelPlusカードの再読み込みボタンを手動で押してください。Chrome実機での最終確認も手動で行います。

## 検証

```powershell
pnpm check:size
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

テストは通常ビルドのmanifest参照、最小権限、Content Script/Options/SW出力、余分なファイルの不在を確認します。`build:noop`の検査は一時ディレクトリ内で独立して行います。サイズ制限は手書きコード等1ファイル当たり500物理行かつUTF-8で32 KiBです。

## ソース構成

```text
public/manifest.json       通常開発版のManifest
scripts/build-noop.mjs    無機能診断版のビルド
scripts/deploy-chrome.mjs 固定された新IDフォルダへのバックアップ付き反映
options/                  Optionsページ
src/content/              Shadow DOM内のReactパネル
src/background.ts         Service Worker
src/shared/               共有設定スキーマ
tests/                    ビルドと設定スキーマのテスト
vite.config.ts            Optionsページのビルド
vite.config.content.ts    Content Scriptのビルド
vite.config.background.ts Service Workerのビルド
dist/                     Chrome拡張機能のビルド成果物
```
