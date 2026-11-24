# ChatPanelPlus メインパネル再設計 v2 — 最終Chrome受入チェックリスト

## 実施条件と記録方法

- 対象はWindows 11上の既存Chromeプロファイルと、ユーザーが明示したリポジトリ直下`D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`。過去記録で兄弟Probeを実登録ロード元とした記述は誤りで、配備先として扱わない。2026-11-24、ユーザーがこの`dist/`をreloadしChatGPTをF5した後、C46基本正常経路とC47主要正常系の一部を実機確認した。行別の記録範囲を越えて未観測項目をPASSにしない。
- Phase 1は2026-11-21にユーザーから「Chrome側で再読み込みし、動いた」と報告され、Phase全体の受入PASSを記録済み。個々の操作結果は未報告なので、本書の行を遡ってPASSにはしない。
- Phase 2〜4の自動テスト・型検査・Lint・配備は各Phase記録を参照する。手動項目は行ごとの結果を使い、ユーザー報告で確認された項目だけPASSとする。
- Phase 6 UI commit `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`とrunning_only CPP commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`を、それぞれbackup照合後に登録済み`dist/`へbuild・配備した。Bridge再起動はユーザー報告済みだがlive app schemaは未確認。2026-11-24のC46連続観測はC46基本正常経路とC38/C45の限定的な部分証拠としてのみ記録し、個別受入項目全体へ結果を広げない。
- 実施時は同じChromeプロファイルを使い、Phase 6配備済み拡張を手動reloadしてから確認する。各行の結果を`PASS`／`FAIL`／`NOT_RUN`へ更新し、会話本文・秘密値を含めないスクリーンショット、簡潔な操作記録などの証跡を記入する。
- Bridgeの確認には利用許可のあるテスト用threadを使い、会話IDや本文を記録へ転記しない。自動送信しない。

## Chrome受入項目

| ID | 環境・操作 | 期待結果 | 結果 | 証跡・メモ |
|---|---|---|---|---|
| C01 正式ロード元 | `chrome://extensions`で登録済み拡張のロード元がこのリポジトリの`dist/`であることを確認し、ビルド後の拡張とChatGPTページを手動再読み込みする。 | `dist/`から拡張が起動する。兄弟Probeを配備先にしない。 | PASS（ユーザー報告） | ユーザーが実ロード元をrepo直下dist/と確認し、拡張reloadとChatGPT F5を実施。今回のC46操作も同じ実機で成立。CodexはChrome/DevToolsを操作していない。 |
| C02 通常画面 | 任意の会話を開き、パネル通常表示を見る。 | ヘッダー、作業中toggle、既存音声・統計操作、Optionsで解決した常時ボタンとタブ／promptボタンが保たれる。Bridge件数欄は2項目だけ。 | PASS（ユーザー報告） | 2026-11-21、通常画面の構成・ボタン類・Bridge件数欄2項目をChrome実機で確認し問題なしとの報告。 |
| C03 Optionsボタン定義 | Optionsで設定済みのラベル、文面、表示、順序、グループを確認し、4つの既定prompt（全文／要約／翻訳／調べて）を確認する。 | Options設定が優先され、非表示ボタンを強制表示せず、重複表示しない。自動送信しない。 | PASS（ユーザー報告） | 2026-11-21、Options画面を開いて目視確認し問題なしとの報告。個別prompt操作結果は主張しない。 |
| C04 既存入力操作 | 既存prompt／カスタムボタンを選択し、入力先のcaret・選択位置、paste/manual paste、clear、copyを操作する。 | 既存の挿入・clipboard・focus動作を保ち、不要な本文置換や自動送信をしない。 | NOT_RUN | |
| C05 Bridge詳細・最小化 | 詳細をpointerとkeyboardで開閉し、最小化・復帰する。 | `aria-expanded`と詳細領域が一致し、Bridge詳細はA thread一覧→B監視登録→C終了通知の順。最小化で本文が隠れ復帰する。 | PASS（ユーザー報告） | 2026-11-21、A→B→C導線と最小化・復帰をChrome実機で確認し問題なしとの報告。 |
| C06 幅とレイアウト | 最大幅900px付近と640px未満の幅で、通常・詳細・最小化を確認する。 | 件数・操作が重ならず、横はみ出しや読めない折返しがない。 | NOT_RUN | |
| C07 同一会話UI状態 | 会話Aで選択tab、最小化、Bridge詳細開閉を変え、同じ会話を別Chrome tabで開き、reloadする。 | UI状態はconversation ID単位で共有され、遅延読込で古いroute状態へ戻らない。 | NOT_RUN | |
| C08 別会話UI状態・SPA | 会話A/Bそれぞれで異なる状態を保存し、同一tabでSPA遷移し、戻る／再reloadする。 | A/Bの状態が混ざらず各会話に復元される。conversation ID不明時は保存済み状態を誤読・上書きしない。 | NOT_RUN | |
| C09 Codex作業中mode | A/Bと同一会話別tabで既存作業中状態を切替・reloadする。 | 既存のtab×conversation保存に従い、パネルUI状態・音声mute変更が干渉しない。 | NOT_RUN | |
| C10 mute分離 | 同一会話を2つのChrome tabで開き、片方だけmute。続いて別会話でも切替。 | muteはChrome tab ID＋conversation ID単位。同じ会話の別tabと別会話の状態を上書きしない。 | NOT_RUN | |
| C11 共通音声設定 | Optionsで共通音声有効化、音量、音色、出力先を確認・変更し、別会話へ移動する。 | これらはブラウザ共通のまま。会話別muteは共有有効化を変更しない。実効可聴条件は共有ONかつowner mute OFF。 | NOT_RUN | |
| C12 Bridge discovery | 会話A/BでBridge詳細のthread候補を確認し、実行状態順とowner分離を再確認する。 | Aの一般Codex thread探索は共有でよい。読み込み済みの確定実行中が先頭、推定中が次、その他は後。候補に監視owner会話や終了件数を混ぜない。 | FAIL（修正前の実機指摘）／修正後再確認NOT_RUN | 2026-11-21ユーザー実機報告：実行中threadが先頭でなかった。自動修正commit `c528acd37e9b0d907175f4e19019c6913f027eca` と配備は完了、Chrome再確認待ち。 |
| C13 owner監視と表示分離 | 会話Aからthreadを監視登録し、Bを開いて同じthreadを確認する。Aの別tabも開く。 | BはAのwatch名・件数・event有無を一切表示しない。Aの別tabはAのwatchとeventを共有する。登録元muteはAの元tab設定を使う。 | NOT_RUN | |
| C14 owner移管と履歴帰属 | Aで登録した同一watch identityをBから開始し、watch一覧・過去通知・以降の新規終了eventを確認する。 | watchは一件のままBへ移管。過去eventはAに残り、新規eventはBに帰属する。Aの一覧からwatchは消え、Aからの解除/muteでBのwatchは変わらない。 | NOT_RUN | 後勝ち移管の実装・自動回帰を追加。Chrome実機確認待ち。 |
| C15 件数とTurn重複 | owner会話で同じthreadの複数terminal Turn、重複refresh、他会話のwatchを含む状況を作る。 | 「監視中」は現在会話のwatch数。「監視スレッドが終了した未確認」は未確認Turn eventを持つ一意watch identity数。別会話・ownerlessは除外。 | NOT_RUN | |
| C16 終了通知ACK | Aで未確認通知を確認し、Aの別tabとBの件数を見る。確認直前に新しい終了eventも発生させる。 | Aの対象eventだけ確認済みになり、ACKは冪等。競合して発生した新eventは未確認のまま。Bの件数は変化しない。 | NOT_RUN | |
| C17 legacy ownerless | owner metadataのない既存watch/eventがある環境で通常パネルを見る。 | 旧データは保存・監視を維持するが、通常panelのどの会話にも流用・表示・計上しない。音声をskipし、他会話情報を漏らさない。 | NOT_RUN（一部観測のみ） | 2026-11-21、当該会話は監視0件・終了event0件で他会話情報の混入兆候なしとの報告。ownerlessの旧データを用意した分離試験は未実施。 |
| C18 登録元muteでBridge完了音 | watch登録元Aをmute/unmuteしつつ、別会話Bをactiveにした状態でBridge監視対象を終了させる。登録元tabを閉じるケースも確認する。 | active tabでなくowner watchの最新muteを使う。mute中／owner mute不明は音をskipし、event・視覚通知・未確認件数は記録する。tab終了後は最終既知muteを使い、別tabへfallbackしない。 | NOT_RUN | 実音声の証跡は内容を含めない |
| C19 音声raceと共通gate | mute切替と通知再生を近接させ、共有音声OFF、volume 0、再生デバイス不在も確認する。 | 再生直前の最新owner policyを使い、mute・owner不明・共有OFF・volume 0では音が鳴らない。音声をskipしても通知は残る。 | NOT_RUN | |
| C20 final-answer owner認可 | Aの終了eventを選び、Aで取得・表示・copy・挿入し、同じ会話別tabでも試す。Bから同じevent IDにアクセスする。 | Aのeventだけが取得でき、同じ会話の別tabは許可。Bは拒否され本文・event存在を漏らさない。copyと挿入は明示操作のみで、自動送信しない。 | 基本取得・表示・copy・挿入は部分観測PASS／owner越境等NOT_RUN | 2026-11-23、C37対象eventの回答表示後にcopyとChatGPT入力欄への挿入が成功したとのユーザー報告。別会話・別接続先からの拒否、同一会話の別tab、挿入後の下書き保持、自動送信しないことの独立試験は未報告でNOT_RUN。 |
| C21 final-answer完全性 | 最終回答項目なし、複数候補、履歴不足のeventで取得する。 | 別messageを最終回答と推測しない。no-final-answer／不完全を示し、完全性未確認の注意を保つ。 | NOT_RUN | 過去に履歴項目なしの例がある。2026-11-22時点ではCPP表示とnative include_historyの差の原因が未特定だったが、後続調査でC37の応答形式拒否を特定・修正。項目欠落・複数候補・履歴不足の異常系自体は未試験。C37参照。 |
| C22 SPA中の非同期結果 | Aでfinal-answer取得を開始し、応答待ち中にBへSPA遷移する。取得後にcopy／挿入操作も試す。 | 古いrouteのevent選択・本文・非同期結果を破棄。挿入直前にも現在routeとownerを照合し、BへAの本文を入れない。 | NOT_RUN | |
| C23 worker／Bridge復旧 | 監視中にService Worker休止・再起動、Bridge接続の切断・復旧を自然に発生させ、一覧を再取得する。 | watch/event owner、mute snapshot、ACK状態が復元される。二重eventや誤通知を発生させず、未知状態を完了と誤判定しない。 | NOT_RUN | 手動でworkerを破壊せず通常の休止／再開で観察 |
| C24 権限・認証・接続変化 | Bridgeの権限不足、認証切れ、接続先変更を再現できる場合に一覧・read・stopを確認する。 | 現行エラー表示を保ち、別会話情報やfinal本文を返さない。接続先変更中は古いevent本文を再利用しない。 | NOT_RUN | 環境で再現できない項目はNOT_RUN |
| C25 CPP UIからの実ジョブ開始 | CPPの既存画面に対象環境で使用するジョブ開始導線がある場合だけ、その承認済み手順でテスト用jobを開始する。 | 対象jobが意図した会話・Bridge threadへ紐づき、監視eventがownerを保つ。既存UIに開始機能がない場合は未対応として記録し、新規APIや自動送信を代用しない。 | NOT_RUN | 現在の実ジョブ開始動作は未検証 |
| C26 deployコマンドの宛先 | `pnpm deploy:chrome`の固定先と実際のChromeロード元を比較する。 | 実ロード元はrepo `dist/`。`deploy:chrome`は兄弟Probeを指すため、このcheckoutでは使用しない。 | NOT_RUN | スクリプトの宛先は兄弟Probeで、ユーザー明示のロード元`dist/`とは異なる。今回も実行しない。 |
| C27 大量ACKと部分失敗 | owner会話に129件以上（可能なら256件）の未確認終了eventがあるテスト環境で一括確認する。通信失敗を挿入できる場合は2回目のbatchを失敗させ、その間に新eventを発生させる。 | 最大128 IDsずつ直列処理し、全件成功時は未確認数が減る。部分失敗は応答件数と一覧再取得を表示し、成功済み以外を未確認のまま残す。操作開始時snapshot外の新eventは確認済みにしない。 | NOT_RUN | 自動では129/256、途中失敗、新event並行を検証済み |
| C28 B/C選択の会話別復元 | 会話AでB監視対象とC終了eventを選ぶ。同じ会話の別tab/reload、別会話B、A thread探索の選択をそれぞれ確認する。watch解除またはevent一覧からの消失後も確認する。 | B/C選択だけが同一conversation ID内で共有・復元される。A探索選択とは独立し、別会話には漏れない。owner一覧にない選択は解除され、最終回答本文は保存・越境表示されない。 | NOT_RUN | 自動ではconversation state、旧schema、owner filterを検証済み |
| C29 実行中取得mode・C12優先順 | thread一覧を更新し、確定実行中・推定実行中・不明・非実行中を含む状態を確認する。実行中／通常一覧modeを切替え、初回取得・更新・通常一覧の次ページ取得を確認する。mode／target切替中の遅延応答と選択thread・watch維持も確認する。 | 確定中（`in_progress`／`running`）が先頭、推定中はその次に推定ラベル付きで表示。各群は有効な`updatedAt`新しい順、欠損/不正時刻は末尾で安定順。不明とlast_turnだけでは実行中扱いしない。実行中modeが既定でBridgeのrunning_only結果を直接表示し、通常一覧modeは従来の20件cursorを使う。通常一覧は取得済み候補にC12順を適用する。Bridge返却集合が全thread網羅を保証しない点を表示し、空結果・未読込・失敗を区別、非表示選択と監視操作を維持する。 | NOT_RUN | 自動検証は全563/563・focused 50/50 PASS、typecheck/lint/サイズ検査PASS。bundleは登録済み`dist/`へbuild・配備済み。Chrome確認待ち。 |
| C30 スピーカー操作の統合 | Optionsで全体音声をON/OFFし、統計隣のスピーカー1個を操作して同一会話のtab別muteを確認する。 | パネルのスピーカーは会話別muteだけを切替え、共有の有効化・音量等はOptionsに残る。全体OFFでも会話別mute操作を使える。iconは実効消音（全体OFFまたは会話別mute中）を示し、ARIA/titleは全体状態と会話別mute状態を別々に説明する。`aria-pressed`は会話別muteだけを表し、全体設定やmute値を相互変更しない。 | FAIL（修正前の実機指摘）／修正後再確認NOT_RUN | 2026-11-21ユーザー実機報告：会話統計の隣に同じ見た目の全体音声／会話別muteボタンが2個並ぶ。修正commit `82c0dd7fc131dec320a47c4cd16b9c8a22e6b454`、自動検証・dist配備は完了。Chrome再確認待ち。 |
| C31 Phase 6 B表示名fallback・ID tooltip | Bの監視対象でtitle/nameあり、null、空白、不使用ラベルを用意する。ラベルへmouse hoverし、Tab等でkeyboard focusしてIDを確認する。異なるtarget/ownerでも確認する。 | usableなtitle/nameを主表示。取得不可・空白・不使用ならthread IDを仮主ラベル。全行のhover tooltipでthread IDを表示し、keyboard focusでも説明を取得可能。名前がある行にIDを常時併記しない。内部identity/owner認可は表示名で置換せず、別会話情報を出さない。 | NOT_RUN | 自動回帰でfallback/tooltip/keyboard説明を確認。コードcommit `3aca9ca`を登録済みdistへ配備済み。Chrome実機は未確認。 |
| C32 Phase 6通常画面とBridge bar | 正式ロード元で通常画面を開き、header、utility、tab、prompt、Bridge barを確認する。Optionsの表示順/非表示/labelも使う。 | 動的project名、Codex作業中、会話別speaker、統計、Options、最小化をheaderに整理。設定済みutility/tab/promptのみ表示。Bridge barに「実行中」「監視中」「通知」を表示する。API未取得の実行中は`—`。注釈や固定例示buttonをUIに含めない。 | NOT_RUN | UIとrunning_only連携を含むbundleはrepo直下`dist/`へ配備済み。Chrome reload未実施のため実画面は未確認。 |
| C33 Phase 6 Bridge値と未取得 | 会話A/B、複数target、接続中・失敗・未取得、20件ページとrunning_only応答を比較する。 | 実行中はBridge running_only結果の件数。監視中と通知は現在owner会話の既存summary。通知は未確認終了通知を持つ一意watch件数。未取得は`—`と説明し0や20件を全件と誤表示しない。他会話件数を出さない。 | NOT_RUN | CPPの取得・owner summaryは自動回帰で確認済み。bundleは配備済み。Bridge再起動はユーザー報告済みだが、live app schemaとChromeからの実値取得は未確認。 |
| C34 Phase 6 Bridge詳細A/B/C | 十分な幅で展開し、A一覧/B選択・監視/C通知・最終回答と技術情報の折りたたみを確認する。 | Aの更新・実行中／通常一覧mode・pagination・machine選択を維持。Bの監視開始/解除とthread identityを維持。Cのowner filter、ACK、最終回答copy/挿入、SPA保護を維持。通常行に診断IDやcwdを並べず、必要時だけ表示する。 | PARTIAL（C46終了後のA/B/C件数を部分観測） | 2026-11-24 10:07頃、C46対象終了後にA実行中0、B監視0、設定内監視0、C通知1を表示。通知検出10:05:09 JST。技術情報は折りたたまれ通知identityを直接照合していない。A/B/C全操作、owner分離、ACK、SPA保護等は未確認。 |
| C35 Phase 6 responsive・dark・keyboard | 幅900px/640px付近、ライト/ダーク、Tab/Enter、hover tooltip、focus説明を確認する。 | 3列から2列/縦積みへ変化し横scrollなし。操作とlabelが隠れず、focus ring/ARIA/tooltip説明が使える。 | NOT_RUN | CSS breakpoint、dark palette、focus/ARIA契約は自動検査済み、bundle配備済み。実機の幅・色・tooltip表示は未確認。 |
| C36 Phase 6最小化bar | 通常/展開から最小化・復帰し、未取得値、別会話への移動、再読込も確認する。 | 本文buttonを隠した1行にChatPanelPlus、既存作業中状態、3つのBridge表示値、復帰操作を保つ。未取得を0とせず他会話データを混ぜない。 | NOT_RUN | minimized markup/CSSと既存切替操作を自動回帰確認済み、bundle配備済み。Chrome実機は未確認。 |
| C37 C通知 final-answer取得の不一致 | Cの同一終了eventから最終回答を取得し、表示結果と時刻を記録する。必要に応じ、時間を置いて同じeventでもう一度取得する。再現時は本文/tokenを保存せず、event.turnId、時刻、MCP応答itemのtype/phase有無、同route時と後刻の差を確認する。 | 当該turnの`agentMessage`/`final_answer` itemが返る場合に限りその回答を表示する。itemがない応答ではno-final-answerと完全性未確認を示し、別itemを推測昇格したり他会話へfallbackしたりしない。原因特定後に同じeventの再取得結果を記録する。 | 主要正常系PASS／詳細異常系NOT_RUN | 履歴：2026-11-22 01:40 JST報告では終了event/回答完了音は成功した一方、CPPはno-final-answerを表示。native `codex_threads(include_history=true)`の別経路には対象Turnの`agentMessage`/`final_answer` itemがあったが、CPP失敗時raw MCP応答がなく当時は原因未特定。2026-11-22 04:00 JSTの別報告でもCPP取得失敗。後刻native history 41 itemsには`phase=final_answer` itemがなく、`codex_status.latest_agent_message`はfinal-answer真正性の証拠にならないことを記録。修正：Bridgeの永続化API `codex_final_answer(thread_id,turn_id,target_id)`の本番応答は`status=retrieved`、`source=app_server.item/completed.agentMessage.phase=final_answer`、本文一致。実応答に追加される`native_thread_id`をCPP commit `c40dea06814b46257342243fca91dbe5241a6ee0`で厳格な任意追加キーとして許容し、既知native identityとの一致を検証。2026-11-23、ユーザーがChrome拡張とChatGPTページを再読み込み後、C37対象の完了eventから最終回答を取得し、「完了済みturnの確定した最終回答を取得しました。」と本文が表示された。以前のBridge応答形式エラーは再発せず。詳細異常系、owner/target越境、異常・競合、下書き保持、自動送信しないことの独立確認は未報告でNOT_RUN。 |
| C39 プロジェクト別thread filter | Optionsで保存済みproject IDに複数の絶対path patternを登録し、A一覧を「すべて」および各projectで絞り込む。drive/UNC、`*`/`?`/`**`、path境界、空cwd、通常20件外を確認する。 | 保存済みproject IDごとにOR一致し、取得済み行だけをfilterする。一致件数/取得件数を区別し、未登録・未取得を全件一致と誤認しない。filter変更でtarget、watch、B/C owner、Bridge summaryは変わらない。 | NOT_RUN | Optionsの再読込・複数設定保存、filter/route/target raceの自動回帰を追加。Chrome確認待ち。 |
| C40 パネル高と内部scroll | 縦の短い画面でthread一覧、監視詳細、長い回答を開き、headerと本文scroll、ページscroll、最小化を確認する。 | パネルはviewport内に収まり、headerを保ったまま長い本文を内部scrollできる。ページscroll連鎖を阻害せず、最小化/復帰が維持される。 | NOT_RUN | CSS構造回帰のみ実施。Chrome実寸は未確認。 |
| C41 通知をクリア | A会話に複数eventを作成し、確認ダイアログ後に通知をクリアする。別owner event、新着event、監視登録、部分失敗、SPA route変更も確認する。 | 操作開始時に表示されていた現在会話owner event IDだけを削除。watch/baseline・別owner・snapshot後の新着は保持され、ACK確認状態とは別操作。部分成功/失敗を表示し、古いrouteで後続処理しない。 | NOT_RUN | 自動回帰でowner認可、snapshot batch、部分失敗、route停止、event保持を確認。Chrome確認待ち。 |
| C42 watch owner後勝ち移管 | Aが監視中のthreadをB/Cから開始する。上限到達、同時登録、旧owner解除/mute、移管前後のterminal event、通知クリアを試す。 | 各identityは単一watch。新しい異なるconversationの信頼済み登録へ原子的に移り、状態を保ったままownerとmute snapshotを更新する。直列化順で後勝ち。過去eventは元owner、新eventは移管後owner。旧owner操作は新watchへ作用しない。ownerless legacyは自動移管しない。 | NOT_RUN | 自動回帰でwatch上限、同時移管、旧owner権限、event/clear、sender偽装、移管中pollを確認。Chrome確認待ち。 |
| C43 B監視エラーとdisabled理由 | Bでwatch一覧/mute読込を確認後、Aで別thread選択と一覧更新を行う。Bの明示開始成功・拒否、SPA遷移時のsender/tab URL不一致も確認する。 | Aの操作はWATCH_STARTを送らない。古いowner-conflict表示は選択変更・A更新・明示再試行で整理され、新しい開始拒否は`監視開始:`理由付きで残る。一覧/mute失敗はsender検証を緩めず説明・再試行を示す。Bボタンの無効理由は選択なし、会話ID不明、一覧取得中/失敗、接続ID未取得、処理中を区別する。 | NOT_RUN | 自動回帰ではA選択/更新からのSTARTなし、B明示開始のみ、失敗表示の寿命と古い非同期応答の抑止を確認。スクリーンショットの実行時原因とChrome再確認は未確定。 |
| C38 running_only API連携・件数 | 新Bridge serviceのschema対応環境と旧service／未対応remote targetで、通常・展開・最小化の3状態を確認。実行中／通常一覧mode、target切替、更新、20件cursor、応答遅延、真の0件・失敗も試す。 | boolean schemaの対応確認後だけ実行中要求を送り、running_only結果を直接表示する。確定・推定を分けない。通常一覧は20件cursorのまま。旧schema／未対応remote／失敗時は件数`—`と理由を示し通常一覧へ切替可能。古い件数・別target値を残さず、Bridge返却範囲以上の完全性を称さない。 | PARTIAL（C46前後のA件数2→0を表示） | C46対象登録前のA実行中2と終了後0を表示。独立した手動更新の有無は未確認で、更新契機は確定しない。live schema、実行中/通常mode、target切替、cursor、未対応・失敗表示等の専用C38受入は未実施。 |

| C44 B監視一覧のtimeout・再試行・route競合 | 監視一覧を遅延または無応答にし、5秒foreground更新・storage更新・明示再試行を重ねる。timeout後に再試行し、真の空一覧、storage/sender応答失敗、SPA会話切替も確認する。 | 初回/明示要求のloadingは低優先更新で永久化しない。25秒以内にtimeout等の理由と再試行が表示され、自動要求は積み上がらない。古いrouteのwatch/eventは出ず、失敗/未取得は`—`、成功した空一覧のみ0件。不正/欠落配列も成功0件にしない。WATCH_STARTはBの明示クリックだけで実行される。 | NOT_RUN（異常系）、正常系PASS（部分観測） | 自動検証636/636・focused 38/38、typecheck/lint/size PASS。C44 source commit `39a38f5cd423576294fbd744b41b595a7a0a0578`を登録済みrepo直下`dist/`へ`pnpm build` exit 0で配備。backup 11/11、postbuild manifestもdist現物11/11 hash照合。bundle変更`content.js`のみ。静的検証11 files・Manifest V3/0.1.5・必須6/6・HTML refs 5/5・C44/C37 marker PASS。配備当時はChrome実機未確認。2026-11-23ユーザー報告：再読み込み後にB監視一覧を表示でき、監視が実際に機能した（正常系の部分観測、表示までの時間は未報告）。25秒timeout/再試行/route race/保存失敗の試験は未実施。 |
| C45 5秒foreground監視・終端後の自動解除 | 前面ChatGPTタブの監視周期を確認する。専用threadで`completed`、`failed`、`interrupted`を一件ずつ発生させ、event・通知・watch一覧・alarmを確認する。他watch併存、baselineが既終端、gap/unknown/inferred、event保存失敗も確認する。 | 前面pollは約5秒、Chrome alarmは30秒のまま。確実な新規終端遷移では一件のeventを保存して対象watchだけを解除し、別watchとevent ownerを保つ。音声の成功/失敗/muteにかかわらず解除し、保存失敗・不確実状態・初期baselineでは解除しない。最終watch解除時alarmを消し、他watchがあれば維持する。安全条件を満たさずwatchが残る終端状態は「通知判定保留」と理由を表示し、新規event成立と混同しない。 | PARTIAL（C46連続試験で終端後B0/C1を表示） | 2026-11-24の連続観測で対象終了後にB/設定内監視0、C通知1。通知検出10:05:09 JSTだが技術情報が折りたたまれidentityは直接照合していない。2026-11-23の実機FAILとその後の修正は履歴に保持。厳密poll周期、音声、failed/interrupted、保存失敗、alarm、他watch、worker復旧等の専用C45再受入は未実施。 |
| C46 回答完了時のBridge ID先行照合・自動監視登録 | 専用会話/targetで明示ONにし、回答完了前は登録されないことを確認する。回答完了後にBridge `running_only=true`を取得し、応答時点と登録要求直前の現在DOMから対象turnを一意に再特定する。main/turn再描画・再配置、Bridge待ち中の非ID本文編集後でも、現在の同一会話・同assistant message ID・complete・現在可視本文内の候補ID一致を満たせば通す。2 live候補のうち本文に一つだけ含め、対象のみ登録されることを確認する。IDなし、過去turnだけ、ID部分一致/URL埋込、assistant ID不一致/不明/未完了、duplicate turn、別route/owner/target/connection、候補外ID、Bridge失敗/未対応、SPA race、音声状態、manual解除、worker restore、watch上限、C45通知/自動解除も確認する。 | (1)現在会話route/owner/target/connectionが一致。(2)現在DOMでevent turnが一意、assistant message ID一致、state=`complete`。(3)現在の可視本文にBridge live候補IDの完全一致token。候補照会は完了イベント後だけ。開始時HTMLElement同一性、時点間本文snapshot、安定化wait/本文同一性比較は登録ゲートにしない。既存token境界、URL/embedded ID拒否、同target alias、2候補中1候補のみ照合、最大32件の一致IDのみcontentから送信を維持する。本文/DOMはbackgroundへ渡さず、backgroundはsender/owner/target/connection/latest liveを再検証する。明示ON、重複event抑止、周期的な全件探索禁止、短命thread見逃し許容、manual watch、C45通知/自動解除、watch/event保持は維持する。 | PARTIAL（基本正常経路PASS） | 2026-11-24 10:00:42 JST、回答完了検出、Bridge候補2件、コード装飾付き対象IDの本文照合1件、対象1件のみ監視登録。対照候補は非登録。登録前A実行中2/B監視1/設定内監視1/C通知0。Bridge実測は対照正常終了10:04:34.514、対象正常終了10:05:00.631、実行中0。10:07頃A/B/設定内監視0、C通知1、検出10:05:09。10:06:05の候補0/no-running-candidates診断は終了後として正常。通知identityは直接照合していない。音声、手動更新の有無、厳密poll周期、別会話、worker復旧、異常系等は未確認。 |
| C47 監視終了時の最終回答自動下書き反映 | C欄で会話別の既定OFFを確認し、専用会話でONにする。手動watchとC46自動watchから新eventを発生させ、空欄・既存draft・選択範囲の各状態を確認する。OFF、ON前event/reload、owner tab別会話/同会話別tab、SPA切替、audio OFF/mute、IME/添付/editor不可、pending・取得失敗、複数同時完了も確認する。詳細は`docs/c47-terminal-answer-auto-reflect-acceptance.md`。 | 新規保存後、ON時刻より後のeventだけをowner会話の入力欄末尾へ一度だけ追記し、空欄には本文をそのまま入れる。既存draft・選択・添付を壊さない。C37で`retrieved`かつ`confirmed`の回答だけを使い、pendingは最大2回再試行。未反映時はC欄状態と手動取得を残す。送信/Enter/送信ボタン/clipboardは呼ばず、C46 auto-watch・音声・muteは独立する。 | **PARTIAL（主要正常系PASS／残項目NOT_RUN）** | 実装commit `12d1e6d861349663706bfe7f9a1e886740cd21c8`。ユーザー報告：登録済みrepo直下`dist/` reload/F5後、C47 ONで11:23:51.223の正常終了時に空欄へ反映された2行の最終回答を送信し、Bridge最終回答と完全一致。11:47:22.660、11:47:46.942の正常終了後、未送信の既存手入力文末尾へ異なる検証マーカーを各1回、改行区切りで追記した内容を送信。当該試験で重複なし。初回はC47 ON忘れで再試験。送信前DOM／未送信状態の独立観測、OFF、過去event、watch起点、選択範囲、近接/同時完了、owner/SPA、音声/mute、IME/添付、取得失敗等はNOT_RUN。会話ID・回答本文・thread IDは記録しない。 |

## 残工程（重要度別、2026-11-24）

優先度はメインパネルv2全体を受け入れるための手動確認順。未確認であることだけから新たな機能修正を推定しない。再現した不具合は個別に診断してから対応する。

### P0 — 受入判定前に優先する

- **C47の未受入項目**：空欄への自動反映・本文一致、既存draft保持、順次複数反映、当該試験での重複なしはユーザー報告で部分PASS。OFF・過去event、watch起点、選択範囲、近接/同時完了、owner/SPA、audio/mute、IME/添付、取得失敗・手動fallbackはNOT_RUN。送信前DOM／未送信状態も独立観測していない。詳細はC47行と`docs/c47-terminal-answer-auto-reflect-acceptance.md`を参照。
- C45専用の終端確認：対象event identity、監視自動解除、前面poll周期を対応付けて確認する。2026-11-24 C46連続観測ではB/設定0・C通知1まで確認したが、技術情報内identityは未照合。failed/interrupted、通知保存失敗、alarm、他watch、worker復旧は未確認。
- C38実機確認：A実行中件数/一覧の更新契機、running_only live schema、実行中/通常mode、未対応・取得失敗表示を確認する。件数2→0は観測済みだが、独立した手動更新の有無は未確認。
- 修正後未確認の既知項目：C12/C29の実行中優先・mode、C30のスピーカー/mute操作、C31–C36のPhase 6表示、C44の監視一覧再試行/route競合を現行distで確認する。以前のFAIL表示は修正前の履歴として保持し、再受入までは項目ごとにPARTIAL/NOT_RUNとする。

### P1 — 主要操作と境界条件を補う

- C46は基本登録経路（平文・全角括弧、コード装飾付きID）をPASS確認済み。前後の日本語段落付き独立code span、表/コードブロック、候補外・過去turn・部分一致等の拒否、route/owner/target競合、manual watch、音声状態、worker restore等は個別未確認。
- C13–C24、C37、C39–C43のowner分離、final-answer、SPA/接続・復旧、project filter、通知clear、watch移管、エラー表示をチェックリストの個別条件に沿って確認する。C37主要正常系はPASS、詳細異常系はNOT_RUN。

### P2 — 画面・補助操作と長期方針

- C04、C06–C11、C27–C28などの入力、幅/状態、音声、batch ACK、会話別選択を必要な範囲で確認する。通常の1回のC46成功からはこれらを推定しない。
- Phase 4のBridge event総保持上限、Options resetの適用範囲、conversation ID不明時の通常回答完了音、ownerless legacy管理は別途方針を決める。

## C38 / C45 / C46 同日実機観測と修正記録（2026-11-23）

- C46仕様訂正：2026-11-23の旧実装はON後の実行中thread全件を周期登録していた。18:51 JSTの自動登録・終了通知・自動解除PASSはこの誤仕様での観測としてのみ保持する。回答完了イベントの当該本文ID一致登録に対するChrome受入はNOT_RUN。
- 先行訂正時点のsource検証：`pnpm test` 716/716、`pnpm typecheck`/`pnpm lint`/`pnpm check:size`（262 files）PASS、`pnpm build` exit 0。この716件は今回さらに変更したBridge-first順序の検証ではない。
- Bridge-first順序変更後のsource検証：`pnpm test` 732/732、`pnpm typecheck`・`pnpm lint` PASS、`pnpm check:size` PASS（264 files、500行/32768 bytes以下）、`pnpm build` exit 0。repo直下`dist/`を更新した。Chrome reload・ChatGPT F5・Bridge本番操作・既存watch/event storage変更は行っていない。正仕様でのChrome実機受入は引き続きNOT_RUN。

- A開始同期：C46が新規watchを作った後もAに実行中threadなし・上部0と表示された。成功したowner-filtered watchの実追加だけをtriggerにし、running modeは1応答で一覧と件数を更新、normal modeはsummaryだけ更新する。B一覧取得中のstorage変更は後続snapshot 1回へまとめる。空一覧は0、通信失敗/unsupportedは`—`。追加のA定期pollingは設けない。
- C45終了追跡：C46自動登録後にcompleted/liveだったTurnでC終了eventがなくwatchが残ったというユーザー実機報告。Bridge `codex_threads(running_only=true)`形状の回帰で、missing current execution turn IDを同時観測の`last_turn`がin_progress/liveの場合だけ結び、completed/inferred/unknownをbaselineへ補わず、terminal event保存と自動解除まで確認した。C45の受入評価は既存FAILのまま。
- 実装後のChrome実機、固定ロード元への反映、Bridge操作、既存watch/event storageへの操作は行っていない。C38/C46の修正後実機受入とC45再受入はNOT_RUN。C37主要正常系PASSは変更していない。
- 最終source検証：`pnpm test` 713/713、`pnpm typecheck` PASS、`pnpm lint` PASS、`pnpm check:size` PASS（258 files、500行/32768 bytes上限）、`pnpm build` exit 0。Chrome実機はNOT_RUN。
- C46旧誤仕様での18:51 JST実機観測とB件数修正：旧方式では新規threadの自動登録、終了通知1件と自動解除をPASS観測。A開始時0→1は未確認。B件数不整合をowner-filtered/current connection/current targetのwatch snapshot由来に修正し、未取得は「未確認」と表示する回帰テストを追加。件数修正時点のsource検証は`pnpm test` 716/716、`pnpm typecheck`・`pnpm lint`・`pnpm check:size`（259 files）・`pnpm build` PASS。今回訂正後C46のChrome実機受入はNOT_RUN。

## C46 追加FAILと現在DOM契約（2026-11-24）

- 08:09:15 JSTの先行ユーザー画面：イベント検出、Bridge候補取得OK・2件、本文照合`dom-changed`、監視登録未実行、B監視0、自動登録ON。
- 08:46:31 JSTのユーザー実機B診断：同じくイベント検出→Bridge候補OK・2件→`dom-changed`→登録未実行、B監視0。回答には対象thread IDが記載され、対照IDは未記載だった。
- 08:46時点のsource `9c3ff2343122fb486e264c82ea9edc303781273e`は複数のguard/本文比較枝を`dom-changed`へ集約していた。実DOMを直接観測できず、画面情報だけでは最初の失敗枝を分けられない。**根本原因は未特定**であり、個別mutationやroute/root/turnの差替えが起きたとは断定しない。
- ユーザー承認により現在DOM契約へ変更する。Bridge応答後と登録要求直前に現在route/owner、現在main内の一意turn、event assistant message ID一致と`complete`状態、現在可視本文のlive候補ID完全一致tokenを確認する。Bridge開始時HTMLElementの同一性、開始/応答後/0ms後/最終本文snapshotの完全一致、安定化waitを登録条件から外す。
- 現在3条件を満たす限り、描画差し替え・turn再配置・非ID部分の本文変更後も登録可。IDなし/候補外/partial/URL内・埋込ID、assistant identity/state不一致、曖昧turn、別会話route/owner/target/connectionは拒否する。backgroundのsender/owner/target/connection/latest-live確認、manual watch、C45通知/自動解除は変更しない。
- 自動検証：`pnpm test` 761/761、focused C46 41/41、`pnpm typecheck`/`pnpm lint`/`pnpm check:size`（270 files）/`pnpm build`/`git diff --check` PASS。この記録時点ではChrome実機はNOT_RUNだった。後続実機結果はC46行および次の手動確認節に記録する。

## C46 09:33:56 / 09:35:09 JST実機観測と本文抽出修正

- 09:33:56 JST、対象IDを独立したMarkdown code span段落に置いた回答では、回答完了検出後にBridge候補2件を取得したが、本文照合は`no-matching-ids`、登録未実行。
- 09:35:09 JST、同じIDを全角括弧で囲う平文にした回答では、回答完了イベント検出、候補2件、本文照合1件、監視登録1件。B監視1件、表示名「C46_診断上書き対策_明示対象のみ」、設定内件数1、対照候補は非登録となり、**正仕様の対象1件のみ自動登録が初めてPASS**。これはユーザー提示スクリーンショットの記録である。
- Aの「実行中2」表示は確認したが、手動操作なしに更新されたかは未確認。対象終了後の通知と自動解除も未確認で、今回のPASSに含めない。
- ソース調査では、統計用`visibleText`がdetached cloneの`innerText`を読み、段落間の視覚的改行を失い得ること、および旧token境界が日本語文字を継続文字として拒否し得ることを確認した。fake DOMの回帰テストで再現できたため、自動監視専用本文抽出だけにHTMLブロック/`br`の境界を加え、統計文字数経路は維持した。ASCII識別子の部分一致・連結、異なるtarget prefix、URL内/埋込ID、hidden/toolbar除外、Bridge live候補のみの照合も維持する。
- 実機のDOMと本文は直接観測していないため、09:33のFAILの根本原因は確定しない。この時点では段落code span、日本語隣接、Markdown表/コードブロックを含む修正版Chrome受入は**NOT_RUN**だった。後続の10:00:42 JST観測は次節に記録する。
- 今回の自動回帰テストと全体検証結果は`docs/c46-auto-watch-completion-diagnostic.md`に追記する。Chromeロード元への反映や実機操作は未実施。

## C44 配備後の手動確認

1. `chrome://extensions`でChatPanelPlusを手動再読み込みし、対象ChatGPT会話ページをF5で再読み込みする。
2. Aでthreadを選択し、Bが25秒以内に一覧を表示するか、timeout/送信元/保存失敗等の明示理由と「再試行」を表示することを確認する。
3. 一覧が正常ならBの明示開始を行い、上部の「監視中」件数が更新されることを確認する。稼働中の別watchが通知を送る可能性があるため、再読み込みのタイミングに留意する。
4. 再発時はBのエラー文言と画面状態を記録する。スクリーンショットや記録に会話本文、thread ID、owner情報、tokenを含めない。

## C45 配備後の手動確認

1. 現ソース修正をChrome登録済みロード元へ配備した後、拡張と対象ChatGPT会話を手動で再読み込みする。Chromeロード元への配備・reloadは今回未実施。
2. 元からある監視recordを操作せず、専用の新しいtest threadを登録して前面で約5秒周期の更新を確認する。background alarmは30秒周期のまま。
3. test threadの確実な`in_progress`から`completed`/`failed`/`interrupted`への遷移を確認し、対象watchだけが解除され、Cに新しい終了eventが一件残ることを確認する。試験前後にCをclearしない。別watchがあれば維持されることも確認する。
4. terminal statusが見えても安全条件を満たさないケースではwatchが残り、Bに「通知判定保留」と理由・`turnChange`が出ることを確認する。eventが生成されたと扱わず、Cの既存通知clear表示とも区別する。
5. 保存失敗・baseline既終端・gap/unknown/inferred・別turnのcurrent_execution・event保存失敗を確認する。remote targetは専用test threadでeventのtarget/thread identityが一致することを確認する（prefix不一致拒否は既存自動テスト対象）。test threadだけを試験後に解除し、周期、通知、event、alarm、他watchへの影響と未実施項目をC45欄に記録する。



## C46 配備後の手動確認

1. 2026-11-24にユーザーがChromeの実ロード元`D:\weito\Documents\src\codexapp\ChatPanelPlus\dist`をreloadし、対象ChatGPTページをF5済み。これ以後の新buildを受け入れるときはユーザーが再度reload/F5する。
2. 専用会話・targetで自動監視登録をONにする。ONにしただけではBridge `running_only=true`照会もwatch登録も起きないことを確認する。OFFでは回答完了後もBridge候補照会を行わない。
3. 正仕様の基本経路は09:35:09の平文・全角括弧、10:00:42のコード装飾付きIDで対象1件だけの照合/登録をPASS記録済み。独立した`<p><code>ID</code></p>`段落と前後の日本語段落が同じ形で通ること、日本語隣接の平文、Markdown表、コードブロックは個別に確認する。
4. Bridge応答待ちにmain/turn再描画・再配置、属性/装飾/UI変更、本文の非ID部分変更を行っても、現在の3条件が成り立つ場合は通ることを確認する。現在本文から候補IDがなくなる、assistant ID/state不一致、turnが曖昧、別routeへ切り替わる場合は登録しない。IDなし・過去turnだけ・関係ないUUID多数・partial/substring/Turn ID・URL path内/識別子への埋込・hidden/UI文字列、複数/重複ID、別owner/target/connection、SPA切替、Bridge失敗/未対応/候補上限、manual解除skip、32件上限も専用データで確認する。短命threadは回答完了前に終了すれば登録されなくてよい。
5. 拡張worker restore後に旧自動探索alarmが有効化されず、回答完了eventが再送されない限り登録が再実行されないことを確認する。登録済みwatchの5秒/30秒poll、C45終端通知/自動解除、manual watchが維持されることも確認する。
6. OFF後も既存watchと通知履歴が残ることを確認する。既存の無関係なwatch/eventやBridgeの本番状態は変更せず、C46専用の結果だけを記録する。
7. Aの実行中件数が2と表示された状態について、手動更新をせずに自動更新されたかを別項目として観測する。09:35:09 JSTの「2」表示だけでは自動更新の有無は未確認。
8. 今回は対象終了後にB/設定内監視0、C通知1、検出10:05:09 JSTを表示した。技術情報が折りたたまれ通知identityは直接照合していないため、C46正常系の部分証拠として記録済み。C45専用の通知identity確認、厳密poll周期、音声・異常系は別項目として受け入れる。

## 未決事項・実装上の保留

| 項目 | 現状 | 必要な判断／影響 |
|---|---|---|
| C47 Chrome受入 | 2026-11-24、ユーザー報告による主要正常系は部分PASS（repo直下`dist/` reload/F5、空欄反映・本文一致、既存draft・順次複数反映・当該試験での重複なし）。OFF・過去event、watch起点、選択範囲、近接/同時完了、owner/SPA、audio/mute、IME/添付、取得失敗・手動fallbackと送信前DOM／未送信状態の独立観測はNOT_RUN。 | `docs/c47-terminal-answer-auto-reflect-acceptance.md`に記録したユーザー報告の証跡と、未受入ケースを参照。 |
| Bridge event総保持上限 | 未確認eventは削除せず、確認済み履歴は最新128件を保持。総件数に上限なし。 | 保存量上限と、上限到達時の確認前eventの扱いが未決定。Phase 4はこのためPARTIAL。 |
| 通常回答完了音でconversation ID不明 | 既存経路を保ち、会話別mute仕様を確定していない。 | 未知会話での実効音声policyを決める。 |
| Options「既定値に戻す」 | 新しい会話別panel stateへの適用範囲は未決定。既存reset挙動は変更していない。 | 新規stateをreset対象に含める範囲を決める。 |
| final-answer詳細異常系 | C37主要正常系は2026-11-23の実機再確認でPASS。初回失敗時はBridge新API応答の`native_thread_id`をCPPの厳格な完全一致キー検査が拒否していたことを特定し、CPP commit `c40dea06814b46257342243fca91dbe5241a6ee0`で既知native identity一致を条件に許容した。 | owner/target越境、欠落・複数item、未知field・不正/過大本文、route/接続競合など詳細異常系を確認し、現行の厳格な拒否とfallback禁止を維持する。 |
| ownerless legacy保守 | 通常panelに表示せず、ownerを推定しない。旧watchの解除・移行の管理導線は未設計。 | 他会話へ情報を漏らさない管理方法を決める。 |
| CodexBridge server-side running-first | CPPは現在の取得済みページだけを並べ替える。通常の`codex_threads`ページ外の状態は不明で、このCPP turnではserver-side optionを追加していない。 | Bridge側でactive priority-listと通常paginationを併用する案を別途設計する。重複除外、cursor、remote targetを検討する。 |
| Phase 6のブラウザ外観確認 | Phase6 React/CSSを実装し、ユーザー提示画像の構成を基準にした。実際のChrome描画と幅・色・tooltipは未確認。 | 登録済みdistへの配備後、通常/展開/最小化の見た目をChromeで確認する。 |
| 実機受入 | 本書の行別確認が多数残る。C46基本正常経路は10:00:42 JST以降の観測でPASS、C38/C45は部分観測。 | 本書冒頭の重要度順にユーザーが同一Chrome環境で実施し、観測した項目だけ証跡と判定を更新する。 |

## 自動検証の既知記録

- Phase 2: 501/501 PASS、typecheck/lint PASS、登録済みrepo直下`dist/`へ配備済み。Phase 2 Chrome確認は延期。
- Phase 3: 518/518 PASS、typecheck/lint PASS、登録済み`dist/`へ配備済み。live `dist/`は隔離テスト前後で11ファイルの相対path・size・SHA-256一致。
- Phase 4初回: 527/527 PASS。最終レビュー修正commit `048953c3bd44298a9261048209c433eb9acc2d40` 後: 539/539 PASS、修正焦点suite 29/29 PASS、typecheck/lint PASS、隔離テスト前後のlive `dist/` 11ファイルSHA-256 manifest一致。新規兄弟バックアップ11/11一致後に`pnpm build` exit 0で登録済み`dist/`を更新し、配備後11ファイル・Manifest V3/version 0.1.5・必須6ファイル・7参照・hashを確認。Chrome reload・実機受入は**NOT_RUN**。総保持方針の判断は未完了。
- C12 thread表示 follow-up commit `c528acd37e9b0d907175f4e19019c6913f027eca`: 全548/548 PASS、typecheck/lint PASS。隔離テスト前後でlive `dist/` 11/11 hash一致。新規兄弟バックアップの全件照合後に`pnpm build` exit 0、Manifest V3/version 0.1.5、必須6ファイル・参照・C12表示markerを確認。Chrome C12再試験はNOT_RUN。
- C30 speaker UI follow-up commit `82c0dd7fc131dec320a47c4cd16b9c8a22e6b454`: 全548/548 PASS、typecheck/lint PASS。隔離テスト前後でlive `dist/` 11/11 hash一致。配備前バックアップ `ChatPanelPlus-dist-c30-predeploy-backup-20261121-220527-c5308142b8dd48208b4c600962dee589` 11/11一致後、登録済み`dist/`へ`pnpm build` exit 0。Manifest V3/version 0.1.5、必須6ファイル・参照整合、C12/C30 bundle markerを確認。Chrome C30再試験はNOT_RUN。
- Phase 6 UI code commit `3aca9ca05b52b0ca4232aee3b80d72dae6f62f70`: 全552/552 PASS、Phase6/Bridge/音声/統計focused tests 34/34 PASS、typecheck/lint PASS、サイズ検査200 files PASS。隔離ソースコピーでの全テスト前後、live `dist/` 11ファイルの相対path・size・SHA-256が一致。配備前バックアップ `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-predeploy-backup-20261122-012236-b904e2364297495daf438482a97522f8` は11/11一致後、`pnpm build` exit 0で登録済みrepo直下`dist/`へ配備。配備後11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML/CSS参照5件、Phase6 bundle marker 10/10を確認。変更pathは`content.js`のみ。SHA-256一覧はPhase6仕様書に記録。Chrome reload・実機表示確認はNOT_RUN。
- Phase 6 running_only CPP integration commit `4cee26e980e2bfaf32e0f2a299c86a0c4082073d`: 直前の隔離suite 563/563・focused 50/50 PASS、typecheck/lint/size PASS。今回typecheck/lint再確認PASS、全テストは再実行せず。live repo `dist/`のbackup `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-phase6-runningonly-predeploy-backup-20261122-072227-7ce881baefb7451d8d5438a8d5f9e510`とbuild前11/11 path/size/SHA-256一致後、`pnpm build` exit 0で配備。配備後11ファイル、Manifest V3/version 0.1.5、必須6ファイル、HTML参照2件、running_only/Phase6 marker 8/8。Bridge再起動はユーザー報告済みだがlive app schemaは未確認、Chrome reload・C31–C36/C38はNOT_RUN。完全hash manifestは`docs/panel-main-phase6-visual-spec.md`。
- Phase 5はこのチェックリスト作成のみでコードを変更していないため、追加build・dist配備は不要。Chrome実機受入は**NOT_RUN**。
- 2026-11-22 follow-up（project folder filter、panel viewport scroll、owner別通知clear、watch owner後勝ち移管、C37診断、C43エラー表示）の当時記録: source-only一時コピーで`pnpm test` 601/601 PASS、関連focused 93/93 PASS、`pnpm typecheck`・`pnpm lint`・source size PASS。test buildは一時copy内だけ。live repo `dist/`は前後11/11相対path/size/SHA-256一致。repo dist build/deploy・Chrome操作は未実施。C39–C43は実機NOT_RUN、C37は当時FAIL／原因未特定だった。C37の後続結果はC37行を参照。
- 2026-11-22正式dist配備（実装commit `97ee87a2dc55af88b0bbb6a3a05ba8cfdae2d5cd`）: `pnpm typecheck`・`pnpm lint`・`pnpm check:size` PASS。バックアップ `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08` はbuild前11/11 relative path/size/SHA-256一致、link/reparseなし。登録済みrepo直下`dist/`への`pnpm build` exit 0。配備後11ファイル、Manifest V3/version 0.1.5、必須6/6、HTML refs 5/5、CSS URL refs 0、project folder/options/filter・通知clear・owner移管・B disabled理由・viewport/running_only・C37 parserのmarker 12/12、C37 strict-parser checks 4/4（`agentMessage`、`phase`、`final_answer`、`latest_agent_message` fallbackなし）。旧hashed Options assetsを置換・除去し、残存なし。post-build hash manifest: `D:\weito\Documents\src\codexapp\ChatPanelPlus-dist-pre-c39-c43-20261122-20261122-093145-34a03d4d1f33425f87970380cf367a08.postbuild.manifest.json`。Chrome reloadは未実施、C39–C43 NOT_RUN。Bridge再起動後に実行中0表示というユーザー報告は部分観測にとどまり、この配備のC38はNOT_RUN。C37はFAIL／原因未特定を維持。初回marker検査はminify前の空白差でfalse negativeとなったが、その時点でbackupへ復元し11/11照合PASS。再ビルド後はminify表記に合わせた12/12 marker検査がPASS。今回の配備先はユーザーが確認したrepo直下`dist/`。`AGENTS.md`/`README.md`/`pnpm deploy:chrome`は兄弟Probeを参照する既存不整合が残るため、同コマンドは実行していない。
- C46旧誤仕様（実行中thread全件の周期探索・登録）の実装履歴（2026-11-23）：この時点の旧実装について`pnpm test` 694/694、typecheck/lint PASS、source size 248 files PASS（各500行/32768 bytes以下）、独立`pnpm build` exit 0。5/30秒scan・backoff等のテスト記録は旧誤仕様に対するもので、Bridge-first実装の受入根拠にしない。owner/connection/target拒否、manual stop suppression、watch上限、worker restoreとC45 terminal経路の観測は過去記録として保持する。Options resetはconfig/view-state keyのみで自動設定・既存monitor keyを変更しない。`dist/`は当時のローカルbuildで生成。Chrome正式ロード元・実機受入・Bridge操作は当時未実施。この記録時点ではC38がNOT_RUN、C45が修正後再受入待ち。後続の2026-11-24 C46連続観測は表の限定的な部分結果を参照する。
