# 複数音声出力先 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` inline; do not create a worktree or delegate. Steps use checkbox syntax for tracking.

**Goal:** 通知音を保存済みの複数物理出力へ一度ずつ並行再生し、未選択時は従来の既定出力経路を使う。

**Architecture:** 既存の独立storage keyをschema 2の`devices`配列へ移行する。旧`{deviceId,label}`は読み込み時に変換し、空配列は既定出力、重複IDは1件へ正規化する。schema 2の`default`単独は空配列へ正規化し、物理出力との混在は破損として拒否する。Optionsの個別チェック変更はWeb Locks下で最新保存値へ適用する。複数物理出力ではOffscreen内でデバイスごとにAudioContextを作り、全結果を集計する。既定のみのChatGPT/試聴は従来のContent/Optionsローカル経路、Codexは従来どおりOffscreenを使う。

**Spec:** GitHub [Issue #20](https://github.com/weito-crowry/ChatPanelPlus/issues/20)、[追加UIコメント](https://github.com/weito-crowry/ChatPanelPlus/issues/20#issuecomment-7123024582)、本作業に対するユーザー指示。

## Global Constraints

- 配列の物理出力上限は8件。既定出力は配列に入れず、空配列で表す。
- デバイス同一性は厳密な`deviceId`だけで判定し、label一致から物理同一性を推測しない。
- 不正保存値は破損扱いとし、明示的なユーザー操作なしに上書きしない。
- 選択済み未接続デバイスを保存・表示し、接続一覧から消えても選択を解除しない。
- 個別出力失敗はほかの出力へ影響させない。部分再生時に既定出力への再送はしない。
- Web Locksで複数Optionsの選択変更を直列化し、各変更を最新保存値へ適用する。
- 共通設定JSONの範囲を拡張しない。独立出力keyはJSON backup/import対象外とUI・文書に明示する。
- 会話owner/mute guard、通知event一意性、C51の独立音源・音量・enabled、既定再生挙動を維持する。
- C52実機受入はユーザー実施のためNOT_RUNとし、C48〜C51の観測記録を変更しない。

## Review Focus

- `default`と物理出力が同時保存された不正値を破損として拒否し、既存値を保持する。default単独は空配列へ正規化する。
- 未知schema、壊れたdevice、上限超過、storage失敗を読み込み・保存で上書きしない。
- 別Optionsでの並行変更と外部storage更新後に古い全件snapshotで選択を巻き戻さない。
- 同名labelの異なるID、未接続選択、再接続、出力一覧の再列挙を別々に扱う。
- 個別sink拒否、AudioContext生成例外、Offscreen transport失敗を他出力へ伝播させず、通知/試聴で全成功・部分成功・全失敗を区別する。

---

### Task 1: versioned出力選択repository

**Files:** `src/shared/answer-completion-output-device.ts`, `options/src/saved-data-manager.ts`, `tests/answer-completion-output-device*.test.ts`, `tests/options-saved-data-manager.test.ts`

**Interfaces:** `AnswerCompletionOutputDeviceSelection { schemaVersion: 2; devices: readonly AnswerCompletionOutputDevice[] }`を導入し、repositoryのload/subscribeはこの選択を返す。`setDeviceSelected(device, selected)`は保存値を再読込して該当IDのみ変更する。最大8件。legacy単体値を互換読み込みする。

- [x] schema 2、legacy/default migration、duplicate/default検証、invalid/上限、破損保護、Web Locks下の並行member updateを示すテストを先に追加し、失敗を確認する。
- [x] repositoryと保存データinventory validatorを変更し、対象テストを通す。

### Task 2: 複数選択Options UI

**Files:** `options/src/AnswerCompletionOutputDeviceSettings.tsx`, `options/src/OptionsPage.tsx`, `tests/answer-completion-sound-ui.test.mjs`, `tests/options-page.test.mjs`

**Interfaces:** UIはversioned selectionを読み、出力ごとのcheckboxを即時保存する。再列挙後も保存済み未接続選択を表示し、選択件数/上限、明示的な再列挙・権限導線、空選択時の既定出力表示を提供する。

- [x] checkbox/件数/未接続行/選択解除/上限/権限と即時保存のUI契約テストを追加し、失敗を確認する。
- [x] UIを実装し、data managerの既存独立key集計に合わせる。共通JSON export/importから出力先を除外する旨を表示する。

### Task 3: Offscreen fanoutと結果集計

**Files:** `src/shared/answer-completion-output-device-protocol.ts`, `src/offscreen/answer-completion-audio.ts`, `src/background/offscreen-audio-transport.ts`, new `tests/answer-completion-output-device-fanout.test.ts`

**Interfaces:** Offscreen要求は1..8個の一意な出力ID（またはCodexの単一`default`）を受ける。結果は`complete`/`partial`/`failed`、試行数・成功数・失敗理由数を含む。各IDは独立AudioContextを使う。

- [x] allSettled相当のファンアウトで成功/部分失敗/全失敗、factory例外、sink拒否でもContextを解放し、結果が独立するテストを追加して失敗を確認する。
- [x] protocol validator、fanout、transport response validationを実装し、結果集計テストを通す。

### Task 4: ChatGPT/Codex通知・試聴への接続

**Files:** `src/background/answer-completion-output-device.ts`, `src/background/codexbridge-notifications.ts`, `src/shared/codexbridge-thread-monitor-protocol.ts`, `src/background/thread-monitor.ts`, `src/content/answer-completion-output-device-route.ts`, `src/content/ConversationStatistics.tsx`, `src/content/codexbridge-watch-presentation.ts`, `options/src/AnswerCompletionSoundSettings.tsx`, related tests.

**Interfaces:** 空選択ではChatGPT/試聴に`default` route、CodexにはOffscreenの`default`を使う。物理選択では一通知につき1つのfanout要求を出す。部分成功をUIおよびCodex eventのplayed/partial-output診断に反映し、全失敗は既存の明示エラーとする。mute/owner guardはfanout全体で一度だけ適用する。

- [x] 既定/物理出力の経路、部分成功診断、Codex専用音設定、owner/mute/重複抑止を回帰テストで固定して失敗を確認する。
- [x] background/content/previewを接続し、既定経路への二重fallbackや全fanout再試行がないことを確認する。

### Task 5: C52 docs・全体検証・commit

**Files:** `docs/c52-multiple-output-devices-acceptance.md`, `docs/panel-main-v2-final-acceptance-checklist.md`, `docs/panel-main-v2-phase-progress.md`, `docs/design/05-settings-storage.md`, `docs/design/13-answer-completion-sound.md`

- [x] C52 Chrome実機手順とNOT_RUN記録を追加し、C48〜C51の観測状態が維持されることを差分で確認する。
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`を実行する。
- [x] 差分レビュー後、Issue #20実装を独立commitする。push/merge/Issue close/Chrome操作は行わない。
