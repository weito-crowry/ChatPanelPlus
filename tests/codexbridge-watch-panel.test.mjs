import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/content/CodexBridgeWatchPanel.tsx', import.meta.url));
const cardPath = fileURLToPath(new URL('../src/content/CodexBridgeNotificationCard.tsx', import.meta.url));
const stylePath = fileURLToPath(new URL('../src/content/codexbridge-watch.css', import.meta.url));
const presentationPath = fileURLToPath(new URL('../src/content/codexbridge-watch-presentation.ts', import.meta.url));
const feedbackPath = fileURLToPath(new URL('../src/content/codexbridge-watch-start-feedback.ts', import.meta.url));

test('watch UI selects terminal events and fetches only after an explicit click', async () => {
  const [source, card] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(cardPath, 'utf8')]);
  assert.match(card, /C 通知・最終回答/);
  assert.match(card, /最終回答を取得/);
  assert.match(card, /onClick=\{onFetchAnswer\}/);
  assert.match(source, /onFetchAnswer=\{\(\) => \{ void fetchSelectedAnswer\(\); \}\}/);
  assert.match(source, /type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,[\s\S]*?eventId: event\.eventId/);
  assert.match(source, /event\.connectionId !== currentConnectionId/);
  assert.match(source, /answerGeneration\.current/);
});

test('copy and insertion are independent user actions and the answer is rendered as text', async () => {
  const [source, card] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(cardPath, 'utf8')]);
  assert.match(card, /onClick=\{\(\) => \{ void onCopyAnswer\(selectedEvent, displayedAnswer\.text\); \}\}/);
  assert.match(card, /onClick=\{\(\) => onInsertAnswer\(selectedEvent, displayedAnswer\.text\)\}/);
  assert.match(source, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(source, /insertAtCaret\(text, environment, snapshot\)/);
  assert.match(card, /<pre className="codex-bridge-answer-text">\{displayedAnswer\.text\}<\/pre>/);
  assert.doesNotMatch(card, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER[\s\S]{0,300}CODEX_BRIDGE_MCP_GET_STATUS/);
});

test('answer retrieval leaves the composer draft untouched and never sends automatically', async () => {
  const [source, card] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(cardPath, 'utf8')]);
  const retrieval = source.slice(source.indexOf('async function fetchSelectedAnswer'), source.indexOf('async function acknowledgeVisibleEvents'));
  assert.doesNotMatch(retrieval, /insertAtCaret|clearComposer|requestSubmit|\.submit\(/);
  assert.doesNotMatch(card, /type="submit"/);
  assert.match(card, /onClick=\{\(\) => onInsertAnswer\(selectedEvent, displayedAnswer\.text\)\}/);
  assert.match(source, /insertAtCaret\(text, environment, snapshot\)/);
});

test('conversation owner is required for watch data, final-answer actions, and ACK; raw shared storage is never rendered', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /conversationIdFromPath\(window\.location\.pathname\) !== requestConversationId/);
  assert.match(source, /conversationIdFromPath\(window\.location\.pathname\) !== event\.ownerConversationId/);
  assert.match(source, /type: CODEX_BRIDGE_WATCH_ACK_EVENTS,[\s\S]*?conversationId: currentConversationId,[\s\S]*?eventIds/);
  assert.match(source, /filterOwnedWatchData\(data, ownerConversationId\)/);
  assert.match(source, /summaryCallbackRef\.current\?\.\(owned\.summary\)/);
  assert.doesNotMatch(source, /acceptStoredItems|setEvents\(.*newValue/);
});

test('通知クリアは確認後、現在会話のevent ID snapshotだけを削除し監視ACKを維持する', async () => {
  const [source, card] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(cardPath, 'utf8')]);
  assert.match(card, /通知をクリア/);
  assert.match(card, /onClick=\{onClear\}/);
  assert.match(source, /監視登録は残ります/);
  assert.match(source, /window\.confirm\(`現在の会話に属する終了通知/);
  assert.match(source, /currentEvents\.filter\(\(event\) => event\.ownerConversationId === ownerConversationId\)/);
  assert.match(source, /type: CODEX_BRIDGE_WATCH_CLEAR_EVENTS,[\s\S]*?conversationId: ownerConversationId,[\s\S]*?eventIds: batch/);
  assert.match(source, /clearCodexBridgeEventIds\(eventIds/);
  assert.match(source, /clearInFlight\.current/);
  assert.match(source, /setEventOperationMessage\(`現在の会話の終了通知/);
  assert.match(source, /CODEX_BRIDGE_WATCH_ACK_EVENTS/);
});

test('ACK snapshots visible IDs and uses bounded serial batches with a partial-failure result', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /acknowledgeCodexBridgeEventIds\(/);
  assert.match(source, /confirmedCount/);
  assert.match(source, /未確認分は再試行できます/);
});

test('watch and event selection are conversation-owned persisted props and only owner items can select', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /bridgeWatchSelection: ConversationPanelWatchSelection \| null/);
  assert.match(source, /bridgeEventSelection: string \| null/);
  assert.match(source, /item\.ownerConversationId !== ownerConversationId/);
  assert.match(source, /event\.ownerConversationId === conversationId/);
  assert.match(source, /onSelectBridgeWatch/);
  assert.match(source, /onSelectBridgeEvent/);
});

test('別会話のwatch再登録成功を通知し、過去eventは元ownerのまま扱う', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /response\.data\.transferred === true/);
  assert.match(source, /監視登録をこの会話へ移管しました。過去の通知は元の会話に残ります。/);
  assert.match(source, /ownerConversationId !== ownerConversationId/);
  assert.doesNotMatch(source, /別会話の登録元で監視中です/);
});

test('Aのthread選択・更新は監視開始を送らず、Bの明示ボタンだけがWATCH_STARTを起動する', async () => {
  const [list, watch] = await Promise.all([readFile(fileURLToPath(new URL('../src/content/CodexBridgeList.tsx', import.meta.url)), 'utf8'), readFile(sourcePath, 'utf8')]);
  assert.doesNotMatch(list, /CODEX_BRIDGE_WATCH_START|startWatch\(/);
  assert.match(list, /CODEX_BRIDGE_MCP_GET_THREADS/);
  assert.match(list, /setWatchFeedbackResetToken\(\(current\) => current \+ 1\)/);
  assert.match(list, /watchFeedbackResetToken=\{watchFeedbackResetToken\}/);
  assert.match(watch, /type: CODEX_BRIDGE_WATCH_START/);
  assert.match(watch, /onClick=\{\(\) => \{ void startWatch\(\); \}\}/);
  assert.equal((watch.match(/void startWatch\(\);/g) ?? []).length, 1);
});

test('選択変更・A更新・明示再試行で旧エラーを整理し、disabled理由と取得失敗を明示する', async () => {
  const [source, presentation] = await Promise.all([
    readFile(sourcePath, 'utf8'), readFile(presentationPath, 'utf8'),
  ]);
  assert.match(source, /watchStartFeedback\.current\.invalidate\(\);\s*setWatchStartError\(''\);\s*setWatchMessage\(''\);\s*\}, \[selected\?\.targetId, selected\?\.threadId\]\)/);
  assert.match(source, /setWatchStartError\(''\);\s*setWatchMessage\(''\);\s*\}, \[watchFeedbackResetToken\]\)/);
  assert.match(source, /refreshList\(kind: WatchListRequestKind = 'storage', clearStartError = false\)/);
  assert.match(source, /if \(clearStartError\) setWatchStartError\(''\)/);
  assert.match(source, /refreshList\('manual', true\)/);
  assert.match(source, /recordFailure\(ticket, currentWatchStartIdentity\(\)\)/);
  assert.match(await readFile(feedbackPath, 'utf8'), /if \(reason === 'invalid-request'\) return/);
  assert.match(source, /watchStartFeedback\.current\.isCurrent\(ticket, currentWatchStartIdentity\(\)\)/);
  const foregroundRefresh = source.slice(source.indexOf('const refreshForeground'), source.indexOf('const timer'));
  assert.doesNotMatch(foregroundRefresh, /setWatchStartError/);
  assert.match(source, /watchStartError && <p className="codex-bridge-error" role="alert">\{watchStartError\}/);
  assert.match(source, /aria-describedby=\{startDisabledReason \? startReasonId : undefined\}/);
  assert.match(presentation, /Aのスレッド一覧で対象を選択してください/);
  assert.match(presentation, /Bridge接続IDが未取得です/);
  assert.match(presentation, /会話IDを確認できません/);
  assert.match(source, /role="alert">\{watchListFailureLabel\(listFailure\)\}/);
  assert.match(source, /再試行/);
});

test('B監視一覧は要求を調停・timeoutし、未取得/失敗を空一覧として表示しない', async () => {
  const [source, coordinator, response] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(fileURLToPath(new URL('../src/content/codexbridge-watch-list-coordinator.ts', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/content/codexbridge-watch-response.ts', import.meta.url)), 'utf8'),
  ]);
  assert.match(source, /new WatchListRequestCoordinator\(\)/);
  assert.match(source, /refreshList\('initial'\)/);
  assert.match(source, /refreshList\('foreground'\)/);
  assert.match(source, /refreshList\('storage'\)/);
  assert.match(source, /sendWatchListRequestWithTimeout/);
  assert.match(source, /coordinator\.finish\(token, succeeded\)/);
  assert.match(source, /coordinator\.isCurrent\(token\)[\s\S]*?conversationIdFromPath\(window\.location\.pathname\) !== requestConversationId/);
  assert.match(source, /listConversationId !== ownerConversationId \|\| listLoading \|\| listFailure[\s\S]*?\|\| !currentConnectionId/);
  assert.match(source, /currentItems\.length === 0 && listIsCurrent && !listLoading && !listFailure/);
  assert.match(source, /listIsCurrent && !listFailure \? `\$\{currentItems\.length\}件` : '—'/);
  assert.match(source, /summaryCallbackRef\.current\?\.\(null\)/);
  assert.match(coordinator, /CODEX_BRIDGE_WATCH_LIST_TIMEOUT_MS = 25_000/);
  assert.match(coordinator, /this\.automaticPaused \|\| this\.active !== null/);
  assert.match(response, /'sender-unverified' \| 'storage-error' \| 'invalid-response' \| 'timeout'/);
});

test('retrieved body completeness is labeled and Markdown whitespace remains visible', async () => {
  const [card, styles, presentation] = await Promise.all([
    readFile(cardPath, 'utf8'), readFile(stylePath, 'utf8'), readFile(presentationPath, 'utf8'),
  ]);
  assert.match(presentation, /完全性は未確認です/);
  assert.match(card, /displayedAnswer\.completeness === 'unconfirmed'/);
  assert.match(card, /Bridge応答には切詰め情報がない/);
  assert.match(styles, /\.codex-bridge-answer-text[^{]*\{[^}]*white-space:\s*pre-wrap/s);
});
