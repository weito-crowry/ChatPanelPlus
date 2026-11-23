import type { CodexBridgeObservation, CodexBridgeLastTurn } from '../shared/codexbridge-mcp-protocol.ts';

export function attentionLabel(value: boolean | null | undefined): string {
  return value === true ? '要対応' : value === false ? '不要' : '不明';
}

export function stateLabel(value: string | null | undefined): string {
  if (!value) return '不明（未取得）';
  if (value === 'not_loaded') return '未読込';
  if (value === 'unknown') return '不明';
  if (value === 'in_progress' || value === 'running') return '実行中';
  if (value === 'estimated_running') return '実行中の推定';
  return value;
}

export function observationLabel(value: CodexBridgeObservation | null | undefined): string {
  if (!value) return '不明（未取得）';
  const state = stateLabel(value.state);
  const evidence = value.evidence === 'inferred' ? '推定' : value.evidence === 'live' ? 'ライブ観測' : value.evidence;
  return [state, evidence, value.reason, value.observedAt].filter(Boolean).join(' · ');
}

export function lastTurnLabel(value: CodexBridgeLastTurn | null | undefined): string {
  if (!value) return '不明（未取得）';
  const status = value.status === 'completed' ? '完了' : value.status === 'failed' ? '失敗'
    : value.status === 'interrupted' ? '中断' : value.status === 'in_progress' ? '進行中'
      : value.status === 'unknown' ? '不明' : '不明（status未取得）';
  const evidence = value.evidence === 'inferred' ? '推定' : value.evidence === 'live' ? 'ライブ観測' : value.evidence;
  return [status, value.category, evidence, value.reason, value.observedAt].filter(Boolean).join(' · ');
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '不明';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ja-JP') : '不明';
}
