# C50 最終回答自動反映テンプレート — Chrome受入手順

Issue #22。C47の会話別ONを保ったまま、監視対象終了時に最終回答を共通テンプレートへ一度だけ展開して入力欄の未送信下書きへ追記できることを確認する。

## 受入条件

- Optionsの「自動反映」に複数行テンプレート欄、正式トークン`##Codex最終回答##`の説明、例文プレビュー、既定値復元がある。
- 既定値はトークン単独。schema 1の旧設定やtemplate未設定JSONも同じ既定値へ正規化する。
- テンプレートは8,192 UTF-16 code units以内で、正式トークンを1個以上含む。欠落・型不正・上限超過は保存・JSON importで明示拒否する。C37の最終回答取得上限256 Ki UTF-16 code unitsは従来どおり。
- 固定文はtokenの前後へ置ける。複数tokenは全出現を一回だけ置換し、最終回答内にある同名tokenと`$&` / `$1`などは文字列として残す。改行・Markdown・記号・空白を正規化しない。
- 各eventは、確定回答を取得した後、append直前に共通設定を一度読み込む。その時点の正規化済みtemplateを使い、queue中または回答取得中に保存された変更を反映する。会話・owner eligibilityを読み込み完了後にも確認し、同期appendとの間に別のawaitを置かない。
- 設定読込失敗または不正値は可視の失敗として表示し、入力欄を変更しない。最終回答未確定・空・取得失敗でも挿入しない。
- 既存draft・選択範囲・添付保護、会話owner、ON/OFFと有効化時刻、順次処理、重複抑止、手動copy/insertを維持する。送信・Enter・送信ボタン・自動承認を行わない。

## 実機手順

1. ユーザーがChromeの既存登録済みrepo直下`dist/`を拡張機能画面からreloadし、対象ChatGPTページをF5する。Chrome操作は手動で行う。
2. Optionsの「自動反映」を開き、既定値がtoken単独であること、説明とサンプルプレビューが表示されることを確認する。
3. 例として「Codexのタスクが終了しました。\n安全側に傾きすぎないように作業を進めてください。\n##Codex最終回答##」を入力して通常の「保存」を押す。Optionsを再読込し、設定が維持されること、JSON exportにtemplateが含まれることを確認する。
4. 「テンプレートを既定値に戻す」を押し、通常の「保存」を押す。token単独へ戻り、exportにもtoken単独が含まれることを確認する。
5. tokenをすべて消した値で保存・JSON exportを試す。明示エラーが表示され、保存されずexportも開始しないことを確認する。tokenなしのtemplate fieldを含むJSON importも拒否され、適用可能なimport previewにならないことを確認する。template fieldのない旧JSONは既定tokenへ正規化される。
6. テスト用のCodex threadと専用会話でC47をONにし、新しい終了eventを発生させる。空欄へ固定文と確定最終回答がtemplateの位置に反映されること、送信されず入力欄に残ることを確認する。
7. 既存draftがある状態でも試し、文末へ追記されて既存本文・選択範囲を置換しないことを確認する。複数token、最終回答内の同名token、`$&` / `$1`、改行・Markdown・末尾空白を含む検証用template/回答を使い、置換が一回であることを確認する。
8. 同じ会話の複数eventを処理中にtemplateを保存変更し、各eventがappend直前に読み込まれた設定を使うことを確認する。読み込み中またはqueue待ちの変更を安全に作れない場合は`NOT_RUN`とする。
9. C49のA/B会話を用い、C47自動反映が有効な会話だけに反映されること、別会話へSPA遷移した古いeventが混ざらないことを確認する。最終回答なし・未確定・取得失敗は挿入されず、既存の手動copy/insertは従来どおり使えることも確認する。
10. 設定読込失敗を安全に再現できる場合、可視エラーと未挿入を確認する。永続configを壊す方法しかない場合は無理に実施せず`NOT_RUN`とする。

会話本文、最終回答本文、thread ID、秘密値を受入記録へ転記しない。C48のChrome受入結果は従来どおり`NOT_RUN`、C49の限定3項目PASSと残項目はC49専用記録のまま扱う。

## 実機受入記録

| 項目 | 判定 | 観測範囲 |
|---|---|---|
| Options欄・説明・プレビュー・既定値復元 | NOT_RUN | Chromeで未確認。 |
| 保存・export・旧JSON import互換 | NOT_RUN | Chromeで未確認。 |
| token欠落の保存/import拒否 | NOT_RUN | Chromeで未確認。 |
| prefix/suffix・複数token・本文内token・`$`・空白/改行保持 | NOT_RUN | Chromeで未確認。 |
| 確定最終回答のtemplate反映と未送信状態 | NOT_RUN | Chromeで未確認。 |
| 既存draft・選択・添付保護、重複抑止、順次処理、owner/SPA分離 | NOT_RUN | Chromeで未確認。 |
| queue/回答取得中のtemplate変更 | NOT_RUN | Chromeで未確認。 |
| 設定読込失敗・不正値、未確定/空/取得失敗時の未挿入 | NOT_RUN | Chromeで未確認。 |
| 手動copy/insertの維持、自動送信・自動承認なし | NOT_RUN | Chromeで未確認。 |

C50のChrome受入は全項目`NOT_RUN`で、受入完了扱いにしない。
