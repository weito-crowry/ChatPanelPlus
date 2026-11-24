# Issue #23 設計: ブラウザーsession内の会話owner再bind

## 意図と範囲

Chrome再起動・拡張reload後、同じChatGPT会話を開いたときに永続ON設定を再利用し、自動監視と既存watch/eventのownerを現在のsession tabへ結び直す。`ownerTabId`は互換・配送hintとして残すが、sessionをまたぐ排他根拠にはしない。

## Approaches

- 永続`ownerTabId`とpingを引き続き正とする案は、browser session後のtab ID変化を解決しないため採らない。
- `chrome.storage.session`にidentity別owner leaseを置く案を採る。MV3 worker再起動中は残り、Chrome再起動・extension reload/updateではChromeの仕様どおり消える。現在の信頼済みtop-frame senderが自動claimし、既存tabはnonce付きidentity pingで検証する。
- 監視・通知の全owner実装を一本化する大規模改修は別工程とし、今回は自動登録/既存watch/eventに共通するidentity別resolverだけを追加する。

## 振る舞い

- 永続設定identityは`(connectionId, targetId, conversationId)`。session leaseの存在だけを同一session内のowner根拠とし、leaseなし時にlocalの旧tab IDを再利用しない。leaseのread/write失敗はstorage errorとして扱う。
- 自動設定OFFかつ同identityのwatch/eventがない会話はruntime ownerをclaimしない。明示ONまたは手動watch開始時に休止leaseを解放してからclaimし、設定OFFでも既存watch/eventがあればそのidentityのowner bindingを維持する。
- ownerが同じtabなら継続。別tabが同じ会話としてnonce pingに応答すれば「別tabで実行中」。旧tabが閉じた、または別会話へ移ったことを確認できた場合はclaim/rebindする。一時無応答・初期化遅延は「復旧中」とし再試行し、live ownerを奪わない。claimはidentity単位に直列化する。
- rebindは同一connection/target/conversationの自動entryとwatch/eventのowner hint・mute snapshotだけを更新する。skip、通知/既読、最終回答、watch identity、別会話のデータは維持する。旧versionの自動entry/watch/eventは読み込み互換を保つ。
- 明示ON/OFFは会話全体の永続設定を切り替える操作として表示する。別tabはowner leaseを奪わず、enabled状態の表示と実行owner状態を区別する。
- 新規terminal eventだけ`pending`で配送対象にする。session ownerが得られたら送信前に永続claimし、送信成功は`delivered`、結果不明は`requested`のままにして再送しない。owner不在でpendingのeventは同じidentityの次回claim時に一度だけ配送する。既存eventはpendingへ移行しない。結果不明の最終回答は手動取得可能とし、自動再挿入しない。
- 終端音は従来のnotification stateとowner mute guardに従う。owner不在・mute不明時はskipし、遅延再生や過去音の再生はしない。C47の有効時刻、C50 template、C51/C52設定、会話別C47状態は既存契約を維持する。
- browser/extension session reset後、Bridge tokenが別途再認証を要する場合はowner復帰とは独立して既存認証フローで扱う。

## 非目標と受入境界

監視基盤全体の統合、Bridge認証変更、自動送信、過去eventの一括dispatch/replayは対象外。通常Chromeでの再起動・tab ID再利用相当・reload・SPA/複数tab受入はユーザーが行い、本変更ではC54受入表に`NOT_RUN`として記録する。C48-C53の既存観測は変更しない。C53未報告項目は`NOT_RUN`を保つ。
