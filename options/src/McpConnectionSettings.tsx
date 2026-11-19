import { useEffect, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_TEST_MESSAGE,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
  type CodexBridgeMcpDiagnosticCode,
  type CodexBridgeMcpTestResponse,
} from '../../src/shared/codexbridge-mcp-protocol.ts';

type Props = Readonly<{
  endpoint: string;
  disabled: boolean;
  onEndpointChange: (value: string) => void;
}>;

const DIAGNOSTIC_MESSAGES: Record<CodexBridgeMcpDiagnosticCode, string> = {
  'invalid-endpoint': '接続先URLを確認してください。HTTPまたはHTTPSのURLが必要です。',
  'permission-required': '接続先へのアクセスが許可されませんでした。接続確認時にホスト権限を許可してください。',
  'authentication-required': '認証に失敗しました。保存したtokenを確認してください。',
  forbidden: 'サーバーから接続を拒否されました。',
  'endpoint-not-found': 'MCP endpointが見つかりません。接続先URLを確認してください。',
  'session-expired': 'MCP sessionを再作成できませんでした。もう一度接続確認してください。',
  'http-error': 'サーバーがHTTPエラーを返しました。',
  disconnected: 'サーバーへ接続できませんでした。接続先とサーバーの起動状態を確認してください。',
  timeout: '接続確認が時間切れになりました。',
  'protocol-error': 'MCP応答を確認できませんでした。',
  'protocol-version-unsupported': 'サーバーのMCP protocol versionには対応していません。',
  'readonly-tool-unavailable': '読み取り確認用のcodex_targets toolがありません。',
  'readonly-probe-failed': 'codex_targetsの読み取り確認に失敗しました。',
  'storage-error': 'token保存領域を読み取れませんでした。',
  'unknown-error': '接続確認に失敗しました。',
};

function isTestResponse(value: unknown): value is CodexBridgeMcpTestResponse {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) {
    return 'protocolVersion' in value && typeof value.protocolVersion === 'string'
      && 'toolCount' in value && typeof value.toolCount === 'number'
      && 'readOnlyProbe' in value && value.readOnlyProbe === 'codex_targets';
  }
  return value.ok === false && 'reason' in value
    && typeof value.reason === 'string'
    && Object.prototype.hasOwnProperty.call(DIAGNOSTIC_MESSAGES, value.reason);
}

export function McpConnectionSettings({ endpoint, disabled, onEndpointChange }: Props) {
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenStatus, setTokenStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [diagnostic, setDiagnostic] = useState('');

  useEffect(() => {
    let active = true;
    void chrome.storage.session.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]).then((stored) => {
      if (active) setTokenSaved(typeof stored[CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY] === 'string');
    }).catch(() => {
      if (active) setTokenStatus('token保存状態を読み取れませんでした。');
    });
    return () => { active = false; };
  }, []);

  async function saveToken() {
    if (token.length === 0) return;
    try {
      await chrome.storage.session.set({ [CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]: token });
      setToken('');
      setTokenSaved(true);
      setTokenStatus('tokenをブラウザーセッションへ保存しました。');
    } catch {
      setTokenStatus('tokenを保存できませんでした。');
    }
  }

  async function clearToken() {
    try {
      await chrome.storage.session.remove(CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY);
      setTokenSaved(false);
      setTokenStatus('保存したtokenを削除しました。');
    } catch {
      setTokenStatus('tokenを削除できませんでした。');
    }
  }

  async function testConnection() {
    const parsed = parseCodexBridgeMcpEndpoint(endpoint);
    if (!parsed) {
      setDiagnostic(DIAGNOSTIC_MESSAGES['invalid-endpoint']);
      return;
    }
    setChecking(true);
    setDiagnostic('');

    let granted: boolean;
    try {
      const permissionRequest = chrome.permissions.request({ origins: [parsed.originPattern] });
      granted = await permissionRequest;
    } catch {
      granted = false;
    }
    if (!granted) {
      setDiagnostic(DIAGNOSTIC_MESSAGES['permission-required']);
      setChecking(false);
      return;
    }

    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_TEST_MESSAGE,
        endpoint: parsed.url,
      });
      if (!isTestResponse(response)) {
        setDiagnostic(DIAGNOSTIC_MESSAGES['unknown-error']);
      } else if (response.ok) {
        setDiagnostic(`接続確認成功: MCP ${response.protocolVersion}、tools/list ${response.toolCount}件、codex_targetsを読み取り確認しました。`);
      } else {
        setDiagnostic(DIAGNOSTIC_MESSAGES[response.reason]);
      }
    } catch {
      setDiagnostic(DIAGNOSTIC_MESSAGES['unknown-error']);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="settings-card mcp-connection-settings" aria-labelledby="mcp-connection-title">
      <h2 id="mcp-connection-title">CodexBridge MCP接続</h2>
      <p>接続確認はtools/listと読み取り専用のcodex_targetsだけを実行します。</p>
      <label className="mcp-endpoint-label">
        接続先URL
        <input
          type="url"
          value={endpoint}
          disabled={disabled}
          onChange={(event) => onEndpointChange(event.currentTarget.value)}
        />
      </label>
      <p className="mcp-permission-note">接続確認を押すと、入力したホストへのアクセス権限をChromeに要求します。URLはOptionsの「保存」で保存します。</p>
      <label className="mcp-token-label">
        Bearer token
        <input
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setToken(event.currentTarget.value)}
        />
      </label>
      <div className="mcp-actions">
        <button type="button" disabled={token.length === 0} onClick={() => void saveToken()}>tokenを保存</button>
        {tokenSaved && <button type="button" onClick={() => void clearToken()}>保存tokenを削除</button>}
        <span>{tokenSaved ? 'tokenはsession storageに保存済みです。' : 'tokenは未保存です。'}</span>
        {tokenStatus && <span role="status">{tokenStatus}</span>}
      </div>
      <button type="button" disabled={disabled || checking} onClick={() => void testConnection()}>
        {checking ? '接続確認中…' : '接続確認'}
      </button>
      <p className="mcp-diagnostic" role="status">{diagnostic}</p>
    </section>
  );
}
