# ChatPanelPlus メインパネル再設計 v2 — 最終Chrome受入チェックリスト

## 実施条件と記録方法

- 対象はWindows 11上の既存Chromeプロファイルと、拡張機能に登録済みのrepo直下`dist/`。本チェックリスト作成時にChrome reload・画面操作はしていない。
- Phase 1は2026-11-21にユーザーから「Chrome側で再読み込みし、動いた」と報告され、Phase全体の受入PASSを記録済み。個々の操作結果は未報告なので、本書の行を遡ってPASSにはしない。
- Phase 2〜4の自動テスト・型検査・Lint・配備は各Phase記録を参照する。ここに並ぶChrome操作はすべて**NOT_RUN**から開始する。
- 実施時は同じChromeプロファイルを使い、Phase 5配備後の拡張を手動reloadしてから確認する。各行の結果を`PASS`／`FAIL`／`NOT_RUN`へ更新し、会話本文・秘密値を含めないスクリーンショット、簡潔な操作記録などの証跡を記入する。
- Bridgeの確認には利用許可のあるテスト用threadを使い、会話IDや本文を記録へ転記しない。自動送信しない。

## Chrome受入項目

| ID | 環境・操作 | 期待結果 | 結果 | 証跡・メモ |
|---|---|---|---|---|
| C01 正式ロード元 | `chrome://extensions`で登録済み拡張のロード元がrepo直下`dist/`であることを確認し、今回のPhase 4配備後に手動reloadする。 | 正しい拡張が起動し、別のProbeフォルダを読み込んでいない。 | NOT_RUN | |
| C02 通常画面 | 任意の会話を開き、パネル通常表示を見る。 | ヘッダー、作業中toggle、既存音声・統計操作、Optionsで解決した常時ボタンとタブ／promptボタンが保たれる。Bridge件数欄は2項目だけ。 | NOT_RUN | |
| C03 Optionsボタン定義 | Optionsで設定済みのラベル、文面、表示、順序、グループを確認し、4つの既定prompt（全文／要約／翻訳／調べて）を確認する。 | Options設定が優先され、非表示ボタンを強制表示せず、重複表示しない。自動送信しない。 | NOT_RUN | |
| C04 既存入力操作 | 既存prompt／カスタムボタンを選択し、入力先のcaret・選択位置、paste/manual paste、clear、copyを操作する。 | 既存の挿入・clipboard・focus動作を保ち、不要な本文置換や自動送信をしない。 | NOT_RUN | |
| C05 Bridge詳細・最小化 | 詳細をpointerとkeyboardで開閉し、最小化・復帰する。 | `aria-expanded`と詳細領域が一致し、Bridge詳細はA thread一覧→B監視登録→C終了通知の順。最小化で本文が隠れ復帰する。 | NOT_RUN | |
| C06 幅とレイアウト | 最大幅900px付近と640px未満の幅で、通常・詳細・最小化を確認する。 | 件数・操作が重ならず、横はみ出しや読めない折返しがない。 | NOT_RUN | |
| C07 同一会話UI状態 | 会話Aで選択tab、最小化、Bridge詳細開閉を変え、同じ会話を別Chrome tabで開き、reloadする。 | UI状態はconversation ID単位で共有され、遅延読込で古いroute状態へ戻らない。 | NOT_RUN | |
| C08 別会話UI状態・SPA | 会話A/Bそれぞれで異なる状態を保存し、同一tabでSPA遷移し、戻る／再reloadする。 | A/Bの状態が混ざらず各会話に復元される。conversation ID不明時は保存済み状態を誤読・上書きしない。 | NOT_RUN | |
| C09 Codex作業中mode | A/Bと同一会話別tabで既存作業中状態を切替・reloadする。 | 既存のtab×conversation保存に従い、パネルUI状態・音声mute変更が干渉しない。 | NOT_RUN | |
| C10 mute分離 | 同一会話を2つのChrome tabで開き、片方だけmute。続いて別会話でも切替。 | muteはChrome tab ID＋conversation ID単位。同じ会話の別tabと別会話の状態を上書きしない。 | NOT_RUN | |
| C11 共通音声設定 | Optionsで共通音声有効化、音量、音色、出力先を確認・変更し、別会話へ移動する。 | これらはブラウザ共通のまま。会話別muteは共有有効化を変更しない。実効可聴条件は共有ONかつowner mute OFF。 | NOT_RUN | |
| C12 Bridge discovery | 会話A/BでBridge詳細のthread候補を確認し、実行状態順とowner分離を再確認する。 | Aの一般Codex thread探索は共有でよい。読み込み済みの確定実行中が先頭、推定中が次、その他は後。候補に監視owner会話や終了件数を混ぜない。 | FAIL（修正前の実機指摘）／修正後再確認NOT_RUN | 2026-11-21ユーザー実機報告：実行中threadが先頭でなかった。 |
| C13 owner監視と表示分離 | 会話Aからthreadを監視登録し、Bを開いて同じthreadを確認する。Aの別tabも開く。 | BはAのwatch名・件数・event有無を一切表示しない。Aの別tabはAのwatchとeventを共有する。登録元muteはAの元tab設定を使う。 | NOT_RUN | |
| C14 owner conflictと履歴帰属 | Aで登録済みの同一watch identityをBから登録しようとし、Aで解除後Bから再登録する。 | Bの重複登録はowner conflictとして拒否。解除・再登録後も過去eventの所有会話は変更しない。 | NOT_RUN | |
| C15 件数とTurn重複 | owner会話で同じthreadの複数terminal Turn、重複refresh、他会話のwatchを含む状況を作る。 | 「監視中」は現在会話のwatch数。「監視スレッドが終了した未確認」は未確認Turn eventを持つ一意watch identity数。別会話・ownerlessは除外。 | NOT_RUN | |
| C16 終了通知ACK | Aで未確認通知を確認し、Aの別tabとBの件数を見る。確認直前に新しい終了eventも発生させる。 | Aの対象eventだけ確認済みになり、ACKは冪等。競合して発生した新eventは未確認のまま。Bの件数は変化しない。 | NOT_RUN | |
| C17 legacy ownerless | owner metadataのない既存watch/eventがある環境で通常パネルを見る。 | 旧データは保存・監視を維持するが、通常panelのどの会話にも流用・表示・計上しない。音声をskipし、他会話情報を漏らさない。 | NOT_RUN | 該当データなしの場合はNOT_RUNと記録 |
| C18 登録元muteでBridge完了音 | watch登録元Aをmute/unmuteしつつ、別会話Bをactiveにした状態でBridge監視対象を終了させる。登録元tabを閉じるケースも確認する。 | active tabでなくowner watchの最新muteを使う。mute中／owner mute不明は音をskipし、event・視覚通知・未確認件数は記録する。tab終了後は最終既知muteを使い、別tabへfallbackしない。 | NOT_RUN | 実音声の証跡は内容を含めない |
| C19 音声raceと共通gate | mute切替と通知再生を近接させ、共有音声OFF、volume 0、再生デバイス不在も確認する。 | 再生直前の最新owner policyを使い、mute・owner不明・共有OFF・volume 0では音が鳴らない。音声をskipしても通知は残る。 | NOT_RUN | |
| C20 final-answer owner認可 | Aの終了eventを選び、Aで取得・表示・copy・挿入し、同じ会話別tabでも試す。Bから同じevent IDにアクセスする。 | Aのeventだけが取得でき、同じ会話の別tabは許可。Bは拒否され本文・event存在を漏らさない。copyと挿入は明示操作のみで、自動送信しない。 | NOT_RUN | |
| C21 final-answer完全性 | 最終回答項目なし、複数候補、履歴不足のeventで取得する。 | 別messageを最終回答と推測しない。no-final-answer／不完全を示し、完全性未確認の注意を保つ。 | NOT_RUN | CodexBridge側履歴の欠落が既知 |
| C22 SPA中の非同期結果 | Aでfinal-answer取得を開始し、応答待ち中にBへSPA遷移する。取得後にcopy／挿入操作も試す。 | 古いrouteのevent選択・本文・非同期結果を破棄。挿入直前にも現在routeとownerを照合し、BへAの本文を入れない。 | NOT_RUN | |
| C23 worker／Bridge復旧 | 監視中にService Worker休止・再起動、Bridge接続の切断・復旧を自然に発生させ、一覧を再取得する。 | watch/event owner、mute snapshot、ACK状態が復元される。二重eventや誤通知を発生させず、未知状態を完了と誤判定しない。 | NOT_RUN | 手動でworkerを破壊せず通常の休止／再開で観察 |
| C24 権限・認証・接続変化 | Bridgeの権限不足、認証切れ、接続先変更を再現できる場合に一覧・read・stopを確認する。 | 現行エラー表示を保ち、別会話情報やfinal本文を返さない。接続先変更中は古いevent本文を再利用しない。 | NOT_RUN | 環境で再現できない項目はNOT_RUN |
| C25 CPP UIからの実ジョブ開始 | CPPの既存画面に対象環境で使用するジョブ開始導線がある場合だけ、その承認済み手順でテスト用jobを開始する。 | 対象jobが意図した会話・Bridge threadへ紐づき、監視eventがownerを保つ。既存UIに開始機能がない場合は未対応として記録し、新規APIや自動送信を代用しない。 | NOT_RUN | 現在の実ジョブ開始動作は未検証 |
| C26 deployコマンドの宛先 | 配備手順を記録で確認する。`pnpm deploy:chrome`は実行しない。 | 実際の登録元はrepo直下`dist/`。現行`deploy:chrome`は兄弟Probeへコピーする宛先不一致を未修正として認識し、今後も登録元へは`pnpm build`を使う。 | NOT_RUN | スクリプト修正は本Phase外 |
| C27 大量ACKと部分失敗 | owner会話に129件以上（可能なら256件）の未確認終了eventがあるテスト環境で一括確認する。通信失敗を挿入できる場合は2回目のbatchを失敗させ、その間に新eventを発生させる。 | 最大128 IDsずつ直列処理し、全件成功時は未確認数が減る。部分失敗は応答件数と一覧再取得を表示し、成功済み以外を未確認のまま残す。操作開始時snapshot外の新eventは確認済みにしない。 | NOT_RUN | 自動では129/256、途中失敗、新event並行を検証済み |
| C28 B/C選択の会話別復元 | 会話AでB監視対象とC終了eventを選ぶ。同じ会話の別tab/reload、別会話B、A thread探索の選択をそれぞれ確認する。watch解除またはevent一覧からの消失後も確認する。 | B/C選択だけが同一conversation ID内で共有・復元される。A探索選択とは独立し、別会話には漏れない。owner一覧にない選択は解除され、最終回答本文は保存・越境表示されない。 | NOT_RUN | 自動ではconversation state、旧schema、owner filterを検証済み |
| C29 実行中優先・読み込み済みfilter | thread一覧を更新し、確定実行中・推定実行中・不明・非実行中を含む状態を確認する。checkboxをON/OFFし、次ページ取得前後も見る。選択中threadがfilterで隠れるケースも確認する。 | 確定中（`in_progress`／`running`）が先頭、推定中はその次に推定ラベル付きで表示。各群は有効な`updatedAt`新しい順、欠損/不正時刻は末尾で安定順。不明とlast_turnだけでは実行中扱いしない。filterは初期OFF、ONでは読み込み済みの確定/推定のみ表示し、対象範囲を明記。次ページは常に取得可能で再取得後に順位再評価。空結果・未読込・失敗を区別し、非表示選択と監視操作を維持する。 | NOT_RUN | ページ外threadの状態は本APIでは不明。自動では優先度、merge、filter、checkbox/ARIA、選択維持を検証 |

## 判断待ち・実装上の保留

| 項目 | 現状 | 必要な判断／影響 |
|---|---|---|
| Bridge event総保持上限 | 未確認eventは削除せず、確認済み履歴は最新128件を保持。総件数に上限なし。 | 保存量上限と、上限到達時の確認前eventの扱いが未決定。Phase 4はこのためPARTIAL。 |
| 通常回答完了音でconversation ID不明 | 既存経路を保ち、会話別mute仕様を確定していない。 | 未知会話での実効音声policyを決める。 |
| Options「既定値に戻す」 | 新しい会話別panel stateへの適用範囲は未決定。既存reset挙動は変更していない。 | 新規stateをreset対象に含める範囲を決める。 |
| final-answer本文の完全性 | Bridgeのhistoryにfinal itemがない実例があり、完全性は未確認。推測選択はしない。 | Bridgeが正確な最終回答を返す条件と、取得不足時の受入方法を確認する。 |
| ownerless legacy保守 | 通常panelに表示せず、ownerを推定しない。旧watchの解除・移行の管理導線は未設計。 | 他会話へ情報を漏らさない管理方法を決める。 |
| 実機受入 | Phase 2〜5のChrome操作・実音声・実ジョブ・復旧は未実施。 | 本書の項目をユーザーが同一Chrome環境で実施し、証跡と判定を記録する。 |

## 自動検証の既知記録

- Phase 2: 501/501 PASS、typecheck/lint PASS、登録済みrepo直下`dist/`へ配備済み。Phase 2 Chrome確認は延期。
- Phase 3: 518/518 PASS、typecheck/lint PASS、登録済み`dist/`へ配備済み。live `dist/`は隔離テスト前後で11ファイルの相対path・size・SHA-256一致。
- Phase 4初回: 527/527 PASS。最終レビュー修正commit `048953c3bd44298a9261048209c433eb9acc2d40` 後: 539/539 PASS、修正焦点suite 29/29 PASS、typecheck/lint PASS、隔離テスト前後のlive `dist/` 11ファイルSHA-256 manifest一致。新規兄弟バックアップ11/11一致後に`pnpm build` exit 0で登録済み`dist/`を更新し、配備後11ファイル・Manifest V3/version 0.1.5・必須6ファイル・7参照・hashを確認。Chrome reload・実機受入は**NOT_RUN**。総保持方針の判断は未完了。
- Phase 5はこのチェックリスト作成のみでコードを変更していないため、追加build・dist配備は不要。Chrome実機受入は**NOT_RUN**。
