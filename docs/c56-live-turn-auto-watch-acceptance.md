# C56 Issue #26 Live Turn ID単独一致 受入記録

日付: 2026-11-25
対象: メインパネル v2 / Issue #26 / C56
実装・自動検証: **PASS（既存報告）**
Chrome実機受入: **主要正常経路PASS（部分受入）／異常系NOT_RUN**

## 受入対象

回答完了時のChatGPT回答にThread IDではなくlive execution Turn IDだけが含まれる場合、現在のBridge live thread/turn対応と照合して監視を開始し、終了時の最終回答をテンプレート付きで同じ会話へ反映できることを確認する。既存のIssue #26設計・実装計画に沿った限定記録とし、観測していないケースをPASSへ広げない。

## Chrome実機受入結果（2026-11-25）

ユーザー報告による正常経路の観測:

1. 新規Codexスレッドでマージ作業を起動した。
2. ChatGPTの回答にはTurn IDだけを記載し、Thread IDは記載しなかった。
3. ユーザーが監視開始を明示確認した。
4. タスク終了時、テンプレート付き最終回答が起動元のChatGPT会話に反映された。

Turn ID、最終回答本文、会話IDはこの記録に含めない。

| 項目 | 結果 | 証跡・範囲 |
|---|---|---|
| Turn IDだけを含む回答による監視開始 | **PASS（ユーザー報告）** | Thread IDを回答に含めない経路で、ユーザーが監視開始を明示確認した。 |
| タスク終了時の最終回答・template反映 | **PASS（ユーザー報告）** | テンプレート付き最終回答が同じChatGPT会話に反映された。 |
| 非live/古いTurn ID、threadとの対応不一致、登録直前のTurn変更 | **NOT_RUN** | 未観測。 |
| 部分一致・URL内ID・alias衝突・別target | **NOT_RUN** | 未観測。 |
| Bridge取得失敗、重複・競合、owner/route/connection変更 | **NOT_RUN** | 未観測。 |

以上をC56の主要正常経路PASSとする。異常系や競合を含むC56全体の受入完了とは扱わない。Issue #23〜25の経過観察方針と既存記録は変更しない。

## 自動検証記録

既存報告では、`pnpm test` 901件、`pnpm typecheck`、`pnpm lint`、`pnpm build` がPASS。本作業では再実行していない。これらはChrome実機受入の証跡とは区別する。
