import type { CodexBridgeThread, CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';
import { attentionLabel, dateLabel, lastTurnLabel, observationLabel, stateLabel } from './codexbridge-thread-status-labels.ts';

type Props = Readonly<{
  selected: CodexBridgeThread;
  targetName: string | null;
  row: CodexBridgeThread | null;
  status: CodexBridgeThreadStatus | null;
  missing: boolean;
  listError: string;
  connectionError: boolean;
  listBusy: boolean;
  listLoaded: boolean;
  statusBusy: boolean;
  statusError: string;
  onCheckStatus: () => void;
}>;

export function CodexBridgeSelectedThreadDetails({ selected, targetName, row, status, missing, listError,
  connectionError, listBusy, listLoaded, statusBusy, statusError, onCheckStatus }: Props) {
  const displayedTurn = status ? status.lastTurn : row?.lastTurn;
  return (
    <div className="codex-bridge-selected phase6-selected-thread">
      <strong>{selected.title?.trim() || selected.preview?.trim() || 'タイトル未取得'}</strong>
      <p className="codex-bridge-note">対象マシン: {targetName ?? '不明'}</p>
      {missing && <p className="codex-bridge-note">
        {listError || connectionError || (listBusy && !listLoaded)
          ? 'thread一覧の更新を確認できていません。状態は未確認です。'
          : listLoaded
            ? '選択中のthreadは現在の一覧ページにありません。完了状態ではなく、状態は未確認です。'
            : 'thread一覧は未読込です。状態は未確認です。'}
      </p>}
      <button type="button" className="codex-bridge-button" onClick={onCheckStatus} disabled={statusBusy}>
        {statusBusy ? '確認中…' : '選択threadの状態を手動確認'}
      </button>
      {statusError && <p className="codex-bridge-error" role="alert">{statusError}</p>}
      <details className="phase6-technical-details">
        <summary>技術情報</summary>
        <code>thread ID: {selected.id} · target ID: {selected.targetId}</code>
        <p className="codex-bridge-note">cwd: {row?.cwd ?? '不明'} · 最終更新: {dateLabel(row?.updatedAt)}</p>
        <dl className="codex-bridge-status">
          <dt>応答状態</dt>
          <dd>{stateLabel(status?.state)}</dd>
          <dt>current_execution{status ? '（手動確認）' : '（一覧取得時）'}</dt>
          <dd>{observationLabel(status ? status.currentExecution : row?.currentExecution)}</dd>
          <dt>last_turn{status ? '（手動確認）' : '（一覧取得時）'}</dt>
          <dd>{lastTurnLabel(displayedTurn)}</dd>
          <dt>last_turn.turn_id</dt>
          <dd>{displayedTurn?.turnId ?? '不明'}</dd>
          <dt>needs_attention</dt>
          <dd>{attentionLabel(status ? status.needsAttention : row?.needsAttention)}</dd>
        </dl>
      </details>
    </div>
  );
}
