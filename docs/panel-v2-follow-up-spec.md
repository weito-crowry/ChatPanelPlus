# ChatPanelPlus v2 follow-up: project filter, panel height, notification clearing

Updated: 2026-11-22

## Project-folder filtering

- Options shows saved project names and associates multiple folder patterns with the canonical `projectId`. Folder patterns use a separate `chatPanelPlus.projectFolderPatterns.v1` key; existing `chatPanelPlus.projectNames` data and the settings JSON schema remain unchanged.
- The panel's A thread list defaults to **すべて**. A saved project can be selected by its configured name; when the current ChatGPT route supplies a valid project ID, a convenience action selects that project without silently changing the default.
- Filtering applies only to the already acquired A rows and their `cwd`. It does not change the Bridge target, running summary, pagination, thread selection identity, watch registration, or B/C owner data. Counts state `一致 X件 / 取得済み Y件`; rows outside an ordinary 20-item page are not implied to have been searched.
- Patterns accept absolute Windows drive or UNC paths. `/` and `\` are normalized, drive matching is case-insensitive, `*` and `?` match within one path segment, and a complete `**` segment matches zero or more segments. A match includes the configured path and descendants, with segment boundaries (`D:\A` does not match `D:\AB`). Multiple patterns are ORed; unknown `cwd` never matches. Relative/device paths, traversal segments, malformed wildcard segments, control characters, excessive length, and excessive per-project pattern counts are rejected. Matching does not read the filesystem.
- The project-pattern editor reads names using the existing project-name repository and saves patterns independently. Existing settings import/export and custom tab/button JSON remain compatible and do not silently absorb the new key.

## Panel height

- The normal panel is bounded by viewport height (`vh` fallback, `dvh` where supported). The header remains outside the internally scrollable content area; long A/B/C content and the final-answer body scroll within their existing areas.
- No fixed positioning or scroll-containment rule is added. Page scroll chaining, responsive layouts, dark colors, and the existing minimized state remain in force.

## Clear notifications

- C keeps the existing **未確認の終了通知を確認** acknowledgement action and adds a distinct **通知をクリア** action. The user confirms that current-conversation end notifications will be deleted and watch registrations will remain.
- The content script snapshots only visible events whose immutable owner conversation matches the current route. It sends event IDs in serial batches of at most 128. A route change stops later batches; partial results are reported and the list is refreshed.
- Background validation uses the trusted ChatGPT sender conversation and verifies event ownership inside the serialized storage mutation. Only the requested IDs are removed; watches, other owners' events, and events arriving after the snapshot remain. Clearing does not reset the watch's last observed turn, so the same terminal turn is not emitted again.
- A successful clear drops selection and any retrieved answer for removed events. Storage failure is surfaced rather than reported as success.

## Watch owner transfer

- A watch remains unique by `(connectionId, targetId, threadId)`. Starting it from another trusted conversation atomically replaces its single owner binding and owner mute snapshot inside the same serialized storage mutation; it does not create a duplicate watch or consume another capacity slot.
- Transfer preserves `watchId`, baseline, `lastObservedTurnId`, and the other monitoring state. Re-registering from the same conversation is idempotent. Concurrent transfers are resolved by the order in which serialized storage mutations commit: the last committed owner wins.
- Existing terminal events keep their immutable creation-time owner. Events committed after the transfer carry the new watch owner and mute policy. A poll completing across the transfer uses the owner present at its event-creation mutation; an already-created event is never moved.
- The old conversation no longer sees the watch and cannot stop or mute it. Its already-owned events remain visible there and can be cleared only under that event owner. The new conversation does not inherit those past events. Sender URL/tab URL/conversation validation and all background owner checks remain mandatory.
- An ownerless legacy watch is not guessed or auto-assigned: the start request reports that its origin is unavailable. No owner data is exposed in diagnostics or another conversation's panel.
- The watch start UI reports when ownership was transferred and that prior notifications remain in the original conversation.

## C37 final-answer diagnosis

See [C37 diagnostic](c37-final-answer-diagnostic.md). `codex_status.latest_agent_message` is not proof of an `agentMessage` item with `phase=final_answer`; no fallback from one to the other is allowed. The two user-reported CPP failures remain unresolved because the raw `codex_threads(include_history=true)` response from the moment of failure was not captured.

## Acceptance state

The implementation commit `97ee87a2dc55af88b0bbb6a3a05ba8cfdae2d5cd` passed the isolated full suite (601/601), focused regressions (93/93), typecheck, lint, and size checks. Before deployment, repo `dist/` was copied to `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08`; its 11 files matched the source by relative path, byte size, and SHA-256, with no reparse points. `pnpm build` completed with exit 0. The deployed `dist/` has 11 files, Manifest V3/version 0.1.5, six required files, five valid HTML references, zero CSS URL references, 12/12 feature markers, and 4/4 C37 strict-parser checks (`agentMessage`, `phase`, `final_answer`, and no `latest_agent_message` fallback). The post-build SHA-256 manifest is `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08.postbuild.manifest.json`. A first marker check used pre-minification CSS whitespace, failed that marker, and restored `dist/`; restoration matched the backup, then the corrected marker check passed after the build. For this deployment, the user confirmed repo `dist/` as Chrome's registered source; `AGENTS.md`, `README.md`, and `pnpm deploy:chrome` still describe the sibling Probe path, so `pnpm deploy:chrome` was not used. C39–C43 remain `NOT_RUN` pending Chrome reload and user-operated checks. A user-reported `running_only` zero-count observation after Bridge restart is partial evidence only; C38 remains `NOT_RUN` for this deployed build. C37 remains `FAIL` with cause unknown. The checklist covers C39 (project filter), C40 (height/scroll), C41 (notification clear), C42 (watch owner transfer), and C43 (watch error lifecycle and disabled reasons).

## B監視開始エラーの再現観測

- 既存ソースでは`CODEX_BRIDGE_WATCH_START`の送信元はBの明示的な監視開始操作だけであり、Aのthread選択・一覧更新はthread読取を行うだけで監視開始を送らない。
- 配備前のコミット済みソースとlive `dist/content.js`には旧owner-conflict文言があり、失敗時に共通errorへ設定される一方、一覧読取の無効応答は黙ってreturnし、thread選択・一覧更新で旧errorを消していなかった。したがって過去のB操作で設定された文言が後のA操作で再描画され、新たに発生したように見える経路は確認できた。今回の配備には後勝ち移管とエラー表示整理を含む。
- ユーザーの画面でいつ・どの要求が失敗したかを示す実行時記録はないため、スクリーンショットの直接原因は未確定。旧owner-conflictの発生自体は以前の明示的WATCH_START失敗であり得る。B開始ボタンの無効化は選択thread、検証済み会話route、監視一覧取得中/失敗、接続ID取得、busy状態に依存する。
- watch一覧と会話別muteは別々に`sender.url`と`sender.tab.url`双方のChatGPT origin・conversation ID一致を検証する。SPA遷移中の不一致なら両方失敗し得るが、今回それが起きた証拠はなく仮説のまま。旧一覧経路はinvalid応答を無表示で捨てて接続ID未取得のdisabled状態にできた。現在の作業ソースは一覧失敗理由、再試行、muteのsender拒否、Bボタンのdisabled理由を表示する。sender検証条件は緩めていない。
- 新しいB操作失敗は`監視開始:`、一覧/解除/通知操作はそれぞれの操作名を付けて表示する。Aのthread選択・取得開始で古い監視開始結果を整理し、一覧取得の遅延応答は現在の選択へ古い失敗を持ち越さない。自動foreground refreshは新しい監視開始失敗を消さない。新たなsender検証拒否は明示的に残す。
- focused regressionはA選択/更新からWATCH_STARTが送られないこと、明示B操作だけが送ること、選択変更・A更新・明示再試行の表示整理、遅延失敗の選択越境防止を確認する。実Chromeでの原因確定と修正後表示は未実施。

## B監視一覧の読み込み停止（2026-11-22）

- ユーザー実機観測: 06:14頃の1回目はChatGPTページreloadで復旧。13:44頃の2回目はreload・Bridge接続更新・30秒待機・A一覧更新・手動状態確認でも復旧せず、B監視一覧と接続IDの読み込み表示が続き、開始操作が無効だった。A一覧とBridge上部の接続/実行中値は表示され、監視中・通知は`0/0`だった。先行観測では`1/1`だったが、保存データが消えた証拠はなく、当時の要求ログも未収集。
- ソースで確定した競合: 初回/手動WATCH_LISTと当時の15秒foreground更新、storage変更更新が同じgenerationを増やしていた。低優先更新が世代を先取りすると、初回/手動要求は古い応答扱いになり、loading解除も世代一致を条件とするため`true`のまま残る。foreground/storage経路自身はloadingを解除しない。実機での直接原因がこの競合だったかは未証明。
- 修正: 初回・手動・明示操作をforeground/storage更新より優先し、現在会話routeごとに応答tokenを調停する。自動要求は同時に1件だけとし、失敗後は明示再試行まで自動pollを停止する。25秒のtimeoutでUI待機を解放し、sender検証・storage読込・不正応答・拡張応答なし・timeoutを区別して再試行を表示する。遅延した旧要求は状態を更新できず、SPA route不一致のwatch/eventを表示しない。
- 失敗時は一覧・接続ID・summaryを未取得に戻し、件数は`—`とする。成功した空一覧だけを0件と表示する。Bの監視開始は選択thread、現在route、成功済み一覧、接続IDが揃い、処理中/失敗でない場合に限る。`WATCH_START`はBの明示操作のままで、A選択/更新や背景refreshは登録・解除・owner移管を行わない。senderのURL/tab URL照合とowner filterは変更していない。秘密値・会話本文・thread/owner IDを新たにログしない。
- focused tests 38/38 PASS。source-only一時コピーの`pnpm test`は初回633/634（1件は一覧Markupを親`CodexBridgeWatchPanel`内で探す旧構造テスト）だったため、抽出先`CodexBridgeWatchList`を検査するよう意味を保って更新。さらに欠落/不正なwatch/event配列を成功0件として扱わない検証を加えて再実行636/636 PASS。`pnpm typecheck`、`pnpm lint`、`pnpm check:size` PASS。隔離テスト前後のライブ`dist/`は11/11相対path・byte size・SHA-256一致。
- 2026-11-22 C44正式配備: source commit `39a38f5cd423576294fbd744b41b595a7a0a0578`の後、登録済みrepo直下`dist/`へ`pnpm build`を一度実行しexit 0。配備前backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-predeploy-20261122-225802-220-e09b3e603f0a489b98ea9bc8ef2c6edb`は11/11相対path・byte size・SHA-256一致、reparse pointなし。prebuild manifestは`D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-predeploy-20261122-225802-220.manifest.csv`、postbuild manifestは`D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-c44-postbuild-20261122-225802-220.manifest.csv`で、生成後11/11のhashをdist現物と照合。変更ファイルは`content.js`のみ。
- 静的受入: 11 files、Manifest V3/version 0.1.5、必須6/6、HTML 3ファイルの参照5/5有効、CSS URL参照0、C44 timeout/failure/retry・不正watch/event配列fail-closed、C37 `agentMessage`/`phase=final_answer`厳密判定と`latest_agent_message` fallbackなしを確認。Chrome reloadと実機確認はNOT_RUN。次は拡張管理画面で手動reload→対象ChatGPT会話をF5→Aでthread選択→25秒以内のB正常表示/明示失敗と再試行を確認し、正常ならBから明示登録して上部件数更新を確認する。別watchの通知が来るタイミングに注意し、再発時はエラー文と本文/IDを含めない画面記録を採る。実機の元データが削除されたとは判断していない。

## Foreground polling短縮・終端後のワンショット解除（2026-11-23）

- 前面ChatGPTタブのmonitor pollingは共有定数を5秒へ短縮する。background Chrome alarmは`0.5min`（30秒）のまま。background常駐intervalは追加せず、poll数/target上限、最大3要求、同一watch flight統合、backoff、`foregroundUntil`を維持する。C44のWATCH_FOREGROUND_REFRESHも5秒周期となるが、既存coordinatorの単一flight・失敗後停止・手動retry契約を使う。
- `completed`/`failed`/`interrupted`の確実な新規terminal transitionを検出した場合、同一storage mutationでeventを追加して、そのmutationで照合した同じwatch配列indexの1件だけを解除する。eventには検出時点のowner/mute snapshotを固定し、音声処理後も履歴へ残す。別watch、移管後のowner、過去eventのownerは変えない。終端event重複時は既存eventを変更せず対象watchだけを解除する。
- storage event mutationに失敗したときwatchを外さず、成功状態をfetch failureへ誤分類しない。次pollはlast persisted observationから終端判定を再試行する。alarm同期失敗はevent通知を止めず、alarm cycleでwatch状態と再照合する。baseline既終端、gap、unknown/not_loaded/estimated/inferred等の不確実状態ではeventも自動解除もしない。
- 自動検証: foreground 5秒/30秒alarm、成功・失敗・mute状態に関係しないevent後解除、event保存失敗時のwatch保持/再試行、他watch保持、owner snapshot、alarm同期、baseline/gap/unknown抑止、遅延old watch response/owner移管の並行性を確認。focused monitor/terminal/coordinator 49/49、隔離source-only suite 639/639、typecheck/lint/check:size PASS。Chrome実機の周期・UI表示・通知/解除連動は最終チェックリストC45で`NOT_RUN`として管理。
- 2026-11-23正式dist配備: コードcommit `b2158ddcbfee1be23b7e54e6394950368141411e`。配備前backup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-monitor-autounwatch-20261123-mwsco6ri-0gomks7`は通常ディレクトリでreparse pointなし、11/11相対path・byte size・SHA-256一致。`pnpm build` exit 0。配備後11 files、Manifest V3/version 0.1.5、必須6/6、HTML 3参照、CSS URL参照を検証。bundle markerは前面5秒・background 30秒・3 terminal status・C44再試行・C37 strict final-answer parserを確認。prebuild/postbuild manifestはbackup名の`.prebuild.manifest.csv` / `.postbuild.manifest.csv`。Chrome reloadは未実施、C45 NOT_RUN。C37のno-final-answer再発はFAIL/原因未特定のまま維持。
