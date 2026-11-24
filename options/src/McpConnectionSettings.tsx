import { useEffect, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_SAFE_ERROR_NAMES,
  CODEX_BRIDGE_MCP_TEST_MESSAGE,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
  type CodexBridgeMcpDiagnosticCode,
  type CodexBridgeMcpDiagnosticStage,
  type CodexBridgeMcpTestResponse,
} from '../../src/shared/codexbridge-mcp-protocol.ts';
import {
  classifyMcpNetworkTarget,
  probeMcpLocalNetwork,
  readMcpLnaPermissionState,
  type McpLnaPermissionState,
  type McpNetworkTarget,
} from './mcp-network-access.ts';
import { requestMcpHostPermission } from './mcp-permissions.ts';

type Props = Readonly<{
  endpoint: string;
  disabled: boolean;
  onEndpointChange: (value: string) => void;
}>;

type HostPermissionState = 'checking' | 'granted' | 'required' | 'unavailable' | 'invalid';

const DIAGNOSTIC_MESSAGES: Record<CodexBridgeMcpDiagnosticCode, string> = {
  'invalid-endpoint': '接続先URLを確認してください。HTTPまたはHTTPSのURLが必要です。',
  'permission-required': '接続先へのアクセスが許可されませんでした。接続確認時にホスト権限を許可してください。',
  'authentication-required': '認証に失敗しました。保存したtokenを確認してください。',
  forbidden: 'サーバーから接続を拒否されました。',
  'endpoint-not-found': 'MCP endpointが見つかりません。接続先URLを確認してください。',
  'session-expired': 'MCP sessionを再作成できませんでした。もう一度接続確認してください。',
  'http-error': 'サーバーがHTTPエラーを返しました。',
  disconnected: 'HTTP要求が成立しませんでした。接続先、ブラウザー権限、CORS、Service WorkerのNetwork/Consoleを確認してください。原因はこの結果だけでは特定できません。',
  timeout: '接続確認が時間切れになりました。',
  'protocol-error': 'MCP応答を確認できませんでした。',
  'protocol-version-unsupported': 'サーバーのMCP protocol versionには対応していません。',
  'readonly-tool-unavailable': '読み取り確認用のcodex_targets toolがありません。',
  'running-only-unsupported': 'Bridgeのcodex_threads toolがrunning_onlyに対応していません。',
  'readonly-probe-failed': 'codex_targetsの読み取り確認に失敗しました。',
  'response-too-large': 'サーバー応答が上限を超えました。',
  'storage-error': 'token保存領域を読み取れませんでした。',
  'connection-changed': '接続設定が変わりました。現在の設定で再接続してください。',
  'read-queue-full': 'Bridge読み取り要求が混み合っています。少し待って再試行してください。',
  'unknown-error': '接続確認に失敗しました。',
};

function isDiagnosticStage(value: unknown): value is CodexBridgeMcpDiagnosticStage {
  return value === 'request' || value === 'http-response' || value === 'response-stream'
    || value === 'protocol' || value === 'timeout';
}

function isTestResponse(value: unknown): value is CodexBridgeMcpTestResponse {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) {
    return 'protocolVersion' in value && typeof value.protocolVersion === 'string'
      && 'toolCount' in value && typeof value.toolCount === 'number'
      && 'readOnlyProbe' in value && value.readOnlyProbe === 'codex_targets';
  }
  if (value.ok !== false || !('reason' in value) || typeof value.reason !== 'string'
    || !Object.prototype.hasOwnProperty.call(DIAGNOSTIC_MESSAGES, value.reason)) return false;
  if ('stage' in value && !isDiagnosticStage(value.stage)) return false;
  if ('httpStatus' in value && (typeof value.httpStatus !== 'number'
    || !Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599)) return false;
  if ('errorName' in value && (typeof value.errorName !== 'string'
    || !CODEX_BRIDGE_MCP_SAFE_ERROR_NAMES.includes(value.errorName as typeof CODEX_BRIDGE_MCP_SAFE_ERROR_NAMES[number]))) return false;
  return true;
}

function permissionQuery(): Parameters<typeof readMcpLnaPermissionState>[1] {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.permissions?.query !== 'function') return undefined;
    return (name) => navigator.permissions.query({ name: name as PermissionName });
  } catch {
    return undefined;
  }
}

function lnaStatusText(target: McpNetworkTarget, state: McpLnaPermissionState): string {
  if (target === 'external') return 'Local Network Access: 外部接続先のため対象外です。';
  if (target === 'unknown') return 'Local Network Access: 接続先の範囲を分類できないため事前確認を行いません。';
  const name = target === 'loopback' ? 'Loopback Network Access' : 'Local Network Access';
  if (state === 'granted') return `${name}: 許可済みです。`;
  if (state === 'prompt') return `${name}: 未許可です。ローカル接続の明示確認を実行できます。`;
  if (state === 'denied') return `${name}: 拒否されています。Chromeのサイト設定で許可を変更してください。`;
  if (state === 'unavailable') return `${name}: API非対応または状態を確認できません。実通信で確認してください。`;
  return `${name}: 状態を確認できません。`;
}

function formatDiagnostic(response: Extract<CodexBridgeMcpTestResponse, { ok: false }>): string {
  if (response.reason === 'disconnected' && response.stage === 'response-stream') {
    const error = response.errorName ? ` (${response.errorName})` : '';
    return `HTTP応答の読み取り中に通信が中断しました${error}。Service WorkerのNetwork/Consoleとサーバー応答を確認してください。`;
  }
  if (response.reason === 'http-error' && response.httpStatus) {
    return `サーバーがHTTP ${response.httpStatus}を返しました。接続先とサーバー側の応答を確認してください。`;
  }
  const message = DIAGNOSTIC_MESSAGES[response.reason];
  const error = response.reason === 'disconnected' && response.errorName ? ` (${response.errorName})` : '';
  return `${message}${error}`;
}

function hostPermissionText(state: HostPermissionState): string {
  if (state === 'granted') return 'Chromeホスト権限: 許可済みです。';
  if (state === 'required') return 'Chromeホスト権限: 未許可です。接続確認時に要求します。';
  if (state === 'unavailable') return 'Chromeホスト権限: 状態を確認できません。';
  if (state === 'invalid') return 'Chromeホスト権限: 有効なURLを入力してください。';
  return 'Chromeホスト権限: 確認中…';
}

export function McpConnectionSettings({ endpoint, disabled, onEndpointChange }: Props) {
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenStatus, setTokenStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [probeChecking, setProbeChecking] = useState(false);
  const [diagnostic, setDiagnostic] = useState('');
  const [probeDiagnostic, setProbeDiagnostic] = useState('');
  const [hostPermission, setHostPermission] = useState<HostPermissionState>('checking');
  const [networkTarget, setNetworkTarget] = useState<McpNetworkTarget>('unknown');
  const [lnaPermission, setLnaPermission] = useState<McpLnaPermissionState>('unavailable');
  const [probeVerifiedEndpoint, setProbeVerifiedEndpoint] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const parsed = parseCodexBridgeMcpEndpoint(endpoint);
    if (!parsed) {
      setHostPermission('invalid');
      setNetworkTarget('unknown');
      setLnaPermission('not-required');
      return () => { active = false; };
    }

    const target = classifyMcpNetworkTarget(parsed.url);
    setHostPermission('checking');
    setNetworkTarget(target);
    setLnaPermission('unavailable');
    setProbeVerifiedEndpoint(null);
    setProbeDiagnostic('');
    void (async () => {
      try {
        const granted = await chrome.permissions.contains({ origins: [parsed.originPattern] });
        if (active) setHostPermission(granted ? 'granted' : 'required');
      } catch {
        if (active) setHostPermission('unavailable');
      }
    })();
    void readMcpLnaPermissionState(target, permissionQuery()).then((state) => {
      if (active) setLnaPermission(state);
    });
    return () => { active = false; };
  }, [endpoint]);

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

  async function checkLocalNetwork() {
    const parsed = parseCodexBridgeMcpEndpoint(endpoint);
    if (!parsed) {
      setProbeDiagnostic(DIAGNOSTIC_MESSAGES['invalid-endpoint']);
      return;
    }
    const target = classifyMcpNetworkTarget(parsed.url);
    if (target !== 'loopback' && target !== 'local') {
      setProbeDiagnostic('この接続先はローカル範囲として判定されないため、事前probeを行いません。');
      return;
    }
    if (hostPermission !== 'granted') {
      setProbeDiagnostic('先に「接続確認」を押して、この接続先へのChromeホスト権限を許可してください。未許可の間はローカル通信を行いません。');
      return;
    }

    setProbeChecking(true);
    setProbeDiagnostic('');
    const result = await probeMcpLocalNetwork(parsed.url);
    if (result.status === 'reached') {
      setProbeVerifiedEndpoint(parsed.url);
      setProbeDiagnostic(`ローカルHTTP応答を確認しました（HTTP ${result.httpStatus}）。404もprobe用パスへの到達結果です。MCP確認は続けて実行できます。`);
    } else if (result.status === 'failed') {
      setProbeVerifiedEndpoint(null);
      const error = result.errorName ? ` (${result.errorName})` : '';
      setProbeDiagnostic(`HTTP要求を完了できませんでした${error}。ブラウザー権限、接続先、ネットワーク、CORSを確認してください。原因はこの結果だけでは特定できません。`);
    } else {
      setProbeVerifiedEndpoint(null);
      setProbeDiagnostic('この接続先ではローカルネットワークprobeを行いません。');
    }
    setLnaPermission(await readMcpLnaPermissionState(target, permissionQuery()));
    setProbeChecking(false);
  }

  async function testConnection() {
    const parsed = parseCodexBridgeMcpEndpoint(endpoint);
    if (!parsed) {
      setDiagnostic(DIAGNOSTIC_MESSAGES['invalid-endpoint']);
      return;
    }
    setChecking(true);
    setDiagnostic('');

    const granted = await requestMcpHostPermission(
      parsed.originPattern,
      (permissions) => chrome.permissions.request(permissions),
    );
    setHostPermission(granted ? 'granted' : 'required');
    if (!granted) {
      setDiagnostic(DIAGNOSTIC_MESSAGES['permission-required']);
      setChecking(false);
      return;
    }

    const target = classifyMcpNetworkTarget(parsed.url);
    if ((target === 'loopback' || target === 'local') && probeVerifiedEndpoint !== parsed.url) {
      setDiagnostic('Chromeホスト権限を確認しました。次に「ローカル接続を確認」を押し、HTTP応答を確認してから接続確認をもう一度実行してください。MCP要求はまだ送信していません。');
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
        setDiagnostic(formatDiagnostic(response));
      }
    } catch {
      setDiagnostic('拡張Service Workerから接続確認応答を受け取れませんでした。Service Workerの起動状態、listener登録、Optionsの拡張contextを確認してください。Bridgeへの通信結果とは別のエラーです。');
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
      <div className="mcp-permission-status" aria-live="polite">
        <span>{hostPermissionText(hostPermission)}</span>
        <span>{lnaStatusText(networkTarget, lnaPermission)}</span>
      </div>
      <p className="mcp-permission-note">Chromeホスト権限とLocal Network Accessは別の権限です。ホスト権限は接続確認時に入力originだけを要求します。Local Network Accessの状態確認は読み取り専用です。</p>
      <button
        type="button"
        disabled={disabled || probeChecking || (networkTarget !== 'loopback' && networkTarget !== 'local')}
        onClick={() => void checkLocalNetwork()}
      >
        {probeChecking ? 'ローカル接続を確認中…' : 'ローカル接続を確認'}
      </button>
      <p className="mcp-diagnostic" role="status">{probeDiagnostic}</p>
      <p className="mcp-permission-note">loopbackまたはprivate LAN接続先では、最初のMCP要求より前にこのOptions内probeを実行します。ホスト権限が未許可の場合、接続確認は権限だけを要求してMCP要求を送らず、許可後にprobe、応答確認後に接続確認をもう一度行います。</p>
      <p className="mcp-permission-note">probeはボタン操作時だけ送信し、HTTP statusだけを確認します。404も到達確認として扱い、Local Network Accessがprompt表示のままでも応答を得た場合はMCP確認を妨げません。</p>
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
