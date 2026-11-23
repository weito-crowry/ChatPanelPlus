import { useId } from 'react';
import type { ConversationPanelWatchSelection } from '../shared/conversation-panel-state-repository.ts';
import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import type { CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { codexBridgeWatchThreadLabel } from './codexbridge-thread-presentation.ts';
import {
  terminalHoldReasonLabel,
  watchConnectionLabel,
  watchDateLabel,
  watchOutcomeLabel,
  watchTurnStateLabel,
} from './codexbridge-watch-presentation.ts';

type Props = Readonly<{
  items: readonly CodexBridgeWatchSnapshot[];
  currentConnectionId: string | null;
  selection: ConversationPanelWatchSelection | null;
  threadCandidates: readonly Pick<CodexBridgeThread, 'id' | 'targetId' | 'title'>[];
  busyKey: string;
  onSelect: (item: CodexBridgeWatchSnapshot) => void;
  onStop: (item: CodexBridgeWatchSnapshot) => void;
}>;

export function CodexBridgeWatchList({ items, currentConnectionId, selection, threadCandidates, busyKey, onSelect, onStop }: Props) {
  const idPrefix = useId();
  return <ul className="codex-bridge-watch-list" aria-label="監視対象一覧">
    {items.map((item, index) => {
      const sameConnection = item.connectionId === currentConnectionId;
      const outcome = watchOutcomeLabel(item.fetchOutcome);
      const terminalObserved = ['completed', 'failed', 'interrupted'].includes(item.lastTurnStatus ?? '');
      const isSelected = selection?.connectionId === item.connectionId && selection.targetId === item.targetId
        && selection.threadId === item.threadId;
      const threadIdDescriptionId = `${idPrefix}-watch-${index}`;
      return <li key={item.watchId} className="codex-bridge-watch-item">
        <div className="codex-bridge-watch-heading">
          <button type="button" title={item.threadId} aria-describedby={threadIdDescriptionId}
            className="codex-bridge-watch-select" aria-pressed={isSelected} onClick={() => onSelect(item)}>
            <strong>{codexBridgeWatchThreadLabel(threadCandidates, item.targetId, item.threadId, true)}</strong>
          </button>
          <span id={threadIdDescriptionId} className="phase6-sr-only">スレッドID：{item.threadId}</span>
          <button type="button" className="codex-bridge-button" onClick={() => onStop(item)}
            disabled={busyKey !== ''} aria-label={`${item.threadId}の監視を解除`}>
            {busyKey === `stop:${item.watchId}` ? '解除中…' : '解除'}
          </button>
        </div>
        <small className="phase6-watch-status">{watchTurnStateLabel(item, sameConnection)}</small>
        <details className="phase6-technical-details">
          <summary>技術情報</summary>
          <small>thread ID: {item.threadId} · target ID: {item.targetId}</small>
          <small>connection ID: {watchConnectionLabel(item.connectionId)}</small>
          <small>取得: {outcome} · {watchDateLabel(item.observedAt)} · 最終成功: {watchDateLabel(item.lastSuccessAt)}</small>
          <small>baseline: {item.baselineTurnId ?? '不明'} · 最終観測: {item.lastObservedTurnId ?? '不明'}</small>
          <small>状態遷移: {item.turnChange} · 終端保留: {terminalObserved
            ? terminalHoldReasonLabel(item.terminalHoldReason) : 'なし'}</small>
          <small>codex_status: {item.statusState ?? '不明'} · last_turn: {item.lastTurnStatus ?? '不明'} / {item.lastTurnEvidence ?? '不明'}</small>
          <small>current_execution: {item.currentExecutionState ?? '不明'} · turn_id: {item.currentExecutionTurnId ?? '不明'} / {item.currentExecutionEvidence ?? '不明'} · reason: {item.currentExecutionReason ?? '不明'}</small>
          <small>needs_attention: {item.needsAttention === true ? '要対応' : item.needsAttention === false ? '不要' : '不明'}</small>
        </details>
      </li>;
    })}
  </ul>;
}
