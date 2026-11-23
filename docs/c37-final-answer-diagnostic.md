# C37: final-answer取得不一致の診断

Updated: 2026-11-22

## 判定

C37は **FAIL／原因未特定／再検証待ち** のまま。CPPが失敗を表示した瞬間のraw `codex_threads(include_history=true)`応答が保存されていないため、CPP・CodexBridge・Codex App Serverのどこで差が生じたかを確定できない。

## 変更前に確認したlegacy処理

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

## C37 CPP統合更新（2026-11-23）

### 実装状態

- CodexBridge側には専用`codex_final_answer` MCP APIの実装と契約書`D:\CodexBridge\docs\codex-final-answer-mcp.md`がある。ただしBridge checkoutには未コミットの変更があり、この専用APIを含むBridgeはまだlive deployされていない。現在稼働中のBridgeがこのtoolを公開しているとは扱わない。
- CPPはcached `tools/list`で`codex_final_answer`を確認し、公開されていれば指定された`target_id` / `thread_id` / `turn_id`をそのまま渡す。応答の3 ID、source marker、item ID、回答本文とサイズ、フィールド形状を検査し、適合した本文だけを`completeness=confirmed`として返す。不一致・破損応答はprotocol errorにし、その本文をUIへ返さない。
- 新toolが公開されていない場合は従来の`codex_threads(include_history=true)`を使う。新toolが`unavailable`かつreason=`no_confirmed_final_answer`を返した場合も、指定turn内の厳密なlegacy history抽出だけを試す。それ以外の`unavailable`、`pending`、`incomplete`、不正応答ではhistoryへfallbackしない。legacy本文は引き続き`unconfirmed`。
- 完了済み新API結果と旧history結果をUIで区別する。取得・コピー・composer挿入はいずれも既存の手動操作のままで、取得時に入力欄を変更したり送信したりしない。
- Bridgeが稼働後に捕捉していない過去turnは、新APIの保存記録から復元できない。legacy historyにも指定turnの`agentMessage.phase=final_answer`がなければ`no-final-answer`のままとし、`codex_status.latest_agent_message`、commentary、partial/deltaを使わない。

### CPPの隔離検証

- 新規`tests/codexbridge-final-answer-mcp.test.ts`はtool優先、strictなidentity/source/item/shape検査、UTF-16上限、全status/reason、tool未公開時の互換経路、`no_confirmed_final_answer`のみのfallback、session更新後の再一覧、並行読取を検証する。
- `tests/codexbridge-final-answer-presentation.test.mjs`はconfirmed表示とreasonの非表示、`tests/codexbridge-watch-panel.test.mjs`は取得時のdraft保護・自動送信なしを検証する。既存のhandler/owner/editor adapter回帰も含む全Node suiteは655/655 PASS。`pnpm run typecheck`と`pnpm run lint`もPASS。
- 登録済み`dist/`を保護するため`pnpm test`（内部でbuildを実行）、build、deployは実行していない。CPPソース統合は隔離テスト済みだが、現在の登録済み拡張へは未反映。

### live C37状態と受入手順

C37の過去の実機FAILは維持し、新しい統合経路のlive受入は**NOT_RUN**。live成功とは扱わない。再検証はBridgeとCPPの両方が対象実装でdeployされた後に行う。

1. 専用APIを含むBridgeをdeploy/restartし、CPP principalの`tools/list`に`codex_final_answer`があることを確認する。未deployのBridge checkoutやソース上のtool定義だけでは受入にしない。
2. 新しいテストturnを実行・完了させ、`target_id`、`thread_id`、`turn_id`を同じturnに結び付ける。今回のdeploy以前に捕捉されなかった古いturnを新APIで復元できることは期待しない。
3. CPPをビルドして登録済みの開発拡張へ反映し、Chromeで手動reloadする。正しいowner会話のterminal eventを選び、「最終回答を取得」を押す。
4. 新しい捕捉済みturnではconfirmed表示と正確な本文を確認する。取得だけではcomposerに変更がないことを見てから、copyまたは明示的な「ChatGPT入力欄へ挿入」を選ぶ。専用test composerでcaret/選択範囲と既存draftが保たれ、送信・Codex turn開始が起きないことを確認する。
5. Bridge接続変更、別owner会話、event選択変更/SPA遷移を行い、古い応答が別eventやcomposerへ反映されないことを確認する。新APIの未対応・storage unavailable・pending/incompleteは本文なしで表示し、履歴fallbackしない。過去未捕捉turnはlegacy historyにもfinal itemがなければ未発見のままであることを確認する。

受入記録にはPASS/FAIL/NOT_RUNと日時だけを残し、token、会話本文、clipboard本文、owner/event/thread/turnの識別値は記録しない。
