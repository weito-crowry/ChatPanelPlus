import type {
  CodexBridgeFinalAnswerResult,
  CodexBridgeTerminalEvent,
  CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { deriveCodexBridgeWatchTurnState } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeWatchListFailureReason } from './codexbridge-watch-response.ts';

const WATCH_OUTCOME_LABELS: Readonly<Record<CodexBridgeWatchSnapshot['fetchOutcome'], string>> = {
  ok: '取得成功', '401': '認証失敗（401）', '403': '拒否（403）', timeout: 'timeout',
  disconnected: '切断', unknown: '不明', 'permission-required': '権限なし',
  'settings-unavailable': '接続設定またはtokenを取得できません', 'endpoint-not-found': 'endpointなし',
  'session-expired': 'MCP session失効', 'http-error': 'HTTPエラー', 'protocol-error': '応答形式不明',
  'protocol-version-unsupported': 'protocol version非対応', 'readonly-tool-unavailable': 'codex_statusなし',
  'readonly-probe-failed': 'codex_status失敗', 'connection-changed': '接続先変更',
};

export function watchOutcomeLabel(outcome: CodexBridgeWatchSnapshot['fetchOutcome']): string {
  return WATCH_OUTCOME_LABELS[outcome] ?? '不明';
}

export function watchDateLabel(value: string | null): string {
  if (value === null) return '未取得';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ja-JP') : '不明';
}

export function watchTurnStateLabel(snapshot: CodexBridgeWatchSnapshot, sameConnection: boolean): string {
  if (!sameConnection) return '現在の接続先では未確認';
  if (snapshot.fetchOutcome !== 'ok') return '最新取得に失敗、現在状態不明';
  const state = deriveCodexBridgeWatchTurnState(snapshot);
  if (state === 'baseline') return '登録時のturn（新規完了ではありません）';
  if (state === 'running') return '別turnの実行を観測';
  if (state === 'in_progress') return '進行中';
  if (state === 'completed') return '新しいturnの完了を観測';
  if (state === 'failed') return '新しいturnの失敗を観測';
  if (state === 'interrupted') return '新しいturnの中断を観測';
  if (state === 'gap') return '観測gapあり（中間turn不明）';
  return '不明';
}

export function watchConnectionLabel(connectionId: string): string {
  return connectionId.length > 20 ? `${connectionId.slice(0, 15)}…${connectionId.slice(-6)}` : connectionId;
}

export function watchListFailureLabel(reason: CodexBridgeWatchListFailureReason | 'runtime-unavailable'): string {
  if (reason === 'sender-unverified') return '監視一覧: 会話ページの送信元を確認できません。SPA遷移が完了してから再試行してください。';
  if (reason === 'storage-error') return '監視一覧: 保存領域の読み取りに失敗しました。';
  if (reason === 'runtime-unavailable') return '監視一覧: 拡張機能から応答がありません。拡張機能とChatGPTタブを再読み込みしてください。';
  return '監視一覧: 応答形式を確認できません。';
}

export function watchStartDisabledReason(input: Readonly<{
  busy: boolean; conversationValid: boolean; loading: boolean; listFailure: boolean;
  connectionId: string | null; selected: boolean;
}>): string {
  if (input.busy) return '監視操作を処理中です。';
  if (!input.conversationValid) return '会話IDを確認できません。会話ページの再読込後に再試行してください。';
  if (input.loading) return '監視一覧と接続IDを読み込み中です.';
  if (input.listFailure) return '監視一覧を確認できません。上の再試行を行ってください。';
  if (!input.connectionId) return 'Bridge接続IDが未取得です。接続状態を確認してください。';
  if (!input.selected) return 'Aのスレッド一覧で対象を選択してください。';
  return '';
}

export function filterOwnedWatchData(
  data: Readonly<{ items: readonly CodexBridgeWatchSnapshot[]; events: readonly CodexBridgeTerminalEvent[] }>,
  ownerConversationId: string,
) {
  const items = data.items.filter((item) => item.ownerConversationId === ownerConversationId);
  const events = data.events.filter((event) => event.ownerConversationId === ownerConversationId);
  const unacknowledgedThreads = new Set(events.filter((event) => !event.acknowledgedAt)
    .map((event) => JSON.stringify([event.connectionId, event.targetId, event.threadId])));
  return { items, events, summary: { watchingCount: items.length, unacknowledgedThreadCount: unacknowledgedThreads.size } };
}

export function eventStatusLabel(event: CodexBridgeTerminalEvent): string {
  const state: Record<CodexBridgeTerminalEvent['notificationState'], string> = {
    pending: '音声通知結果不明（再試行なし）', requested: '音声要求済み（再生結果不明、再試行なし）',
    played: '音声再生成功', skipped: event.notificationReason === 'disabled' ? '音声通知無効' : '音声通知スキップ',
    failed: '音声再生失敗',
  };
  return state[event.notificationState];
}

export function eventKindLabel(status: CodexBridgeTerminalEvent['status']): string {
  return status === 'completed' ? '完了' : status === 'failed' ? '失敗' : '中断';
}

export function finalAnswerLabel(result: CodexBridgeFinalAnswerResult): string {
  if (result.status === 'retrieved') return '本文を取得しました。完全性は未確認です。';
  if (result.status === 'no-final-answer') return 'このturnのfinal_answerは見つかりませんでした。完全性は未確認です。';
  if (result.status === 'pending') return 'turnが未完了のため、取得を保留しました。';
  if (result.status === 'incomplete') {
    const labels: Record<typeof result.reason, string> = {
      'history-too-large': '履歴または本文が上限を超えたため、結果は不完全です。',
      'text-too-large': '本文が上限を超えたため、無言で切り詰めず取得を止めました。',
      'malformed-history': '履歴形式を確認できないため、最終回答を特定できません。',
      'turn-not-found': '指定turnを履歴内で確認できません。履歴応答の切り詰め情報がないため不完全です。',
      'multiple-matching-turns': '指定turnの候補が複数あり、回答を特定できません。',
      'multiple-final-answers': '最終回答候補が複数あり、本文を選べません。',
    };
    return labels[result.reason];
  }
  const labels: Record<typeof result.reason, string> = {
    'connection-changed': '接続先がイベント発生時から変わったため取得しませんでした。',
    'event-not-found': '選択したイベントが台帳にありません。',
    'authentication-required': '認証に失敗しました。', forbidden: 'Bridgeから拒否されました。',
    'endpoint-not-found': 'MCP endpointが見つかりません。', 'session-expired': 'MCP sessionが失効しました。',
    'http-error': 'BridgeからHTTPエラーが返りました。', disconnected: 'Bridgeに接続できません。',
    timeout: 'Bridgeへの要求がタイムアウトしました。', 'protocol-error': 'Bridgeの応答形式を確認できません。',
    'protocol-version-unsupported': 'MCP protocol versionに対応していません。',
    'readonly-tool-unavailable': 'codex_threads読み取りtoolがありません。',
    'readonly-probe-failed': 'codex_threadsの読み取りに失敗しました。',
    'permission-required': '接続先へのアクセス権限がありません。',
    'settings-unavailable': '接続設定を読み取れません。', 'unknown-error': '最終回答を取得できませんでした。',
  };
  return labels[result.reason];
}

export function editorInsertionFailureLabel(reason: string): string {
  const labels: Record<string, string> = {
    'ime-composing': 'IME変換中のため挿入しませんでした。',
    'composer-changed': '入力欄が切り替わったため挿入しませんでした。',
    'editor-not-found': 'ChatGPT入力欄が見つからないため挿入しませんでした。',
    'editor-hidden': 'ChatGPT入力欄が表示されていないため挿入しませんでした。',
    'editor-disabled': 'ChatGPT入力欄が編集できないため挿入しませんでした。',
    'selection-invalid': '入力位置を確認できないため挿入しませんでした。',
    'edit-rejected': 'ChatGPT入力欄が挿入を受け付けませんでした。',
    'edit-unconfirmed': '挿入結果を確認できないため、再試行しませんでした。',
    'unexpected-error': '挿入結果を確認できないため、再試行しませんでした。',
    'complex-content': '複雑な入力欄を確認できないため挿入しませんでした。',
  };
  return labels[reason] ?? '入力欄へ挿入できませんでした。';
}
