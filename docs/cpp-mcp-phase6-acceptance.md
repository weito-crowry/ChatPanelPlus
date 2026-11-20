# CPP-6 受入準備マトリクス

この文書はコードと自動検証の証拠、およびWindowsメインPCでの実機確認手順を記録する。2026-11-20にPhase 1の配備前読み取り専用確認と安全退避を実施した。Chrome実機機能試験は未完了であり、CPP-6の実機最終受入を示すものではない。

## 対象SHAと変更

| リポジトリ | 受入済みbase SHA | CPP-6開始branch / HEAD | CPP-6コード・テストSHA | 作業branch |
| --- | --- | --- | --- | --- |
| CodexBridge (`weito-crowry/CodexBridge`) | `17d3ba644f8d05957f12c158e26929d8f92d8bea` (CPP-2) | `codex/cpp-mcp-phase2-auth` / `17d3ba644f8d05957f12c158e26929d8f92d8bea` | `4f1699ac26de3633d47fc9d709ab1c578006943f` | `codex/cpp-mcp-phase6-allowlist` |
| ChatPanelPlus (`weito-crowry/ChatPanelPlus`) | `aae96426a2f0bf42e2d85a697c9459bd5d244de4` (CPP-4) | `codex/cpp-mcp-phase4-notifications` / `aae96426a2f0bf42e2d85a697c9459bd5d244de4` | `5a4b865ed9e92829ea92949b365e8d0ef7b138ba` (Manifest権限検証・追加テストcommit) | `codex/cpp-mcp-phase6-acceptance` |

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
| PASS | Manifest権限の配備preflight | `tests/deployment-assets.test.mjs`が副作用のない`validateManifestPermissions`を直接検証。必須4権限とHTTP/HTTPS optional host pattern 2件を順不同で受理し、権限/originの欠落・重複・追加、および`host_permissions`/`optional_permissions`を拒否。隔離一時ディレクトリの検証も確認。登録済み拡張フォルダへの配備やChrome操作は行っていない。 |
| PASS | 全pnpm検証 | `corepack pnpm check:size`、`lint`、`typecheck`、`test`、`build`は各exit 0。test内buildを含む全469 test pass。`git diff --check`もexit 0。 |

最終回答の取得は指定turnと`final_answer` phaseに限定する。Bridgeの履歴sanitizationはメッセージ本文を16,000文字までに制限し、履歴応答には切詰め情報がないため、画面も`completeness=unconfirmed`と表示する。取得結果を完全な全文とみなさず、token・会話本文を検証記録へ貼り付けない。

## WindowsメインPC Chrome実機チェック

以下のChrome実機機能チェックはすべて`NOT_RUN`。Chrome既存profile/タブ、拡張のreload/deploy、稼働中Bridge、production token/設定を変更していない。Phase 1の環境確認結果は文書末尾に記録する。Phase 2以降は段階ごとに結果を確認してから別ターンで実施する。実施時はPASS/FAILと日時だけを記録し、token、extension利用者情報、thread/turn ID、会話本文、clipboard本文は記録しない。

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
| NOT_RUN | **実配備とChrome reload**: このCPP-6作業では`pnpm deploy:chrome`を実行していない。別途ユーザー承認後に限り、固定配備先へのバックアップ・コピー・hash確認の出力を確認し、Chromeの拡張詳細から手動reloadして状態を記録する。 | 今回の自動preflight PASSはManifest権限検証のみを示す。実配備・バックアップ復元・Chromeでのreload受入は未確認で、完了扱いにしない。 |
| NOT_RUN | **原状復帰**: 作成したtest watchだけをUIから解除。Options URLを試験前値へ戻す。試験用に新規入力したsession tokenだけをUIの「保存tokenを削除」で消し、試験前tokenがあれば安全な保管元から復元する。試験で初めて追加したhost permissionだけをChromeの拡張Detailsから外す。 | 試験前のURL/token/host permissionと既存watchを維持し、test watchが残らない。全storage消去、既存token削除、拡張reload、Bridge再起動は行わない。 |

実機試験の日時・PASS/FAILだけを記録する。token、個人情報、thread/turn識別子、会話本文、回答本文はこの文書やログへ保存しない。

## CPP-6 Phase 1 配備前確認・安全退避 (2026-11-20)

Phase 1の評価:

| 状態 | 項目 | 実施根拠 |
| --- | --- | --- |
| PASS | Repository identity | CodexBridgeは`codex/cpp-mcp-phase6-allowlist`、開始HEAD/upstream/originが`aec79411465bef065cd41b0e60ce74cdb47b5c41`で一致。追跡ファイルに差分なし。既存未追跡領域を変更せず保護した。ChatPanelPlusは`codex/cpp-mcp-phase6-acceptance`、開始HEAD/upstream/originが`5d27dc057dadb21a1d84a267dedb6669b981a1b8`で一致し、開始時statusはclean。 |
| PASS | Bridge process/config readback | 実行中`codex_bridge`プロセスが`127.0.0.1:18000` (MCP)と`127.0.0.1:18001` (Console UI)をlisten。Bridge実行環境の`CODEX_BRIDGE_CONFIG`が明示され、選択されたcheckout設定の値はhost `127.0.0.1`、port `18000`、`lan_enabled=false` (省略時の既定値)、`allowed_hosts=[]`、`allowed_origins=[]`。認証値は表示せず、環境変数の有無のみでCONTROL tokenあり、MCP tokenなし、CPP専用tokenなしを確認。 |
| PASS | Console/Tunnel ownership | Consoleは`uv`からWindows Terminal配下のPowerShell経由で起動。MCP listenerは現在のConsole process tree外で、起動元の親processは既に終了していたため元の起動主体は未確定。Console process tree内のTunnel clientは`127.0.0.1:55402`をlisten。停止・再起動は行っていない。 |
| PASS | Secret-safe backup | 有効設定2ファイルをGit外の一意なDドライブbackupへコピー。source/backupのSHA256、サイズ、時刻とコピー中のsource不変を確認。backup directoryは現在のWindows userだけを許可し、各fileも同じACLを継承。実パス・file一覧・hashはGit外の`phase1-backup-manifest.json`に保存した。復元は未実施。 |
| USER_CONFIRMATION_REQUIRED | Chrome extension registration | 既存Chrome profileのPreferencesを読み取り専用で開こうとしたがアクセス拒否となった。既存Chrome画面にExtensions/Optionsページは見当たらず、既存tabは変更していない。登録extension ID、実フォルダ、installed version、host permission grant、Options endpoint URLは未確認。`deploy-chrome.mjs`の固定候補先との一致も未確認。 |
| USER_CONFIRMATION_REQUIRED | Chrome monitor storage export | `chrome.storage.local`の監視状態を読む既存extension contextを確認できなかったためexportなし。Chrome LevelDB、session token、profile fileのcopy/解析は行っていない。 |
| NOT_VERIFIED | Other Codex turns | この調査のPowerShellは現在のCodex process treeに属することを確認。別の`codex.exe` process群も稼働していたが、process一覧だけではturnごとの実行中/完了を識別できなかった。Bridge再起動前に他のCodex turnsが完了したことを再確認する。 |
| NOT_RUN | Phase 2–4 | token生成・登録、LAN/Firewall設定、Bridge再起動、Chrome配備/reload、MCP実機試験、新規/中断Codex turnは実施していない。 |

Phase 2へ進む際の確認事項:

- CPP専用tokenは`CODEX_BRIDGE_CPP_MCP_TOKEN`環境変数としてBridge processへ渡す設計。現在のMCP listener環境では未設定。token値をこの文書やログへ記録しない。
- LAN設定は現在の選択設定の`bridge.host`、`bridge.port`、`bridge.lan_enabled`、`bridge.allowed_hosts`、`bridge.allowed_origins`または対応する環境変数が対象。現在はloopbackのみ。LAN公開時はWindows Defender Firewallの受信規則も変更対象になる。今回変更なし。
- 稼働中MCP listenerは現在のConsole process tree外で起動主体が未確定。既存のConsole lifecycle操作がこのlistenerを再起動する根拠は取れていないため、再起動方法は起動元を確認してから選ぶ。他の稼働中Codex turnsの完了を確認してから操作する。
- 次のChrome確認はユーザーが既存profileの`chrome://extensions` DetailsでID/version/実フォルダ/権限を目視し、既存Options画面からendpoint URLを読み取る。tokenや会話・turn IDを共有しない。現在値の保存や変更、permission付与、reloadは不要。

## CPP-6 Phase 2A listener起動元・安全再起動経路の調査 (2026-11-20)

Phase 2Aは読み取り専用調査、既存Phase 1 backupの検証、Git外の運用メモ作成まで完了した。Phase 2Bのtoken生成・設定/Firewall/環境変更・listener再起動、Phase 3のChrome配備/reload、Phase 4の実機機能試験は実施していない。

### Phase 2A 評価

| 状態 | 項目 | 実施根拠と結果 |
| --- | --- | --- |
| PASS | Repository identity | CodexBridgeは`codex/cpp-mcp-phase6-allowlist`、開始時のHEAD/upstream/originが`aec79411465bef065cd41b0e60ce74cdb47b5c41`で一致し、追跡ファイルに差分なし。既存の5未追跡領域を維持した。ChatPanelPlusは`codex/cpp-mcp-phase6-acceptance`、開始時のHEAD/upstream/originが`69df01b254f2ce9e16e3cb71f1400e31057da69d`で一致し、status clean。 |
| PASS | Listener・設定 | MCP `127.0.0.1:18000`とBridge UI `127.0.0.1:18001`は同一のPython 3.14 Bridge processがlisten。process environmentの`CODEX_BRIDGE_CONFIG`で選択設定を特定し、host loopback、`lan_enabled=false`、`allowed_hosts=[]`、`allowed_origins=[]`を確認。CONTROL tokenは環境に存在し、MCP full tokenとCPP tokenは当該listener環境に存在しないことを値を表示せず確認した。 |
| PASS | Console/Tunnelの現況 | 現在のConsoleは`uv`/PowerShell/Windows Terminalのprocess treeにあり、Bridge listenerはそのtree外。Console管理コードは自身が起動した`console_started`状態のBridgeに対して制御を許可する。ConsoleのTunnel clientは`127.0.0.1:55402`をlistenし、既存Tunnel profileはloopbackのMCP port 18000へ接続する。Tunnel profileにある環境credential参照先がTunnel process環境に存在することを値を出さず確認した。 |
| NOT_VERIFIED | Listenerの起動主体・再起動方法 | listenerの親processのさらに上位の親PIDは既に終了していた。Consoleが現在のlistenerを起動・所有した証拠はなく、Consoleが外部listenerをadopt/restartできる証拠もない。Windows process creation event queryは利用不可、Sysmon logはなく、service/task/Run/Startupから該当launcherを確認できなかった。READMEにある`uv run codex-bridge`等は一般的なentry pointであり、今回のlistenerがその方法で起動した根拠や安全な再起動経路を示さない。 |
| PASS | Port・Firewall・LAN状態 | 18000/18001/55402はすべてloopback bind。FirewallのDomain/Private/Public各profileは有効でinbound既定Block、調査した受信規則にこれらのportまたは対象実行pathを許可する規則なし。現行listenerにLAN bindingはない。 |
| NOT_VERIFIED | 全Codex turn完了の確認経路 | 読み取り専用`codex_threads`は100件のpageと次cursorを返したため全pageを列挙した証拠ではない。process数はturnの実行状態を証明しない。別Codex Desktop/ChatGPT実行環境も未確定。current turnのlistener経由状況を含め、全turnが完了したとは判定できない。 |
| BLOCKED | Listener再起動 | 現在のMCP listenerはこの調査turnのprocess ancestry上にあり、再起動すると実行中turn/tool transportを切断する。Consoleの管理対象でもないため、このphaseでは安全な停止・再起動方法を確定できない。調査turn自身も実行中であり、全turn完了確認も未達。 |
| USER_CONFIRMATION_REQUIRED | Chrome登録・拡張情報 | 既存Chrome profileのPreferencesへの読み取りアクセスが拒否された。拡張ID/version/実インストールfolder/Host Permission/Options endpoint URL、および`chrome.storage.local`の監視状態は未確認。固定配備候補先との一致も未確認。Chrome UI/profileは操作せず、拡張folderやLevelDBのcopyも行っていない。 |
| PASS | Phase 1 backup検証 | Git外の既存backup manifestに記録された設定2 fileについて、現行sourceとbackupのSHA-256・byte size・timestampが2/2で一致し、検証中sourceも不変。backup directoryはcurrent Windows userのみのprotected ACLで、各fileも同userだけのruleを継承。拡張本体と監視storageは退避していない。local復元メモに実パスなどを記録し、Gitへ含めていない。 |
| NOT_RUN | Phase 2B–4 | token生成/登録、LAN/Firewall/config変更、Bridge/Console/Tunnel再起動、Chrome deploy/reload、実機MCP/拡張試験、新規または中断Codex turnは未実施。 |

### 次段階へ進む前に必要な事実確認

- **再起動は現状BLOCKED。** このturn完了後に、`codex_threads`全pageを読み取り専用で列挙し、実行中候補を`codex_status`で確認する。外部Codex Desktop/ChatGPT turnも別途確認する。page・context・statusのどれかが不明なら再起動しない。現在のlistenerが調査turnの祖先であるため、このturnの実行中に停止してはならない。
- 現行listenerのowner/launcherと、重複起動しない制御可能な再起動経路を先に確定する。ConsoleはConsole自身が起動したBridgeだけを制御する実装で、現在の外部listenerへの管理権限を示す根拠はない。port使用中にREADMEの直接起動commandを実行しない。
- `CODEX_BRIDGE_CPP_MCP_TOKEN`はTOMLではなくBridge process environmentから読み込まれる。Consoleから起動する場合はBridge起動前にConsole親processのenvironmentへ注入される必要がある。現在のConsole processへ後から環境変数を注入できる経路は確認できていない。永続的なUser/System environmentやcommand argument/logへtokenを保存しない。
- 現listener環境では`CODEX_BRIDGE_MCP_TOKEN`が見つからず、Chrome側の既存session tokenは未確認。Tunnel profileのcredential参照とMCP full tokenは別物である。既存のfull-token接続とTunnel経路を維持できる方法を特定してから変更する。Tunnelはloopback MCP endpointに依存するため、Bridge再起動時にはChatGPT MCP接続を一時切断し得る。Tunnel supervisorの復帰動作があっても無停止・自動復旧は保証されない。
- LAN化する場合に確認/変更対象となるのは選択中`CODEX_BRIDGE_CONFIG`の`[bridge] host`、`port`、`lan_enabled`、`allowed_hosts`、`allowed_origins`と、必要な場合の対応環境変数`CODEX_BRIDGE_HOST`、`CODEX_BRIDGE_PORT`、`CODEX_BRIDGE_LAN_ENABLED`、`CODEX_BRIDGE_ALLOWED_HOSTS`、`CODEX_BRIDGE_ALLOWED_ORIGINS`、およびWindows Defender Firewall受信規則。Tunnel profileとその現在のloopback MCP endpointは別に保持し、configと環境変数で同一項目を重複設定しない。
- ユーザーがChrome `chrome://extensions`で登録済みChatPanelPlusのID、version、読み込み元folder、Host Permission、Options内endpoint URLを確認するまで`allowed_origins`の具体値は設定しない。拡張folder backupがChrome稼働中に安全に可能かも未確認。監視storageのexportは拡張context経由に限り、session token/LevelDBには触れない。
- 後続の設計がLAN公開を使う場合、現在のPrivate subnetまたは確認済みclientだけにTCP 18000を限定し、18001/55402は開けない。TailscaleもPrivate分類のため、Private profileだけに限定した広い規則は意図しないinterfaceを含み得る。現行loopbackとTunnelのHost/Origin/routeを維持し、実際に必要なhost/originだけを加える。`http://`上のBearerは平文であり、Firewall/Host/Origin制限は暗号化にならない。
- 変更直前に影響する設定ごとの新規user-only backupを作成しhash/size/time/ACLを確認する。rollback時は変更後の状態も別backupし、復元元manifestと宛先を照合して該当fileだけ戻し、ACL/hashとloopback/Tunnel healthを検証する。サービスownerと全turn完了を確定する前に復元後の再起動をしない。

実機の秘密値、認証値、拡張ID、thread/turn ID、会話本文、機器のローカル実パスやprivate IPはこの文書に記録していない。Git外backupのmanifestと`phase2a-local-operations.txt`だけにローカル復元情報を保存した。

## CPP-6 Phase 2B 認証設定・安全な手動再起動準備 (2026-11-20)

Phase 2Bでは認証設定とユーザー手動起動の準備だけを実施した。稼働中Bridge/Console/Tunnelの停止・再起動、Chrome操作、実MCP requestは行っていない。設定ファイルの更新は次回起動用であり、稼働中listenerへの反映・認証成功を示さない。

| 状態 | 項目 | 根拠・結果 |
| --- | --- | --- |
| PASS | Chrome登録情報の確認 | ユーザーがChrome UIで登録済みunpacked拡張のversion `0.1.5`、読み込み元がChatPanelPlusの`dist`、Options endpointがloopback MCPであると確認。具体的な拡張ID・URL・ローカル絶対pathはGitへ記録していない。`deploy:chrome`の固定宛先は実際の読み込み元と異なる。 |
| PASS | 次回起動用Origin設定 | 実効設定の`bridge.allowed_origins`に、ユーザー確認済み拡張Originを追加した。既存項目は保持。`host=127.0.0.1`、port `18000`、`lan_enabled=false`、空の`allowed_hosts`を維持し、Tunnel/Workflow/UI/Firewall設定は変更していない。 |
| PASS | Secure backup・ACL | 設定変更前にGit外の新規一意なPhase 2B backupを作成。baseline hash/size/time、source不変、元configのACL情報を記録し、退避元とbackupを照合。config候補とsecret-bearing filesを含む運用領域はcurrent Windows userだけのACL。既存Phase 1 backupは上書きしていない。 |
| PASS | CPP tokenの保存準備 | 32 bytesの暗号学的乱数から64文字の形式を作り、DPAPI `CurrentUser`で暗号化してGit外に保存。復号round-trip、形式、利用可能なfull MCP tokenとのdistinctnessを値を表示せず確認。平文token、値、hashはGit/ログへ記録していない。 |
| PASS | BridgeConfig・Host互換性 | 同一directoryの候補を隔離Python processでTOML parse/BridgeConfig loadし、loopback・port・LAN無効・Origin・CPP token形式を確認。空の`allowed_hosts`は維持され、loopback用Host既定値がtransport設定に入ることも確認。これは起動serverの認証/health試験ではない。 |
| PASS | Consoleへの環境引継ぎ | 既存sourceを静的確認。Console launcherはsystem environmentを取得してchildへ設定し、managed config pathを明示する。CPP tokenはmanaged-config override keysから除外され、BridgeConfigはprocess environmentから読む。user PowerShellからの実起動・環境受領は未確認。 |
| PASS | ユーザー用手順・helper | Git外に、user-only ACLのDPAPI token generator、同一PowerShell sessionへ値を表示せずprocess環境を設定するbootstrap、明示clipboard handoff、port/process ownerのread-only preflight、全turn完了ゲートとrollback手順を作成。PowerShell parserで全helperの構文を確認。bootstrapはsecretをpersistent User/System environmentに保存せず、port/Console/Tunnel credential参照が未解決なら起動せず停止する。 |
| BLOCKED | 全Codex turn完了・再起動 | 現在の調査turnは稼働中で、既存Bridge listenerはそのprocess ancestry上にある。全target/threadのpage走査、各threadの`codex_status`確認、外部Codex Desktop/ChatGPT turnの目視確認は未実施。全turn完了とは判定していない。 |
| USER_ACTION_REQUIRED | 手動停止・起動 | turnゲート通過後、ユーザーがConsole/Tunnel/Bridge関係とlistener PID/path/start timeを再照合し、port解放を確認してから同一PowerShellでbootstrapと`uv run codex-bridge-console`を実施する。Codexから停止・再起動は行っていない。 |
| NOT_RUN | live認証・再起動後確認 | ユーザーPowerShellへのtoken注入、Bridge起動、`18001/healthz`、CPP `tools/list`、read-only tool call、401/deny動作、Tunnel/ChatGPT full route復旧は未試験。後続ターンでのみ確認する。 |
| USER_ACTION_REQUIRED | Phase 3–4 | 登録済み`dist`の安全バックアップを別途行うまでdeploy/reloadしない。Host Permission付与、Optionsへのtoken登録、実機機能試験、新規/中断Codex turnは未実施。 |

### ユーザー手動手順の要点

- 起動元はユーザーの通常PowerShell。Codexが既に開いているshellや稼働中Consoleへ環境変数を後付けできない。Git外bootstrapをそのPowerShellでdot-sourceし、その同じshellから起動する。CPP tokenはprocess environmentだけでBridge childへ継承される。
- 停止前に全turn確認を完了し、`codex_targets`の対象を固定、各targetの`codex_threads(limit=100)`を`next_cursor=null`まで逐次走査し、全threadの`codex_status`でcurrent executionとlast turnの証拠を確認する。cursor cycle、重複、page失敗/上限、途中のtarget/thread変動、running/inferred/unknown/needs-input状態、外部turn不明はBLOCKEDとする。外部Codex Desktop/ChatGPTもユーザーが確認する。current turn終了前にall-clearを宣言しない。
- listener PIDは`Get-NetTCPConnection`と`Win32_Process`の実行path/creation timeで毎回再照合する。Consoleが現在のlistenerを所有する根拠はなく、Consoleを閉じてもexternal listenerが残る可能性がある。穏当なConsole stopはConsoleが対象Bridgeを所有しcontrol可能な場合だけ使う。制御できないlistenerの強制停止は、全turn完了とPID/path/timeの直前再照合後に限るユーザー操作であり、in-flight requestや子processへ影響し得る。
- 旧Bridge停止後に18000/18001、旧Console/Tunnel整理後に55402のlistenがすべて解消したことを確認する。残存portがあれば新Consoleを起動しない。Console/Tunnelを閉じると既存ChatGPT MCP routeは一時切断する。復旧は未保証。
- 再起動後、loopbackのUI health status、MCP initialize、CPP `tools/list`のexact 4件（`codex_targets`、`codex_threads`、`codex_status`、`codex_wait`）を確認する。all-turn gate中は`codex_wait`を呼ばない。read-only 3 toolだけで状態を確認し、Phase 4でのstart/continue拒否検査には実target/promptを渡さない。既存Tunnel/ChatGPT full routeの再接続も別途確認する。
- LAN公開は今回不要で、Firewall変更もない。HTTP BearerをLAN利用する場合は平文となる。

具体的なOrigin、token、DPAPI blob名、backup path/hash/ACL SDDL、thread/turn識別子、会話本文、ユーザーのローカル実行pathはGit外のPhase 2B運用メモと検証manifestにだけ保存した。
