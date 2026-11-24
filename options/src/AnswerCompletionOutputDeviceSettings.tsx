import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnswerCompletionOutputDeviceRepository,
  createChromeAnswerCompletionOutputDeviceRepository,
  DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION,
  MAX_ANSWER_COMPLETION_OUTPUT_DEVICES,
  enumerateAudioOutputDevices,
  requestAudioOutputPermission,
  type AnswerCompletionOutputDevice,
  type AnswerCompletionOutputDeviceSelection,
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

export function AnswerCompletionOutputDeviceSettings({ disabled }: AnswerCompletionOutputDeviceSettingsProps) {
  const repository = useMemo(() => createChromeAnswerCompletionOutputDeviceRepository(), []);
  const [selection, setSelection] = useState<AnswerCompletionOutputDeviceSelection>(DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION);
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
        setError('');
        setMessage('');
        setSelection(result.selection);
        setSelectionReady(true);
        setSelectionCorrupt(false);
      } else {
        setMessage('');
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

  const physicalDevices = devices.filter(({ deviceId }) => deviceId !== 'default');
  const selectableDevices: readonly AnswerCompletionOutputDevice[] = [
    ...physicalDevices,
    ...selection.devices.filter((saved) => !physicalDevices.some(({ deviceId }) => deviceId === saved.deviceId)),
  ];
  const selectedCount = selection.devices.length;
  const selectedConnectedCount = enumerationResult?.ok
    ? selection.devices.filter(({ deviceId }) => physicalDevices.some((device) => device.deviceId === deviceId)).length
    : null;
  const needsPermission = enumerationResult?.ok
    ? physicalDevices.length === 0
    : enumerationResult?.reason === 'permission-denied';

  async function saveDeviceSelected(device: AnswerCompletionOutputDevice, selected: boolean) {
    if (busy || !selectionReady) return;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await repository.setDeviceSelected(device, selected);
    setBusy(false);
    if (!result.ok) {
      if (result.reason === 'corrupt-selection') {
        setSelectionReady(false);
        setSelectionCorrupt(true);
      }
      setError(result.reason === 'selection-limit'
        ? `選択できる出力先は最大${MAX_ANSWER_COMPLETION_OUTPUT_DEVICES}台です。`
        : deviceErrorMessage(result.reason));
      return;
    }
    setSelection(result.selection);
    setSelectionReady(true);
    setSelectionCorrupt(false);
    setMessage(selected ? '出力先を追加しました。ChatGPT回答完了音・Codex監視終了音・試聴に共通適用します。'
      : result.selection.devices.length === 0
        ? '出力先の選択を解除しました。システムの既定出力を使用します。'
        : '出力先の選択を解除しました。残りの選択先を使用します。');
  }

  async function resetSelection() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await repository.resetToDefault();
    setBusy(false);
    if (!result.ok) {
      setError(deviceErrorMessage(result.reason));
      return;
    }
    setSelection(result.selection);
    setSelectionReady(true);
    setSelectionCorrupt(false);
    setMessage('システムの既定出力を使用します。');
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
      <p role="status">選択中: {selectedCount} / {MAX_ANSWER_COMPLETION_OUTPUT_DEVICES} 台</p>
      <p role="status">{selectedCount === 0
        ? 'システムの既定出力を使用します。'
        : selectedConnectedCount === null
          ? `選択した${selectedCount}台の接続状態を確認できません。`
          : `${selectedConnectedCount} / ${selectedCount} 台が接続中です。未接続の選択は再接続時まで保持します。`}</p>
      <fieldset className="output-device-checkboxes" disabled={disabled || busy || !selectionReady}>
        <legend>音を再生する出力先</legend>
        {selectableDevices.map((device) => {
          const selected = selection.devices.some(({ deviceId }) => deviceId === device.deviceId);
          const connected = physicalDevices.some(({ deviceId }) => deviceId === device.deviceId);
          const current = physicalDevices.find(({ deviceId }) => deviceId === device.deviceId) ?? device;
          return <label key={device.deviceId}>
            <input type="checkbox" checked={selected} disabled={!selected && selectedCount >= MAX_ANSWER_COMPLETION_OUTPUT_DEVICES}
              onChange={(event) => { void saveDeviceSelected(current, event.currentTarget.checked); }} />
            {current.label} {connected ? '（接続中）' : '（未接続または利用不可）'}
          </label>;
        })}
        {selectableDevices.length === 0 && <p>選択可能な物理出力はありません。</p>}
      </fieldset>
      <div className="layout-buttons">
        <button type="button" disabled={disabled || busy} onClick={() => { void refreshDevices(); }}>デバイス一覧を更新</button>
        {needsPermission && (
          <button type="button" disabled={disabled || busy} onClick={() => { void requestPermission(); }}>
            マイク権限を確認して出力先を表示
          </button>
        )}
        {selectionCorrupt && <button type="button" disabled={disabled || busy} onClick={() => { void resetSelection(); }}>システムの既定に戻す</button>}
      </div>
      {needsPermission && <p>Chromeはマイク権限を許可するまで、既定の出力先だけを表示する場合があります。許可後の取得ストリームはすぐ停止し、録音・保存・送信しません。</p>}
      {devices.length === 0 && enumerationResult?.ok && <p>利用可能なオーディオ出力デバイスがありません。</p>}
      <p>出力先設定はChromeプロファイル内で共有されます。共通設定JSONには含まれず、JSONのexport/importでは移行しません。</p>
      {enumerationError && <p className="sound-settings-error" role="alert">{enumerationError}</p>}
      {error && <p className="sound-settings-error" role="alert">{error}</p>}
      {message && <p className="sound-settings-status" role="status">{message}</p>}
    </section>
  );
}
