# C37: final-answer取得不一致の診断

Updated: 2026-11-22

## 判定

C37は **FAIL／原因未特定／再検証待ち** のまま。CPPが失敗を表示した瞬間のraw `codex_threads(include_history=true)`応答が保存されていないため、CPP・CodexBridge・Codex App Serverのどこで差が生じたかを確定できない。

## 確認済みの処理

1. CPPの `src/background/mcp-client.ts` は `codex_threads` に対象thread ID、target ID、`include_history: true` を渡す。
2. `src/background/codexbridge-final-answer.ts` は指定thread・指定turnを照合し、turn内で `type=agentMessage` かつ `phase=final_answer` のitemだけを候補にする。候補0件は `no-final-answer`、複数候補や不正履歴は不完全扱いにする。status本文やcommentaryへのfallbackはしない。
3. 読み取り専用で確認したCodexBridge `src/codex_bridge/bridge.py` の `item/completed` / `agentMessage` 処理（約503行）は、itemのtextが文字列ならphaseを条件にせず `state.update_latest_message(thread_id, turn_id, text)` を呼ぶ。その後のactivity分類では `phase=commentary` を区別するが、latest message更新の可否には使わない。
4. `src/codex_bridge/state.py` はその値をturn snapshotの `latest_agent_message` として返す。したがって `codex_status.latest_agent_message` の意味は「最後に完了したagentMessage本文」であり、`phase=final_answer` の真正性を保証しない。commentaryを最終回答として扱う根拠には使えない。
5. Bridgeのhistory経路は `thread/read` の `includeTurns: true` を利用する。確認したsanitize処理はreasoning itemを除去し、phaseフィールドを明示的に削除していない。ただし、問題発生時のApp Server応答自体を取得していないため、欠落の起点は未確認。

## ユーザー報告と別経路観測

- 2026-11-22 01:29完了turn: CPPではno-final-answerの報告があったが、後刻のnative historyには `agentMessage` / `final_answer` itemが存在したとの観測。
- 2026-11-22 03:41完了turn（04:00 JST報告）: CPPでは同じくno-final-answer。後刻のnative historyは41 itemsで `phase=final_answer` のagentMessageは0件。一方 `codex_status.latest_agent_message` には作業報告本文があった。
- 追加確定事実により、後者のstatus本文はphase未限定のlatest messageである。よってこれはhistoryのfinal-answer item欠落と矛盾する証拠ではなく、回答本文の真正性も証明しない。
- CPP失敗時のraw MCP応答、同時刻のApp Server `thread/read`結果、履歴保存タイミングは未取得。上記2 turnの差を説明する原因は未特定。

## 再現時の採取項目

同じeventを再試行する場合、本文やtokenを記録せず、eventのturn ID、取得時刻、返却history中のitemの `type` / `phase` の有無と個数、同route時と後刻の差だけを記録する。`latest_agent_message`はphase非限定のためphase付きfinalの代替にしない。commentary昇格、他会話fallback、最後のmessageをfinalと推測する処理は禁止。

## 影響

C37の実機操作はFAIL（ユーザー報告）、根本原因分析は未完了。C31–C36など他のChrome外観・操作項目の判定はこの報告から変更しない。
