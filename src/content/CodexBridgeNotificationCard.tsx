import type { CodexBridgeTerminalEvent, CodexBridgeFinalAnswerResult } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { eventKindLabel, eventStatusLabel, finalAnswerLabel } from './codexbridge-watch-presentation.ts';

type Props = Readonly<{
  events: readonly CodexBridgeTerminalEvent[];
  selectedEvent: CodexBridgeTerminalEvent | null;
  selectedEventId: string | null;
  currentConnectionId: string | null;
  busyKey: string;
  answerBusy: boolean;
  answerMessage: string;
  operationMessage: string;
  displayedAnswer: CodexBridgeFinalAnswerResult | null;
  threadLabel: (targetId: string, threadId: string) => string;
  onAcknowledge: () => void;
  onClear: () => void;
  onSelectEvent: (eventId: string) => void;
  onFetchAnswer: () => void;
  onCopyAnswer: (event: CodexBridgeTerminalEvent, text: string) => void;
  onInsertAnswer: (event: CodexBridgeTerminalEvent, text: string) => void;
}>;

function dateLabel(value: string | null): string {
  if (value === null) return '未取得';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ja-JP') : '不明';
}

export function CodexBridgeNotificationCard({
  events, selectedEvent, selectedEventId, currentConnectionId, busyKey, answerBusy, answerMessage,
  operationMessage, displayedAnswer, threadLabel, onAcknowledge, onClear, onSelectEvent, onFetchAnswer, onCopyAnswer, onInsertAnswer,
}: Props) {
  return (
    <section className="phase6-card phase6-card-c" aria-label="通知・最終回答">
      <div className="codex-bridge-event-heading">
        <h2>C 通知・最終回答</h2>
        <button type="button" className="codex-bridge-button" onClick={onAcknowledge}
          disabled={busyKey !== '' || !events.some((event) => !event.acknowledgedAt)}>
          {busyKey === 'acknowledge' ? '確認中…' : '未確認の終了通知を確認'}
        </button>
        <button type="button" className="codex-bridge-button" onClick={onClear}
          disabled={busyKey !== '' || events.length === 0}>
          {busyKey === 'clear' ? '削除中…' : '通知をクリア'}
        </button>
      </div>
      {operationMessage && <p className="codex-bridge-note" role="status">{operationMessage}</p>}
      {events.length === 0 && <p className="codex-bridge-empty">通知イベントはありません。</p>}
      {events.length > 0 && <ul className="codex-bridge-event-list" aria-label="監視終了イベント一覧">
        {events.map((event) => <li key={event.eventId} className="codex-bridge-event-item">
          <button type="button" className="codex-bridge-event-select" aria-pressed={event.eventId === selectedEventId}
            onClick={() => onSelectEvent(event.eventId)}>
            <strong>{eventKindLabel(event.status)} · {threadLabel(event.targetId, event.threadId)}</strong>
            <small>検出: {dateLabel(event.detectedAt)}</small>
            <small>{event.acknowledgedAt ? 'ユーザー確認済み' : '未確認の終了通知'}</small>
          </button>
          <details className="phase6-technical-details">
            <summary>技術情報</summary>
            <small>event ID: {event.eventId} · turn ID: {event.turnId}</small>
            <small>thread ID: {event.threadId} · target ID: {event.targetId}</small>
            <small>状態: {eventStatusLabel(event)}{event.notificationReason ? ` · ${event.notificationReason}` : ''}</small>
            {event.connectionId !== currentConnectionId && <small>イベント発生時と現在の接続先が異なります。</small>}
          </details>
        </li>)}
      </ul>}
      {selectedEvent && <div className="codex-bridge-final-answer">
        <strong>選択中: {eventKindLabel(selectedEvent.status)} · {dateLabel(selectedEvent.detectedAt)}</strong>
        <details className="phase6-technical-details">
          <summary>技術情報</summary>
          <small>event ID: {selectedEvent.eventId} · turn ID: {selectedEvent.turnId} · thread ID: {selectedEvent.threadId}</small>
        </details>
        <button type="button" className="codex-bridge-button" onClick={onFetchAnswer}
          disabled={answerBusy || selectedEvent.connectionId !== currentConnectionId}>
          {answerBusy ? '最終回答を取得中…' : '最終回答を取得'}
        </button>
        {selectedEvent.connectionId !== currentConnectionId && <p className="codex-bridge-note">イベント発生時のBridge接続先と現在の接続先が一致しません。</p>}
        {displayedAnswer && <>
          <p className="codex-bridge-note" role="status">{finalAnswerLabel(displayedAnswer)}</p>
          {displayedAnswer.status === 'retrieved' && <>
            {displayedAnswer.completeness === 'unconfirmed' &&
              <p className="codex-bridge-note">Bridge応答には切詰め情報がないため、取得本文の完全性は確認できません。</p>}
            <div className="codex-bridge-answer-actions">
              <button type="button" className="codex-bridge-button" onMouseDown={(event) => event.preventDefault()}
                onClick={() => { void onCopyAnswer(selectedEvent, displayedAnswer.text); }}>コピー</button>
              <button type="button" className="codex-bridge-button" onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsertAnswer(selectedEvent, displayedAnswer.text)}>ChatGPT入力欄へ挿入</button>
            </div>
            <pre className="codex-bridge-answer-text">{displayedAnswer.text}</pre>
          </>}
        </>}
        {answerMessage && <p className="codex-bridge-note" role="status">{answerMessage}</p>}
      </div>}
    </section>
  );
}
