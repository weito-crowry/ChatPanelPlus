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

## CPP-6 Phase 2B 認証設定・安全な手動再起動準備（再起動前の記録、2026-11-20）

この節はユーザー手動再起動前の準備時点を残した履歴である。再起動後の受入報告とCodexの後日read-only確認は、末尾の別節に日付を分けて記録する。

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

## CPP-6 Phase 2B bootstrap修正・再起動後受入（2026-11-20）

この追記は上記の再起動前記録と区別する。`USER/MUSE_REPORTED_PASS`はユーザーから共有された検証結果で、Codexが独立に送ったhealth/MCP/ChatGPT requestではない。Codexの独立read-only観測はTunnel process/listener/configの存在関係だけを示す。

### 正式bootstrap修正と隔離検証

| 状態 | 項目 | 根拠・結果 |
| --- | --- | --- |
| USER_CONFIRMED | 根本原因 | 正式bootstrapの対象port絞り込み付き`Get-NetTCPConnection -State Listen -LocalPort 18000,18001,55402 -ErrorAction Stop`は、3 portがすべて空いている正常状態でCIMの該当なしエラーになり得た。トップレベルcatchが段階と理由を隠していた。ユーザー/Museの診断とコード確認を突合した。 |
| PASS | 正式ファイルの修正 | Git外のPhase 2B運用領域にある`phase2b-bootstrap-console.ps1`だけを修正。`Get-NetTCPConnection -ErrorAction Stop`で接続を取得し、メモリ内で`State=Listen`かつ18000/18001/55402のlistenerを判定する。占有時はport番号を示し、OS/CIM取得失敗は別の段階・理由で拒否する。DPAPI CurrentUser読込、credential preflight、同一PowerShell processへのCPP token/config引継ぎを維持し、失敗時は元のprocess環境と作業directoryを復元する。例外原文と秘密値は出さない。診断・ユーザー手直しコピーには触れていない。 |
| PASS | 隔離回帰テスト | Git外のuser-only PowerShell test helperで6ケースを実行。空きportは成功、18000/18001/55402各1件のlistenerは個別portを示して拒否、模擬OS/CIM取得失敗は理由を分けて拒否、環境設定後の模擬location失敗では環境とdirectoryを復元。成功/失敗出力に64文字token形式の値や模擬例外詳細がないことを確認した。基準版では6ケースが期待どおり失敗し、修正後は6ケースすべてPASS。 |
| PASS | 構文・ACL・backup | 正式bootstrapとtest helperのPowerShell parser検査はPASS。正式ファイルは変更前SHA-256/ACLを確認後に上書き禁止のuser-only backupを作成し、変更前sourceとbackupのhash一致を確認。変更後も正式ファイルのACLはcurrent Windows userだけのprotected rule。実パス、backup名、hash、ACL詳細はGit外Phase 2B運用メモに保存した。 |
| PASS | 実サービス非干渉 | 回帰は隔離子PowerShellと偽listener/CIM commandで実施。CodexはBridge/Console/Tunnelを停止・再起動せず、listenerを変更せず、通常Consoleを起動せず、Chrome/Firewall/config/credentialも変更していない。 |

### Codexのread-only Tunnel観測

| 状態 | 観測項目 | 結果と限界 |
| --- | --- | --- |
| PASS | process管理 | `codex-bridge-console.exe`が存在し、`tunnel-client.exe`はそのprocess treeの子孫。現在のTunnel processはConsole管理下にあることをprocess ancestryで確認した。process IDやraw command lineは記録していない。 |
| PASS | listenerと宛先設定 | Tunnelの現在のloopback listenerは動的port `60789`で、以前の観測port `55402`とは異なる。選択中profileのservice宛先portは`18000`。Bridge/UI listener `18000`/`18001`も同Console process tree内にある。Tunnel profile参照はprocess command lineと一致することを値を出さず確認した。 |
| NOT_VERIFIED | ChatGPT経由のTunnel疎通 | local Tunnel process、listener、profile宛先の存在はChatGPTからTunnel経由で接続できた証明ではない。Tunnel経由のMCP round-trip/full-route復旧は未確認。 |

### ユーザー/Museからの再起動後受入報告

| 状態 | 項目 | 報告された結果 |
| --- | --- | --- |
| USER/MUSE_REPORTED_PASS | 再起動ゲート | ユーザーが全Codex turn完了を確認し、FX作業完了とUI APIで全threads idleをreadbackした後に操作したと報告。旧Bridge停止と通常のConsole手動起動はユーザー自身が実施。Codexは稼働サービスに操作を行っていない。 |
| USER/MUSE_REPORTED_PASS | UI health | `18001/healthz`はHTTP 200、`{status:ok}`。UI APIは`bridge=ready`、`app_server=ready`。 |
| USER/MUSE_REPORTED_PASS | CPP MCP initialize/catalog | initializeはHTTP 200、server `CodexBridge`、protocol `2025-03-26`。`tools/list`はexactly 4件: `codex_targets`、`codex_threads`、`codex_status`、`codex_wait`。 |
| USER/MUSE_REPORTED_PASS | CPP write拒否 | 空引数の`codex_start`は`Tool is not authorized...`で拒否されたと報告。`codex_continue`拒否や全read callは未確認。 |
| USER/MUSE_REPORTED_PASS | 従来の無token loopback | tokenなしloopbackの従来経路では`tools/list`が71件と報告された。 |
| USER/MUSE_REPORTED_PASS | ChatGPT側target read | ChatGPT側のCodexBridge `codex_targets`読取りが成功し、`local Main PC`の`available=true`を返したと報告。TransportがTunnel経由であることは証明されない。 |

Phase 2認証本体は上表のとおりユーザー/Muse報告ベースでPASS。bootstrapの空きport不具合修正と隔離回帰もPASS。一方、Tunnelを通った実接続は未確定であり、この記録をCodex独立の実機確認と扱わない。

### Phase 2B後の未確認項目とPhase 3前提

- Tunnel `55402`または現在の動的listenerを通る実MCP接続、ChatGPT側full-route復旧、CPP全read calls、および`codex_continue`拒否は未確認。
- Chrome Optionsからの接続/Host Permission、監視、通知音、最終回答表示・コピー・挿入、既存拡張storageの復元性は未確認。
- **Phase 3開始前に、Chromeが実際にロードしている`dist`と拡張storageのbackupが必須。** `deploy:chrome`の固定候補先だけではロード元を示さない。実ロード元とstorageを安全に退避・照合してから、別途Phase 3を開始する。
- この作業ではPhase 3/4、Chrome deploy/reload、`pnpm build`、`deploy:chrome`、実Codex turnは行っていない。

## CPP-6 Phase 3A dist退避・Storage復元性確認 (2026-11-20)

この段階は既存distの非破壊backupと復元手順の整備まで。Chrome profile/storageの自動退避経路は使えず、storage exportは未取得。Phase 3B/CおよびPhase 4へ進んでいない。

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| PASS | Repository identity / 保護 | ChatPanelPlusは指定branch/開始HEAD/upstreamでclean。CodexBridgeも指定branch/HEAD/upstreamで、既存の未追跡5領域を変更・読取りせず保護した。tracked sourceは変更していない。 |
| PASS | 登録distの静的確認 | ユーザーがChrome Detailsで確認した登録元はrepo内dist、versionは0.1.5。ディスク上distのmanifestもMV3/version 0.1.5でsource manifestとbyte一致。主要6ファイル、manifest参照のcontent script、Options page、service workerを確認。permissionsは`clipboardRead`/`storage`/`offscreen`/`alarms`、optional host patternはHTTP/HTTPS全体。固定`deploy:chrome`先は登録元distと別フォルダ。 |
| PASS | dist非破壊backup | 通常ファイル11件・767,143 bytesを相対pathとmtimeを保ってGit外へコピー。source-before/source-after/backupのfile inventory・size・SHA-256 tree hashが一致し、copy中のsource不変を確認。source/backupに再解析pointはなく、外部先への再帰なし。backup rootはDACL継承を切り、現在Windows userのみを許可し、全directory/file ACLを確認。具体path/hashはGit外のuser-only運用メモに保存。restoreは未実施。 |
| NOT_VERIFIED | Chrome identity / 設定 | Chromeの生ID、実profile、Optionsに保存されたURL、Host Permissionの実許可状態はこの段階では独立readbackしていない。ID/version/source/loopback endpointはユーザー提示情報。endpointはmanifestのoptional HTTP patternに含まれるが、許可済みとは確認していない。 |
| USER_ACTION_REQUIRED | Storage export Console報告 | ユーザーは修正版helperのsaved/verification flags、keyCount=7、bytes=661547、SHA提示を報告。これはユーザー報告であり、ディスク上のartifact検証ではない。 |
| PASS | Git外helperの隔離回帰 | 修正版helperの構文検査と17件のNode mockテストはPASS。synthetic storageのみを使用し、実Chrome実行は未実施。 |
| NOT_RUN | 復元 / 変更 | dist復元、storageへの`set`、`clear`、extension reload/permission変更は実施していない。復元手順はGit外運用メモに記録し、本番storage書込みは別途明示承認後に限る。 |
| BLOCKED | Phase 3B/C開始 | storage exportを同一profile/extension contextから取得し、拡張ID・JSON構造・key count・byte数・SHA-256・user-only ACLを確認するまで開始不可。Options URLと実Host Permissionもread-only照合が必要。Phase 3AのGitHub review完了前にも次工程へ進まない。 |
| NOT_RUN | Phase 3B/C・Phase 4 | `pnpm build`、`pnpm deploy:chrome`、dist更新、Chrome reload、新規配備、Phase 4実機試験はすべて未実施。 |

### Phase 3A export failure diagnosis and helper revision (2026-11-20)

- **USER_REPORTED settings symptom:** Options画面に「保存済み設定が破損しているか未対応」として保存停止の警告が出ていた。MCP URLは表示され、token欄は空/未保存、export not_savedのtoastが出たとの報告。Chrome UIはCodexが操作していない。
- **設定検証とraw exportを分離:** src/shared/settings-repository.ts の loadSettings は設定keyを読み、validateExtensionSettings が拒否すると corrupt-settings を返す。この画面警告だけではchrome.storage.local全体の読取不能、値の消失、修復不能を示さない。raw storage値は未取得。設定保存、初期化、reset、変更は実施も依頼もしていない。
- **旧helperの根本原因（コード静的確認）:** 旧helperはボタンclickからshowSaveFilePickerを同期的に呼んでおり、user activation喪失が原因という根拠はない。Picker後、handle.getFile()の成功を「既存ファイル」と誤認してgeneric Errorをthrowし、その後にあるchrome.storage.local.get(null)へ進まなかった。新規保存先でもPickerが空ファイルを作って返すためgetFile成功は正常であり、helper自身のguardがnot_saved/Errorを起こす。ログにstageはなく選択先も未確認なので、実際の選択先は断定しない。既存ファイルを選んでいた場合はPickerが内容を消していた可能性があるため、そのパスを保持し、再利用・削除・上書きしない。
- **修正版helper:** Git外の正式helperだけを修正し、クリック直下でdirectory pickerを呼んでuser activationを保つ。バックアップfolder選択、衝突しない新規random filenameの作成後にだけchrome.storage.local.get(null)を読み、値をJSON保存する。設定validationは呼ばず、storage set/clear/remove、session storage、clipboard、download、raw exception/message/stack/valueのconsole出力は行わない。成功時はファイルのJSON構造、byte数とhashを検証してからsavedと各verification flagを報告し、キャンセルと段階別エラーを区別する。失敗時の空/partial fileは保持し、削除・上書きしない。
- **隔離検証:** Git外Node mock harnessのsyntax checksと17テストがPASS。正常保存、取消、picker非対応/拒否、origin mismatch、storage read/serialization/create/write/close/readback failure、collision、byte/hash不一致、段階別安全診断、機微値console出力なし、production storage mutationなしを確認した。これは実Chromeの結果ではない。
- **次のユーザー操作 / USER_ACTION_REQUIRED:** Options設定を保存・初期化・reset・変更しない。失敗したPickerで選んだpathは保全し、再利用/削除/上書きしない。同じ既存profileのOptionsページConsoleへGit外の更新helperをpasteする。旧一時buttonが残っている場合はOptions tabを閉じて同じprofileからOptions pageを新しく開く（extension reloadやsettings変更は不要）。初期context確認がstorage未読を示すのを見てからbuttonを一度押し、Phase3A専用private backup folderを選ぶ。helperが生成する新規JSONに対するstatus=saved、extensionIdMatch=true、schemaVerified=true、exactBytesVerified=trueが揃った場合のみ成功報告とする。値は貼らず、失敗時はfailureStage/errorCode/errorName/storageReadAttempted/storageRead/fileState等の非機微診断だけを共有する。Codexがその後にJSON構造・extension整合・件数/byte/hash/ACLをローカルで検証する。
- **BLOCKED:** Storage export取得後のローカル検証、Chrome上の既存extension ID/profile/Options URL/Host Permissionのread-only照合、およびPhase3A GitHub reviewが完了するまでPhase3B/Cを開始しない。Phase3B/C build/deploy/reloadとPhase4実機試験はNOT_RUN。Storage復元や本番反映は未実施で、別途明示承認が必要。

## CPP-6 Phase 3A Storage export follow-up (2026-11-20)

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| USER_ACTION_REQUIRED | Storage export Console報告 | ユーザーは同じ既存Chrome profileのOptions Consoleで、status=saved、extensionIdMatch/schemaVerified/exactBytesVerified/storageReadAttempted/storageRead=true、keyCount=7、bytes=661547とSHA-256を含む結果が出たと報告した。CodexのChrome UI操作結果ではない。 |
| NOT_VERIFIED | 保存ファイルの独立検証 | 運用メモが指定するPhase 3A正規backup領域とその配下を、提示された完全一致filenameでread-only検索したが候補はなかった。reparse pointを辿らず、検出もなし。別の保存先を選んだ可能性は残るが、その場所は不明。JSONのbyte数/hash/parse/schema/key count、ACL、extension ID/origin整合は未検証。Console報告だけでdisk backup PASSとは扱わない。 |
| NOT_VERIFIED | Options設定警告の原因 | 画面警告はユーザー報告。settings repositoryにはvalidator rejectionからcorrupt-settingsを返す経路があるが、raw JSONを取得できなかったためconfig keyの存在、実値のschema、どのfieldが不一致かは診断していない。Storage APIの全体読取不能やdata lossとも判定しない。 |
| PASS | dist backup維持 | 保存済manifestに対し、現dist 11/11 filesとbackup 11/11 filesのsize/SHAを照合し、source mtime 11/11一致。manifest内source-before/source-after/backup tree hashは一致。合計767143 bytes。backup ACL 13 entriesは全てcurrent userのみ、reparse point/列挙エラーなし。distへの書込みなし。 |
| BLOCKED | Phase 3B/C開始 | 保存済Storage JSONの所在を確認し、JSON構造、reported byte/hash、key count、extension identity/origin、user-only protected ACLをローカルでPASSすることが必要。さらにChromeで既存拡張ID、保存済MCP URL、実Host Permissionをread-only確認し、Phase 3Aレビューを完了する。Chrome reloadはこの作業では行わず、将来の段階でユーザーが担当する。 |

### Storage file handling and next action

- Storage Consoleの保存成功報告とCodexの独立検証を区別する。対象JSONが正規領域で見つからず、別場所も特定していないため、Storage backupは未検証のまま。
- JSONが確認できないのでvalidateExtensionSettingsを実データへ実行していない。Optionsのcorrupt-settings警告の具体的原因は未解明。設定保存・修復・defaults上書き・storage.local変更・Chrome操作は行っていない。
- 次に必要なのは、ユーザーが既に保存したファイルの正確なローカルpathを伝えること（JSON本体・内容は送らない）。Codexはそのpathでread-only検証を再開する。新たなexport、ファイル移動/複製、設定操作は今回実施しない。
- Phase3B/C build/deploy/reloadとPhase4実機試験はNOT_RUN。Phase3Bへ自動進行しない。

## CPP-6 Phase 3A Windows Storage export verification and schema diagnosis (2026-11-20)

この追記は前項の「保存ファイル未発見・NOT_VERIFIED」という当時点の記録を更新する。ユーザーは先行するChatGPT添付検証で同一bytes/hash/format/extension identity/origin/keyCountを確認済みと報告した。今回CodexはWindows保存実体を別途read-only検証し、提示済みmetadataと一致することを確認した。

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| PASS | Chrome Console結果（ユーザー報告） | ユーザーは同一の既存Chrome Options contextでstatus=saved、extensionIdMatch/schemaVerified/exactBytesVerified/storageReadAttempted/storageRead=true、keyCount=7等が出たと報告。これはユーザー報告であり、Chrome UIをCodexが操作した結果ではない。 |
| PASS | Windows保存実体・export envelope | 指定ファイルはユーザー提示の保存先に通常ファイルとして存在し、絶対path chainにreparse pointなし。661547 bytes、SHA-256 abf0ed9243267cc486d7177eb3a9bf1ed9c285ed6331726633cba9331ebf0788でConsole報告と一致。UTF-8 round-trip、JSON parse、format chatpanelplus.chrome-storage.local-export.v1、keyCount=7、keyNames/storage key一致、extension id/originとhelper期待値の一致を確認。config keyあり、監視state keyなし。keyの値は出力していない。 |
| PASS | Git外private backup | 元JSONとは別の一意な通常ファイルを既存Phase3A private rootへcreate-newでコピー。コピー前/後のsource size/hash/mtime不変、backup bytes/hash/mtime一致。source Downloads ACLはread-only確認時にuser-onlyではなかったため変更せず、backup fileと親rootはprotected DACL/current-user-onlyを確認。metadata-only private manifestを保存した。 |
| PASS | Settings警告のroot cause | 実config schemaVersion=1にcustomTabs map 1件、customButtons 10件がある。7件のcustom button groupIdがdefault-only GROUP_IDSにないcustom tab IDを参照。buttonOrderにはそのcustom tab groupの1 entryとcustom button参照7件、tabOrderにはcustom tab参照1件がある。現validatorの純関数結果はinvalid-settings。これら未対応のgroup/order参照だけを除いた隔離cloneはvalidationを通過し、customTabs mapを含む他設定fieldのvalidationも通過した。保存値の破損ではなく、現行validatorのcustom tab形式との互換性欠落と分類する。 |
| PASS | 設定データ保護 | OptionsのloadSettingsはvalidator rejectionをcorrupt-settingsとして返し、既存値保護のため保存停止する。raw JSONの設定値は出力せず、本番settings/storageの読み書き、修復、移行はしていない。監視state keyがこのsnapshotにないことはexport時点の不在だけを示し、過去/別時点のwatch有無を証明しない。 |
| PASS | dist backup維持 | 現dist/backupはmanifestの11/11 file size/SHAに一致し、source mtime 11/11一致、合計767143 bytes。manifest tree hashはsource-before/source-after/backupで一致。backup ACL確認もPASS。distへの書込みなし。 |
| NOT_VERIFIED | Chrome実値のread-only照合 | export内extension ID/originはhelper期待値と一致するが、Chrome Details、Optionsに保存されたMCP URL、実Host Permissionは今回Chrome UIでreadbackしていない。これらは次工程前にユーザー側のread-only確認が必要。 |

### 非互換の対象と後続の最小設計範囲（今回ソース変更なし）

- settings.ts: schemaVersion 1のcustomTabs mapを型/validatorで明示し、validated custom tab IDsをcustomButtons groupId、buttonOrder、tabOrder、tabOverridesで扱う。現行default-only GROUP_IDSとorderedIdsが拒否要因。
- default-ui.tsと表示側: DEFAULT_TABSだけを使うresolver/type/render flowを、検証済みcustom tabs/groupsも構成できる形へ拡張する。現src/testsにはcustomTabs参照がない。
- settings-repository.tsとOptions編集/save: load/save validator前提を維持しつつ、custom tab/groupsのpatch、conflict判定、tab selection/view stateを保持する。無関係な編集でcustom metadataを消さない。
- 最小回帰計画: schemaVersion 1のcustom tab 1件と関連button/orderを含むfixtureでvalidatorとround-trip保持、custom tabのresolver表示、malformed/dangling referenceの拒否、loadSettingsがstorageへ書かないことをテストする。実装とテスト作成は別途レビュー後であり、今回未実施。

## Phase 3A exit status and Phase 3B gate

Phase 3AのWindows Storage export確認と独立private backup、dist退避維持確認、Options警告の互換性原因分類は完了。Phase 3A GitHub reviewはこのcommit後に行う。Phase 3B/CはBLOCKEDのまま：customTabs互換性の設計・実装修正を別turnでレビューし、Chrome上の既存拡張identity、保存済みMCP URL、実Host Permissionをread-onlyで確認すること。Chrome reloadは将来もユーザー担当。build/deploy/reload、Phase 4、Storage復元や設定変更はNOT_RUN。

## CPP-6 Phase 3A.5 custom-tab compatibility source fix / isolation acceptance (2026-11-20)

この段階ではschemaVersion 1の保存済みcustom tab構造を読み込み・表示・基本編集できるsource互換性を追加した。Chrome実機への配備と既存Storageの操作は行っていない。custom tab作成/削除UI、設定移行、Storage復元は対象外。

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| PASS | Settings schema互換性 | UUIDv4形式のcustom tab IDと`label`/`visible`を型・validatorへ追加。関連custom button group、button order、tab order、tab overrideを検証し、未知custom referenceと不正custom tab definitionを`invalid-settings`で拒否する。schemaVersionは1のまま。custom tabの追加metadataは検証後も保持し、customTabsのないlegacy設定と既定UIを維持する。 |
| PASS | Resolver・Panel view | resolverがtab order、custom label/visible、custom group内button orderを反映する。Panelはcustom tabと所属buttonを描画モデルへ含め、selected tabを保持する。非表示・削除済み・未読の選択値は先頭の可視tabへfallbackする。標準button ID/動作は既存テストで維持を確認した。 |
| PASS | Options編集・import/reset | custom tabの表示切替、label編集、tab並べ替え、所属buttonの追加・編集・並べ替えを可能にした。tab visibilityの正本は`customTabs[id].visible`。タブ作成・削除UIは追加していない。既定値resetとlegacy importはcustomTabsと依存customButtons/orderを保持する。明示importで削除するcustom tabsはcountを表示し、削除前確認を行う。 |
| PASS | Repository競合保護 | loadはread-only。custom tab IDごとの変更とcustom group button orderをpatch/conflict対象へ追加し、同一tab更新・stale削除・stale custom-group orderを競合拒否する。別standard fieldの更新はmergeし、sound/MCP URLだけの変更とknown-field replaceでもcustom tab/button/orderを保持する。valid custom tab IDのview stateを受け入れ、実在しない選択はPanel側でfallbackする。 |
| PASS | 合成回帰・静的検証 | 合成custom tab 1件、custom button 10件（custom group 7件）を使ったvalidator/round-trip、resolver、Panel、Options reset/import/edit、repository read-only/競合、不正ID/定義/dangling referenceのテストを追加。TypeScript unit tests 430/430、Options static tests 4/4をPASS。実Storage値、実ID、ユーザーのラベル・本文をfixtureや出力に含めていない。 |
| PASS | 隔離build | 4つのVite configをCLIのabsolute `outDir` overrideでGit外の新規一時directoryへ順番にbuild。Options configの`emptyOutDir`はその一時directoryだけを対象にし、他configは同directoryへ追加した。全11成果物、773569 bytes、reparse pointなし、current-user-only ACL。build出力はChromeロード元distへ配備していない。 |
| PASS | 既存distとbackup不変 | Phase 3A manifestに対しsource/backup各11/11ファイルのbyte/SHA一致、source mtime 11/11一致をbuild前後で確認。各tree SHA-256は`12b0d27651de216f3bb63f2a339e237264ca659d178d449dcbe05ac416777263`のまま。合計767143 bytes。 |
| NOT_RUN | Chrome実機確認 | Options表示、保存、reload、Host Permission、MCP接続をChromeで確認していない。既存Storageを読み書き・修復・移行・復元していない。 |
| BLOCKED | Phase 3B/C | このcommitのChatGPT GitHub review完了後、既存拡張identity、保存済みOptions URLと実Host Permissionのread-only照合、Phase 3A dist/Storage backupの維持確認を満たすまで開始しない。Chromeへのdeploy/reloadとPhase 4試験は未着手。 |

最終検証は`pnpm run typecheck` PASS、`pnpm run lint` PASS（source size check 171 files）、`node --experimental-strip-types --test`のTypeScript unit tests 430/430 PASS、Options static tests 4/4 PASS、隔離Vite build 4/4 PASS。`pnpm test`、通常build/deploy command、Chrome操作、本番Storage writeは実行していない。

## CPP-6 Phase 3B-0 isolated staging and Chrome read-only preflight (2026-11-20)

この段階ではPhase 3Aの退避状態を読み取り専用で再確認し、レビュー済みsource HEADからGit外stagingを作成、Chrome Options Console用read-only診断helperを準備した。現在Chromeがロードするdist、拡張Storage、Chrome設定は変更していない。Chrome実機helper実行もまだ行っていない。

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| PASS | Repository baseline | CPPはレビュー済みPhase 3A.5 commitの既存branch/HEADで開始しclean。CodexBridgeのbranch/HEADも一致し、既存未追跡5領域を維持、tracked source不変。 |
| PASS | Phase 3A dist backup維持 | 登録済みdistは11ファイル/767143 bytes。source-before/source-after/backup台帳に対し全相対path、size、SHA-256、mtimeが一致し、確認したpath components/treeにreparse pointなし。private rootのprotected DACLとuser-only Allowを維持。dist backup childはその限定ACLを継承しており、既存ACLは変更していない。 |
| PASS | Phase 3A Storage backup維持 | Git外private exportは7 keys/661547 bytes。記録SHA-256、export format、宣言/実key set、ユーザー確認済extension identity/originが一致。ファイルと親のprotected ACLはcurrent-user-only。raw valueは表示・記録していない。 |
| PASS | 隔離staging | 古いstagingは出所manifestがなく再利用せず保持。現source HEADからVite 4構成をCLI絶対outDirで新規Git外buildし、11ファイル/773569 bytesを確認。manifest version、permissions、optional host patternsはsourceおよび現在のdistと一致し、必須JS/HTMLとasset参照が解決。reparse pointなし、staging全項目はprotected/current-user-only ACL。production distには配備していない。 |
| PASS | Chrome Console helper隔離検証 | Git外read-only helperの構文検査とsynthetic mock 12/12 PASS。wrong identity/versionはStorage read前に拒否。endpoint一致/不一致/未保存default、permission許可/拒否、Storage/API failure、例外の非機微化を確認。helperはconfig keyだけreadし、session・network・clipboard・download・permission request・storage writeを呼ばない。出力はstatus、booleans、custom-tab件数、failure stage、allowlisted error nameのみ。 |
| USER_ACTION_REQUIRED | Chrome read-only preflight | ユーザーが既存Options pageのDevTools Consoleでprivate helperを手動実行し、安全な結果objectだけ共有する。Chrome Detailsで現在のload path/versionと実Host Permissionも読み取り確認する。extension reload、設定保存、permission requestはしない。 |
| BLOCKED | Phase 3B配備ゲート | ChatGPTによる本commit reviewと、上記Chrome identity/config/実permissionのユーザーread-only結果を待つ。stagingから登録distへの配備は本段階で未承認・未実施。 |
| NOT_RUN | 配備・実機試験 | distへのcopy/replace、Chrome reload、Options保存、MCP接続、Phase 3C/Phase 4はすべて未実施。 |

将来の配備時は確認済みの登録rootを維持して拡張IDを変えない。隔離stagingと既存backupを配備直前に再検証し、同一volume上の復元可能なsibling backupを確保してから登録distを更新、更新後のmanifest/file inventoryを確認する。失敗時は検証済backupから復元する手順を使い、Chrome reloadはユーザーが手動で行う。Settings/Storageへの自動書込みや移行は行わない。既存scripts/deploy-chrome.mjsは登録済みrootとは別のChatPanelPlus-Content-Probe-20261021を宛先とするため使用しない。

## CPP-6 Phase 3B-1 file deploy verified / Chrome reload pending (2026-11-20)

この段階では承認済みの隔離成果物を同じ登録distパスへディレクトリrenameで反映し、active distと保持rollbackをhash検証した。Chrome reload、Chrome設定操作、Storage/API操作は行っていない。Chromeで新しいコードが読み込まれたことはまだ確認していない。

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| PASS | 配備前ゲート | CPPは既存branch/期待HEADでclean。runtime sourceはレビュー済みPhase 3A.5 commitから変更なし。Phase 3A dist/Storage backupとPhase 3B-0 stagingの相対path、size、SHA、mtime、ACL、reparse、manifest/version/permissions/optional host patterns、asset参照を再照合した。 |
| PASS | ユーザーread-only identity結果 | ユーザー報告のOptions Console結果はextensionId/origin/version/schema一致、Storage読取成功、custom tab 1件。URLは明示保存されずsource defaultが使われる状態。Host Permissionは未付与でaction_requiredと報告された。これは配備前の想定状態で、permission requestは配備後のユーザー操作とする。 |
| PASS | 同一登録パスへの置換 | 固定Phase 3B-0 stagingから11ファイル/773569 bytesを新規siblingへcopy・ACL/hash検証後、既存distをunique rollback siblingへrenameし、新siblingを従来のdistパスへrenameした。active distはstagingと11/11 file hash/size一致。tree SHA-256は1d5f31e2cda9d80327ee25225ae8b27a139ef8e29c4a27fec4f42f1f9601e93a。versionは0.1.5でsource manifestとbyte一致。 |
| PASS | Rollback保持・ACL | 旧distは11ファイル/767143 bytes、Phase 3A source-afterのfile hash/mtimeと一致し、recorded tree SHA-256は12b0d27651de216f3bb63f2a339e237264ca659d178d449dcbe05ac416777263。rename前後のACL/owner fingerprintは一致し、old folder ACLは変更していない。新active distは全項目protected/current-user-only ACL。rollback siblingは保持され、誤stage防止のためその一意パスだけをlocal .git/info/excludeへ追加した。 |
| USER_ACTION_REQUIRED | Chrome受入 | Chrome Detailsの登録pathはCodexが自動読出ししていない。前回ユーザー受入記録のdist pathと今回のread-only identity結果に基づいて配備し、異なるpathの証拠はなかった。ユーザーがDetailsでpath/versionを目視照合し、拡張を手動reloadした後、Optionsで設定読込成功・custom tab/buttonと選択状態を確認する。続いてOptionsの「接続確認」からHost Permissionを本人操作で許可する。 |
| NOT_RUN | Chrome/MCP/後続試験 | Chrome reload、Options設定保存、permission request、MCP接続、Storage変更/復元、Phase 3C、Phase 4は未実施。tokenにはアクセスしていない。 |

pnpm build、pnpm deploy:chrome、scripts/deploy-chrome.mjsは使用していない。Chrome UIやprofileは操作・読出ししていない。ファイル置換の成功だけではChrome側のreload成功やMCP接続を示さない。Phase 3Cはユーザーreload後のOptions確認とHost Permission許可を経て、別途受入を行う。

## CPP-6 Phase 3C-LNA diagnostics source implementation / isolated acceptance (2026-11-21)

この段階ではOptionsの権限表示・明示的ローカルHTTP確認と、MCP接続診断の失敗分類を実装した。コード・テスト・この記録だけを変更し、Chrome、Bridge、Storage、登録済みdist、rollback、private backupには触れていない。

| 状態 | 項目 | 実測結果 |
| --- | --- | --- |
| PASS | Host PermissionとLNA表示 | Optionsは`chrome.permissions.contains`で接続先originのHost Permissionをread-only表示する。`loopback-network`と`local-network`のgranular stateは別表示し、API非対応/拒否時に画面を落とさない。許可要求は接続確認ボタンからのみ行う。LNAに対する`request()`は追加していない。 |
| PASS | Optionsからの初回ローカル確認 | loopback/private targetではChrome Host Permissionが確認されるまでHTTPを送らず、Options内の明示ボタンからだけcredentialなしGET `/__cpp_lna_probe__`を送る。bodyは読まずstatusだけを使い、404を含むHTTP応答を到達として記録する。成功したendpointに限り、続くMCP試験を許可する。LNA queryが`prompt`のままでもprobe応答を得た場合は止めない。 |
| PASS | address space分類 | 127/8・localhost・IPv6 loopbackは`loopback`、RFC1918/link-local/IPv6 ULA・link-local・`.local`は`local`とし、対象外には`targetAddressSpace`を付けない。DNSで実IPを判定できないHTTP/HTTPS hostnameは`unknown`として誤った権限分類や事前probeを行わない。 |
| PASS | MCP診断分類 | 既存transport reason (`disconnected`等)は維持し、接続確認応答にrequest/HTTP response/response-stream/protocol/timeout stage、HTTP status、allowlist error nameを必要時だけ付与する。fetch拒否とHTTP後のreader失敗を分離し、401/403/404/500、protocol/version、timeout、response-sizeを扱う。生message/stack/URL/token/bodyは応答へ含めない。 |
| PASS | Optionsの日本語説明 | fetch拒否は「サーバー停止」と断定せず、接続先・権限・CORS・Service Worker Network/Consoleの確認を案内する。Service Workerとのruntime messaging自体が失敗した場合は、起動・listener登録・Options context確認を別に案内する。 |
| USER_REPORTED | Chrome実機の追加診断 | ユーザーはHost Permission=trueでもOptionsからのruntime messageが`Receiving end does not exist`相当で直ちに失敗し、その操作に対応するService Worker `/mcp` requestが0件だったと報告。Service Worker DevToolsからの手動GET/POSTはHTTP応答、手動MCP initializeはHTTP 200 SSEと先頭chunk受信に成功したとの報告がある。これはOptions→background message経路の問題を示唆するが、listener未登録、worker起動失敗、Options context不一致のどれかは確定していない。Chrome上のlistener登録確認はChatGPT側の別レビューに委ねる。 |
| PASS | 合成テスト・静的検査 | TypeScript unit tests 440/440、Options static tests 5/5、`pnpm run typecheck`、source size check、変更対象ファイルのESLintをPASS。合成例でLNA target分類、permission granted/prompt/denied/unsupported、Host Permission granted/denied/rejected、HTTP 404 probe、fetch/stream failure、HTTP status、timeout、protocol/size、raw error非出力、monitorのlegacy `disconnected` code維持を確認した。 |
| FAIL | repository全体lint | `pnpm run lint`のsource size checkはPASSしたが、`eslint .`がrepository siblingに保持された既存rollback成果物も再帰走査し、Chrome用bundleに多数の環境global lint errorを報告して終了した。変更対象ファイルへ限定したESLintはPASS。rollback成果物は編集・削除していない。 |
| NOT_RUN | Build/実機 | `pnpm test`、build、deploy、Chrome操作、extension reload、Host Permission/LNA prompt、Options→Service Worker runtime messaging、MCP live test、Storage read/write、Phase 4は未実施。 |

このcommitはsource実装のレビュー用であり、現在Chromeがロードするdistへ未反映。Chrome実機でのpermission UIとOptions→background listener経路は未検証のまま。ChatGPTのGitHubレビュー後、Chrome側確認と安全なisolated build/deployは別工程で行う。CodexBridge sourceは変更していない。

### 2026-11-21 ESLint rollback sibling ignore follow-up

前記のrepository全体lint失敗を受け、`eslint.config.mjs`のignoreへrepo直下の`dist.cpp6-rollback-*/**`だけを追加した。保全済みrollback bundleはESLint対象外となり、source directoryのignore範囲は広げていない。再実行した`pnpm run lint`、`pnpm run typecheck`、`git diff --check`はPASS。build/deploy、Chrome操作、Storage操作は実施していない。
