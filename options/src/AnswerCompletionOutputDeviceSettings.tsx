import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnswerCompletionOutputDeviceRepository,
  createChromeAnswerCompletionOutputDeviceRepository,
  DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE,
  enumerateAudioOutputDevices,
  requestAudioOutputPermission,
  type AnswerCompletionOutputDevice,
  type AudioOutputDeviceOption,
  type EnumerateOutputDevicesResult,
} from '../../src/shared/answer-completion-output-device.ts';

interface AnswerCompletionOutputDeviceSettingsProps {
  readonly disabled: boolean;
}

function deviceErrorMessage(reason: string): string {
  if (reason === 'unsupported') return 'このChromeではオーディオ出力デバイス一覧を取得できません。';
  if (reason === 'permission-denied') return 'マイク権限が許可されていないため、複数の出力先を表示できません。';
  if (reason === 'enumeration-failed') return 'オーディオ出力デバイス一覧を取得できませんでした。';
  if (reason === 'corrupt-selection') return '保存済みの出力先を読み取れません。既存設定を保護しています。';
  return '出力先を保存できませんでした。既存の出力先は保持されています。';
}

function permissionPromptMessage(reason: string): string {
  if (reason === 'permission-denied') return 'Chromeでマイク権限が拒否されました。権限を変更してから再試行できます。';
  if (reason === 'unsupported') return 'このChromeではマイク権限を確認できません。';
  return 'マイク権限を取得できませんでした。';
}

function displayDevice(device: AnswerCompletionOutputDevice, devices: readonly AudioOutputDeviceOption[]): string {
  return devices.find(({ deviceId }) => deviceId === device.deviceId)?.label ?? device.label;
}

export function AnswerCompletionOutputDeviceSettings({ disabled }: AnswerCompletionOutputDeviceSettingsProps) {
  const repository = useMemo(() => createChromeAnswerCompletionOutputDeviceRepository(), []);
  const [selected, setSelected] = useState<AnswerCompletionOutputDevice>(DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE);
  const [devices, setDevices] = useState<readonly AudioOutputDeviceOption[]>([]);
  const [selectionReady, setSelectionReady] = useState(false);
  const [selectionCorrupt, setSelectionCorrupt] = useState(false);
  const [enumerationResult, setEnumerationResult] = useState<EnumerateOutputDevicesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [enumerationError, setEnumerationError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef(true);

  const refreshDevices = useCallback(async () => {
    const result = await enumerateAudioOutputDevices(navigator.mediaDevices);
    if (!active.current) return result;
    setEnumerationResult(result);
    if (result.ok) {
      setDevices(result.devices);
      setEnumerationError('');
    } else {
      setDevices([]);
      setEnumerationError(deviceErrorMessage(result.reason));
    }
    return result;
  }, []);

  useEffect(() => {
    active.current = true;
    let receivedStorageChange = false;
    const apply = (result: Awaited<ReturnType<AnswerCompletionOutputDeviceRepository['load']>>) => {
      if (!active.current) return;
      receivedStorageChange = true;
      if (result.ok) {
        setSelected(result.device);
        setSelectionReady(true);
        setSelectionCorrupt(false);
        if (result.device.deviceId !== 'default' && enumerationResult?.ok
          && !enumerationResult.devices.some(({ deviceId }) => deviceId === result.device.deviceId)) {
          setMessage('選択中の出力先が一覧にありません。デバイスが未接続または利用不可です。');
        }
      } else {
        setSelectionReady(false);
        setSelectionCorrupt(result.reason === 'corrupt-selection');
        setError(deviceErrorMessage(result.reason));
      }
    };
    const unsubscribe = repository.subscribe(apply);
    const mediaDevices = navigator.mediaDevices;
    const onDeviceChange = () => { void refreshDevices(); };
    mediaDevices?.addEventListener('devicechange', onDeviceChange);
    void repository.load().then((result) => { if (!receivedStorageChange) apply(result); });
    void refreshDevices();
    return () => {
      active.current = false;
      unsubscribe();
      mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    };
  }, [repository, refreshDevices]);

  const selectedConnected = enumerationResult?.ok
    ? devices.some(({ deviceId }) => deviceId === selected.deviceId)
    : null;
  const needsPermission = enumerationResult?.ok
    ? enumerationResult.devices.length <= 1 || enumerationResult.devices.every(({ deviceId }) => deviceId === 'default')
    : enumerationResult?.reason === 'permission-denied';

  async function saveSelection(deviceId: string) {
    const device = deviceId === 'default'
      ? DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE
      : devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await repository.save(device);
    setBusy(false);
    if (!result.ok) {
      setError(deviceErrorMessage(result.reason));
      return;
    }
    setSelected(result.device);
    setSelectionReady(true);
    setSelectionCorrupt(false);
    setMessage(`出力先を「${result.device.label}」に保存しました。Chromeプロファイル内のChatGPTタブで共有されます。`);
  }

  async function requestPermission() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('Chromeの権限を確認しています。');
    const result = await requestAudioOutputPermission(navigator.mediaDevices);
    setBusy(false);
    if (!result.ok) {
      setMessage('');
      setError(permissionPromptMessage(result.reason));
      return;
    }
    setMessage(`マイク権限を取得し、${result.stoppedTracks}個のトラックを直ちに停止しました。録音・保存・送信はしていません。`);
    await refreshDevices();
  }

  return (
    <section className="answer-completion-output-settings" aria-labelledby="answer-completion-output-title">
      <h3 id="answer-completion-output-title">再生デバイス</h3>
      <label className="field-label sound-select-label">
        回答完了音の出力先
        <select
          aria-label="回答完了音の出力デバイス"
          value={selected.deviceId}
          disabled={disabled || busy || !selectionReady}
          onChange={(event) => { void saveSelection(event.currentTarget.value); }}
        >
          <option value="default">システムの既定</option>
          {selected.deviceId !== 'default' && !devices.some(({ deviceId }) => deviceId === selected.deviceId)
            && <option value={selected.deviceId}>{selected.label}（未接続または利用不可）</option>}
          {devices.filter(({ deviceId }) => deviceId !== 'default').map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
          ))}
        </select>
      </label>
      <p role="status">
        現在の選択先: {displayDevice(selected, devices)}（{selectedConnected === null ? '接続状態を確認できません' : selectedConnected ? '接続中' : '未接続または利用不可'}）
      </p>
      <div className="layout-buttons">
        <button type="button" disabled={disabled || busy} onClick={() => { void refreshDevices(); }}>デバイス一覧を更新</button>
        {needsPermission && (
          <button type="button" disabled={disabled || busy} onClick={() => { void requestPermission(); }}>
            マイク権限を確認して出力先を表示
          </button>
        )}
        {selectionCorrupt && <button type="button" disabled={disabled || busy} onClick={() => { void saveSelection('default'); }}>システムの既定に戻す</button>}
      </div>
      {needsPermission && <p>Chromeはマイク権限を許可するまで、既定の出力先だけを表示する場合があります。許可後の取得ストリームはすぐ停止し、録音・保存・送信しません。</p>}
      {devices.length === 0 && enumerationResult?.ok && <p>利用可能なオーディオ出力デバイスがありません。</p>}
      {enumerationError && <p className="sound-settings-error" role="alert">{enumerationError}</p>}
      {error && <p className="sound-settings-error" role="alert">{error}</p>}
      {message && <p className="sound-settings-status" role="status">{message}</p>}
    </section>
  );
}
