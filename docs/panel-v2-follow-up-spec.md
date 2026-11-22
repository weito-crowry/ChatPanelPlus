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
