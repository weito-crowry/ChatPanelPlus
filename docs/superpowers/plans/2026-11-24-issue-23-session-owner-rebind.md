# Issue #23 session owner rebind 実装計画

> **実装方式:** superpowers:executing-plansを使って、このcheckoutで順に実装する。作業規約に従いサブエージェント・worktreeは使用しない。

**Goal:** session内owner leaseを使い、同じ会話の自動監視/watch/eventを現在のtop-frame tabへ再bindする。

**Architecture:** 永続ON/OFFは現行local entryに残し、`chrome.storage.session`のidentity別leaseが実行ownerを決める。lease claimのたびに同一identityのwatch/event owner hintを更新し、新規eventのpending配送には永続claim stateを使う。

**Tech Stack:** Chrome MV3, TypeScript, chrome.storage.local/session, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-24-issue-23-session-owner-design.md`

## Global Constraints

- 接続・target・会話identityは`(connectionId, targetId, conversationId)`を使う。
- session lease不在時は旧local `ownerTabId`をowner根拠にせず、既存live tabへの一時無応答だけではleaseを移さない。
- 同一canonical threadのowner排他、C49会話並行、C47/C50/C51/C52の意味を維持する。
- user文章、回答本文、thread ID、tokenを新しい永続ログへ書かない。
- Chrome実機受入はユーザー担当で`NOT_RUN`記録にする。C53の観測状態を変えない。
- ソース・設定・テスト1ファイルは最大500行かつ32 KiB。

## Review Focus

- 同一会話2 tabの同時claimは一つの実行ownerに直列化する — session lease test。
- ping無応答の既存ownerは奪わず、closed/different-conversationだけをrebindする — owner identity test。
- owner不在で保存した新eventだけ再開時に一度配送し、送信結果不明は再試行しない — delivery-state tests。
- browser restart/reload後の旧tab ID再利用をsession leaseなしとして扱い、異会話のwatchを移さない — rebind tests。
- storage failureと旧formatは別会話の設定/skip/mute/eventを壊さない — migration/failure tests。

---

### Task 1: session leaseとowner rebind

**Files:** lease、registration owner/queue helperを追加。`codexbridge-thread-monitor.ts`、`thread-monitor-auto-registration.ts`、`thread-monitor-storage.ts`、`background.ts`を変更。`tests/codexbridge-owner-identity.test.ts`、`tests/codexbridge-auto-watch-owner-rebind.test.ts`へテストを追加。

**Interfaces:** lease APIはidentity単位に`claim(identity, senderTabId)`を直列化し、`claimed | current | other-tab | recovering | storage-error`を返す。現在senderは`trustedConversation`でtop-frame/URL/conversationを検証し、既存tabの照合にはnonce付きpingを使う。storage rebind APIは同じconnection/target/conversationに限ってownerTabIdとmute snapshotを置換する。

- [x] session emptyでも旧local ownerTabIdに依存せず初回GETでclaimできるテストを書く。
- [x] worker restart相当でleaseを維持、session reset/ID reuse相当で再claim、同時claim、live同会話・別会話・closed・unknownをテストする。read/write失敗はstorage-errorで確認する。
- [x] 同一identityの自動entry/watch/eventだけをrebindし、skip/latest mute revision/既読/最終回答、他identity・canonical thread排他を保持するテストを書く。
- [x] focused testsをREDで確認してからsession storeとrebindを実装し、GREENを確認する。

### Task 2: new event pending dispatchと重複防止

**Files:** `src/shared/codexbridge-thread-monitor-protocol.ts`、`src/background/thread-monitor-storage.ts`、新しい`terminal-event-delivery.ts`を追加。`src/background/codexbridge-thread-monitor.ts`と`background.ts`を接続。`tests/codexbridge-terminal-event-delivery.test.ts`とowner/rebind testsを追加。

**Interfaces:** 新eventにだけoptionalな`ownerDeliveryState`を保存する。旧eventでこの値がないものはhistoricalとしてdispatchしない。pendingをstorage mutateでrequestedへclaimしてから送信し、成功時のみdeliveredにする。送信例外後はrequestedを再送しない。owner/mute解決はsession leaseを使う。

- [x] owner不在pending→次回claimで一度配信、requestedのworker restart再送なし、send結果不明の再送なし、旧event replayなしをテストする。
- [x] dispatch対象のevent payloadがidentity-onlyで、会話/connection/target/threadが一致しないownerへ流れず、音声はowner不在時skipして遅延再生しないテストを書く。
- [x] focused testsをRED確認後に実装し、GREENを確認する。

### Task 3: status UI・受入記録・全体検証

**Files:** `CodexBridgeAutoWatchControl.tsx`、failure presentation、`docs/c54-session-owner-rebind-acceptance.md`、最終acceptance checklist/progress doc。

- [x] recovery中とlive別tab ownerの表示・会話全体ON/OFFラベルをテストする。
- [x] C54のChrome手順にSW restart/browser restart/tab ID reuse相当/拡張reload・SPA・同一会話2 tab・異会話並行・pending delivery/mute/skip/C47/C49/C50/C53回帰を記し、未報告項目は`NOT_RUN`とする。
- [x] `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`を実行する。C48-C53の既存受入記録が変わっていないことを差分確認する。
- [x] 独立commitを作り、branch/HEAD/statusを確認する。push/merge/Issue closeはしない。
