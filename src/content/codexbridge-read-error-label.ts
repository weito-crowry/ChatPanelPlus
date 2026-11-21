import type { CodexBridgeReadFailureReason } from '../shared/codexbridge-mcp-protocol.ts';

const ERROR_LABELS: Record<CodexBridgeReadFailureReason, string> = {
  'invalid-endpoint': '接続先URLを確認してください。',
  'permission-required': '接続先へのアクセス権限がありません。Optionsで権限を許可してください。',
  'authentication-required': '認証に失敗しました（401）。保存済みtokenを確認してください。',
  forbidden: 'この操作は許可されていません（403）。',
  'endpoint-not-found': 'MCP endpointが見つかりません。',
  'session-expired': 'MCP sessionが失効しました。もう一度更新してください。',
  'http-error': 'BridgeからHTTPエラーが返りました。',
  disconnected: 'Bridgeへ接続できません。',
  timeout: 'Bridgeへの要求がタイムアウトしました。',
  'protocol-error': 'Bridgeの応答形式を確認できません。',
  'protocol-version-unsupported': 'MCP protocol versionに対応していません。',
  'readonly-tool-unavailable': '必要な読み取りtoolがありません。',
  'running-only-unsupported': 'Bridge更新待ちです。実行中一覧APIに未対応です。通常一覧は利用できます。',
  'readonly-probe-failed': 'Bridgeの読み取りtoolが失敗しました。',
  'response-too-large': 'Bridgeの応答が上限を超えました。',
  'storage-error': '保存済み接続情報を読み取れません。',
  'settings-unavailable': '保存済み接続設定を読み取れません。',
  'unknown-error': 'Bridgeの読み取りに失敗しました。',
};

export function codexBridgeReadErrorLabel(reason: unknown): string {
  return typeof reason === 'string' && reason in ERROR_LABELS
    ? ERROR_LABELS[reason as CodexBridgeReadFailureReason]
    : 'Bridgeから不正な応答が返りました。';
}
