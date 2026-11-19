# CPP-6 受入準備マトリクス

この文書はコードと自動検証の証拠、およびWindowsメインPCでの実機確認手順を記録する。実機確認はまだ実行していないため、CPP-6の実機最終受入を示すものではない。

## 対象SHAと変更

| リポジトリ | 受入済みbase SHA | CPP-6開始branch / HEAD | CPP-6コード・テストSHA | 作業branch |
| --- | --- | --- | --- | --- |
| CodexBridge (`weito-crowry/CodexBridge`) | `17d3ba644f8d05957f12c158e26929d8f92d8bea` (CPP-2) | `codex/cpp-mcp-phase2-auth` / `17d3ba644f8d05957f12c158e26929d8f92d8bea` | `4f1699ac26de3633d47fc9d709ab1c578006943f` | `codex/cpp-mcp-phase6-allowlist` |
| ChatPanelPlus (`weito-crowry/ChatPanelPlus`) | `aae96426a2f0bf42e2d85a697c9459bd5d244de4` (CPP-4) | `codex/cpp-mcp-phase4-notifications` / `aae96426a2f0bf42e2d85a697c9459bd5d244de4` | `b7df764eff3b4bb61f05b8fc8a6872c090cf04a0` (以下の自動検証を実行したコード・テストcommit) | `codex/cpp-mcp-phase6-acceptance` |

CodexBridgeでは、CPP tokenの`tools/list`と`tools/call`を同じ4件に制限する。ChatPanelPlusのMCP clientは`codex_targets`、`codex_threads`、`codex_status`だけを呼び、一覧中の`codex_wait`は使用しない。`codex_start`、`codex_continue`、`client_request_id`の実装・呼出しは含まない。

## 自動検証

状態はこのcheckoutで実行した自動検証に対するもの。`PASS`はmock/unit/HTTP統合テストの結果であり、実Chromeでの動作結果ではない。`FAIL`は実行して失敗、`NOT_RUN`は未実施、`BLOCKED`は外部状態または承認がなく実施できない状態を表す。実機項目にPASSは付けていない。

| 状態 | 項目 | 実行した証拠 |
| --- | --- | --- |
| PASS | CPP tokenのtool catalog | ChatPanelPlus `tests/codexbridge-mcp-four-tool.test.ts` はJSONとSSE双方で4件のcatalogだけを返すmockを使い、`initialize` → `notifications/initialized` → `tools/list`の後、targets/threads/statusのみを呼ぶことを確認。waitは未使用。start/continueは一覧・呼出しに含まれない。 |
| PASS | session expiry後の読取り再接続 | 同テストでthreads readの404後、新しいsessionを初期化・一覧取得し、同じreadを一度だけ再実行。start/continue等の別callがない。 |
| PASS | token、host permission拒否、401/403、timeout | `tests/codexbridge-mcp.test.ts`でBearer header、`credentials: omit`、権限拒否時にfetchしないこと、401/403/timeout/切断の診断を確認。値やtokenを診断結果に含めない。 |
| PASS | Bridgeの4件認可とHTTP transport | CodexBridge `tests/test_cpp_mcp_auth.py`: SSE/JSON双方でCPP listが4件、4 read-only call、通常/danger-full-accessのstartとcontinue、file/Git/Workflow/GitHub等の拒否、native AppServer未到達を確認。完了済みfake turnへのwaitはtimeout 0。full token、loopback無認証、invalid Authorization 401、共有sessionの並行principal分離、token非漏洩も確認。結果: `8 passed`。 |
| PASS | Bridge CORS | 同Pythonテストで許可されたextension OriginのOPTIONSは200、異なるOriginは400となることを確認。これはASGI/HTTPテストであり、Chromeの実CORS判定ではない。 |
| PASS | threads/external_threads、cursor、status、選択競合 | `tests/codexbridge-panel.test.ts` と `tests/codexbridge-request-tracker.test.ts`。重複thread除去、次cursor、current_executionとlast_turnの区別、選択先変更後の遅延応答破棄を確認。 |
| PASS | 監視、storage復旧、poll周期、baseline/gap | `tests/codexbridge-thread-monitor.test.ts`、`tests/codexbridge-thread-monitor-review-fixes.test.ts`。保存状態からのworker復旧、15秒foreground/30秒alarm、重複/coalesce、baseline、gap、過去の完了と別の実行中turnを確認。 |
| PASS | completed/failed/interruptedと推測状態 | `tests/codexbridge-terminal-events.test.ts` とmonitor tests。current_executionがunknown/inferred/estimated、`execution_unconfirmed`、古いlast_turn、認証失敗、観測gapをterminal扱いしない。新規turnのcompleted/failed/interruptedは区別する。 |
| PASS | 4要素event keyと音声at-most-once | 同terminal-eventsテストでconnection/target/thread/turn key、保存済ledgerのworker復旧、音声要求済み状態の再生再試行なしを確認。 |
| PASS | 出力先、音量、無効化、Offscreen経路 | `tests/codexbridge-notifications.test.ts`、`tests/answer-completion-output-device.test.ts`、`tests/answer-completion-sound.test.ts`。既定/選択device、音量設定、音無効/volume 0、Offscreen、失敗時に既定deviceへ黙ってfallbackしないことを確認。 |
| PASS | exact-turn final_answerとEditor Adapter | `tests/codexbridge-final-answer.test.ts`は完了した指定turnの`agentMessage.phase=final_answer`だけを返し、欠落/重複/上限超過を未確認にする。`tests/editor-adapter.test.ts`、`tests/editor-adapter-verification.test.ts`、`tests/clipboard.test.ts`はcaret/selection挿入、既存入力保護、IME中断、手動貼付、二重挿入なしを確認。画面実装ではコピーbuttonが`navigator.clipboard.writeText`、挿入buttonが`insertAtCaret`を明示クリック時に呼び、送信操作を呼ばないことを確認した。buttonの実Chrome動作は下記のとおり未実施。 |
| PASS | 全pnpm検証 | `corepack pnpm check:size`、`lint`、`typecheck`、`test`、`build`、`git diff --check`。test内buildを含む全465 test pass、各command exit 0。 |

最終回答の取得は指定turnと`final_answer` phaseに限定する。Bridgeの履歴sanitizationはメッセージ本文を16,000文字までに制限し、履歴応答には切詰め情報がないため、画面も`completeness=unconfirmed`と表示する。取得結果を完全な全文とみなさず、token・会話本文を検証記録へ貼り付けない。

## WindowsメインPC Chrome実機チェック

以下はすべて`NOT_RUN`。Chrome既存profile/タブ、拡張のreload/deploy、稼働中Bridge、production token/設定を変更していない。別途GitHubレビューとユーザー承認の後、既存設定を確認して実施する。実施時はPASS/FAILと日時だけを記録し、token、extension利用者情報、thread/turn ID、会話本文、clipboard本文は記録しない。

| 状態 | チェックと手順 | 期待値 |
| --- | --- | --- |
| NOT_RUN | **Host Permissionとsession token**: WindowsメインPCのChromeで`chrome://extensions` → ChatPanelPlus → Details → Extension optionsを開く。Optionsの「CodexBridge MCP接続」で既存のBridge URLを確認し、必要ならURLを設定してOptionsの「保存」を押す。既に承認済みのCPP session tokenをpassword欄に入力して「tokenを保存」。続けて「接続確認」を押し、Chromeのhost permission promptで対象hostだけを許可する。 | UIはtokenを表示し直さず、browser session storageに保存済みと表示。permission許可後、MCP protocol 2025-03-26または2025-06-18、`tools/list 4件`、`codex_targets`読取り確認が表示される。permission拒否時は接続せずpermission-requiredになる。 |
| NOT_RUN | **LAN CPP token / Origin / CORS**: 既存のLAN Bridge URLに、事前に登録済みのCPP専用tokenでOptionsから接続確認し、Chrome DevToolsのNetworkでmethod/status/header名のみ確認する。token値は画面共有・記録・ログへ出さない。 | Bridgeは`chrome-extension://<この拡張ID>` Originを許可し、CPP Bearer tokenを受理する。`tools/list`は4件、接続確認callは`codex_targets`のみ。tokenは応答・ログへ出ない。production環境変数・CORS/Host設定・portはこの試験のため変更しない。 |
| NOT_RUN | **targets / threads / status / external thread**: ChatGPT上で既存のtarget一覧とthread一覧を開き、Codex Desktopから作成済みの外部threadを一つ選択してstatusを読む。nativeとexternalの同一threadが重複表示されないこと、次ページcursorがあれば次ページを開くことを確認する。 | target/thread/statusが同じtarget-thread対に結び付く。external threadが一覧に出て、重複は一行になり、cursorで次ページを読める。`codex_wait`は未使用、start/continueは送られない。 |
| NOT_RUN | **複数タブと監視登録**: ChatGPTを二つの既存タブで開き、同一threadと別threadのwatchをUIから登録・一覧・解除する。既存watchがあれば触れない。 | `storage.local`の監視状態がタブ/worker間で復元され、watchと選択中threadが混線しない。同じwatchの重複登録は増えない。 |
| NOT_RUN | **Service Worker停止・復帰**: `chrome://extensions`のChatPanelPlus詳細からService Workerを停止し、拡張やBridgeをreload/restartせずChatGPTへ戻る。監視一覧とstatusを再表示する。 | 保存済watchをworkerが復元しstatus読取りを再開。foregroundは約15秒、alarmは約30秒周期。停止前に音声要求済みのterminal eventを再通知・再生しない。 |
| NOT_RUN | **status開始/終端とgap**: 専用テストthreadを用い、ユーザー操作で開始、正常完了、失敗、中断を一件ずつ確認する。完了前のbaseline、長い通信断後のgap、古いcompleted last_turnと別のcurrent executionも確認する。 | `in_progress`とcompleted/failed/interruptedがturn単位で表示される。unknown/inferred/`execution_unconfirmed`、古いturn、切断、gapから終了を推測しない。 |
| NOT_RUN | **通知音と出力先**: Optionsで既定出力先と利用可能な選択出力先を順に選び、設定音量で専用test eventを一件発生させる。次に音を無効化または音量0にして別のtest eventを確認する。worker復帰後に同eventが重複再生されないことも確認する。 | 既定/選択した出力先で一回だけ鳴り、音量設定が使われる。無効/0では鳴らず、event記録は残る。再起動後に同じ音を再試行しない。 |
| NOT_RUN | **final_answer / コピー / 手動挿入**: terminal eventを選び「最終回答を取得」。表示結果が指定eventのturnの`agentMessage.phase=final_answer`であることを確認する。「コピー」を押して手動で貼付け内容を確認後、「ChatGPT入力欄へ挿入」は専用の空のtest composerでcaret位置を選んで押す。既存文があれば保存前後を目視比較する。送信ボタンは押さない。 | 完全性は「未確認」と表示。コピーとcaret位置への挿入は各一回、選択範囲と周辺文を保持。挿入後も未送信のままで、自動送信やCodex turn開始がない。本文を記録しない。 |
| NOT_RUN | **401 / 403 / timeout / 切断**: production Bridgeを止めず、専用fake endpointで401、403、遅延timeout、接続切断をそれぞれ返す。Chrome側のhost permission拒否も一回確認する。 | 401は認証失敗、403は拒否、timeout/切断は該当診断。permission拒否時はrequestを送らない。terminal状態や最終回答を推測せず、start/continueを再試行しない。 |
| NOT_RUN | **原状復帰**: 作成したtest watchだけをUIから解除。Options URLを試験前値へ戻す。試験用に新規入力したsession tokenだけをUIの「保存tokenを削除」で消し、試験前tokenがあれば安全な保管元から復元する。試験で初めて追加したhost permissionだけをChromeの拡張Detailsから外す。 | 試験前のURL/token/host permissionと既存watchを維持し、test watchが残らない。全storage消去、既存token削除、拡張reload、Bridge再起動は行わない。 |

実機試験の日時・PASS/FAILだけを記録する。token、個人情報、thread/turn識別子、会話本文、回答本文はこの文書やログへ保存しない。
