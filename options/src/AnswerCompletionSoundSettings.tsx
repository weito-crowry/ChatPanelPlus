import { useEffect, useMemo, useState } from 'react';
import {
  MAX_SOUND_ASSET_BYTES,
  MAX_SOUND_ASSET_DURATION_SECONDS,
  MAX_SOUND_ASSET_NAME_LENGTH,
  MAX_SOUND_ASSET_TOTAL_BYTES,
  MAX_SOUND_ASSETS,
  SoundAssetRepository,
  createChromeSoundAssetRepository,
  prepareSoundAsset,
  type PreparedSoundAssetError,
  type SoundAsset,
  type SoundAssetError,
} from '../../src/shared/answer-completion-sound-assets.ts';
import { BUILTIN_COMPLETION_SOUNDS } from '../../src/shared/answer-completion-sound-definitions.ts';
import { decodeSoundData, previewCompletionSound } from '../../src/shared/answer-completion-sound-playback.ts';
import { AnswerCompletionOutputDeviceSettings } from './AnswerCompletionOutputDeviceSettings.tsx';
import {
  ANSWER_COMPLETION_SOUND_PREVIEW,
  isAnswerCompletionSoundRouteResult,
} from '../../src/shared/answer-completion-output-device-protocol.ts';

interface AnswerCompletionSoundSettingsProps {
  readonly idPrefix: string;
  readonly title: string;
  readonly enabledLabel: string;
  readonly soundLabel: string;
  readonly selectedSoundId: string;
  readonly enabled: boolean;
  readonly volumePercent: number;
  readonly disabled: boolean;
  readonly defaultSoundId: string;
  readonly includeSharedLibrary?: boolean;
  readonly onSharedLibraryBusyChange?: (busy: boolean) => void;
  readonly onSelect: (soundId: string) => void;
  readonly onToggleEnabled: (enabled: boolean) => void;
  readonly onVolumeChange: (volumePercent: number) => void;
  readonly onBeforeDelete: (soundId: string) => Promise<boolean>;
}

function formatMiB(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024) * 10) / 10} MiB`;
}

function fileErrorMessage(reason: PreparedSoundAssetError): string {
  if (reason === 'unsupported-format') return 'WAV、MP3、OGGのファイル内容を確認できません。拡張子・形式・MIMEタイプを確認してください。';
  if (reason === 'file-too-large') return `ファイルは${formatMiB(MAX_SOUND_ASSET_BYTES)}以下にしてください。`;
  if (reason === 'duration-limit') return `${MAX_SOUND_ASSET_DURATION_SECONDS}秒以内の短い通知音を選んでください。`;
  if (reason === 'unplayable-audio') return '音声をデコードできませんでした。再生可能なWAV、MP3、OGGを選んでください。';
  return `ファイル名は${MAX_SOUND_ASSET_NAME_LENGTH}文字以内の音源ファイルを選んでください。`;
}

function storageErrorMessage(reason: SoundAssetError): string {
  if (reason === 'asset-limit') return `追加できる音源は${MAX_SOUND_ASSETS}件までです。不要な音源を削除してください。`;
  if (reason === 'total-size-limit') return `保存音源の合計は${formatMiB(MAX_SOUND_ASSET_TOTAL_BYTES)}までです。`;
  if (reason === 'corrupt-assets') return '保存済み音源データに問題があるため、上書き・削除を停止しました。';
  if (reason === 'storage-failed') return '音源を保存できませんでした。Chromeのローカル保存容量を確認してください。既存音源は保持されています。';
  if (reason === 'file-too-large') return `ファイルは${formatMiB(MAX_SOUND_ASSET_BYTES)}以下にしてください。`;
  if (reason === 'duration-limit') return `${MAX_SOUND_ASSET_DURATION_SECONDS}秒以内の短い通知音を選んでください。`;
  return '音源ファイルを保存できませんでした。';
}

function audioContextFactory(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  return new AudioContext();
}

function outputPlaybackError(reason: string): string {
  if (reason === 'device-unavailable') return '選択したデバイスが見つかりません。接続状態を確認するか、別の出力先を選んでください。';
  if (reason === 'permission-denied') return '選択したデバイスの利用が拒否されました。出力先を再選択してください。';
  if (reason === 'sink-failed') return '選択したデバイスへ出力を切り替えられませんでした。';
  if (reason === 'corrupt-selection') return '保存済みの出力先を読み取れません。出力先を選び直してください。';
  if (reason === 'storage-failed') return '出力先設定を読み込めませんでした。既存設定は保持されています。';
  return '選択したデバイスで試聴を開始できませんでした。';
}

export function AnswerCompletionSoundSettings({
  idPrefix,
  title,
  enabledLabel,
  soundLabel,
  selectedSoundId,
  enabled,
  volumePercent,
  disabled,
  defaultSoundId,
  includeSharedLibrary = false,
  onSharedLibraryBusyChange,
  onSelect,
  onToggleEnabled,
  onVolumeChange,
  onBeforeDelete,
}: AnswerCompletionSoundSettingsProps) {
  const repository = useMemo(() => createChromeSoundAssetRepository(), []);
  const [assets, setAssets] = useState<readonly SoundAsset[]>([]);
  const [assetsReady, setAssetsReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewingId, setPreviewingId] = useState('');

  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const apply = (result: Awaited<ReturnType<SoundAssetRepository['loadAssets']>>) => {
      if (!active) return;
      receivedChange = true;
      setAssetsReady(result.ok);
      if (result.ok) {
        setAssets(result.assets);
        setLoadError('');
      } else {
        setLoadError(result.reason === 'corrupt-assets'
          ? '保存済み音源データを検証できないため、音源操作を停止しました。'
          : '保存済み音源を読み込めませんでした。');
      }
    };
    const unsubscribe = repository.subscribeAssets(apply);
    void repository.loadAssets().then((result) => {
      if (!receivedChange) apply(result);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repository]);

  async function addFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('音源を検証しています。');
    try {
      const prepared = await prepareSoundAsset(file, (data) => decodeSoundData(data, audioContextFactory));
      if (!prepared.ok) {
        setError(fileErrorMessage(prepared.reason));
        setMessage('');
        return;
      }
      const result = await repository.addAsset(prepared.asset);
      if (!result.ok) {
        setError(storageErrorMessage(result.reason));
        setMessage('');
        return;
      }
      setAssets((current) => current.some(({ id }) => id === result.asset?.id) || !result.asset
        ? current
        : [...current, result.asset]);
      setMessage(`「${result.asset?.name ?? file.name}」を保存しました。選択欄から指定できます。`);
    } catch {
      setError('音源を保存できませんでした。既存音源は保持されています。');
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  async function preview(soundId: string, asset?: SoundAsset) {
    if (busy || previewingId) return;
    if (volumePercent === 0) {
      setError('');
      setMessage('音量0%のため試聴・通知音は再生されません。');
      return;
    }
    setPreviewingId(soundId);
    setError('');
    setMessage('');
    let played = false;
    let failureMessage = '';
    let successMessage = '';
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: ANSWER_COMPLETION_SOUND_PREVIEW,
        soundId,
        volumePercent,
      });
      if (!isAnswerCompletionSoundRouteResult(response)) {
        failureMessage = outputPlaybackError('offscreen-failed');
      } else if (!response.ok) {
        failureMessage = outputPlaybackError(response.reason);
        if (response.playback) failureMessage += `（${response.playback.succeededCount}/${response.playback.outputCount}台で再生）`;
      } else if (response.route === 'device') {
        played = true;
        successMessage = `選択した${response.playback.succeededCount}台で試聴しました。`;
      } else if (response.route === 'partial-device') {
        played = true;
        successMessage = `一部の出力先で試聴しました（${response.playback.succeededCount}/${response.playback.outputCount}台）。`;
      } else if (response.route === 'default') {
        played = await previewCompletionSound(document, soundId, asset, () => audioContextFactory(), volumePercent);
      } else {
        failureMessage = outputPlaybackError('offscreen-failed');
      }
    } catch {
      failureMessage = outputPlaybackError('offscreen-failed');
    }
    setPreviewingId('');
    if (played) setMessage(successMessage || '試聴を開始しました。');
    else setError(failureMessage || '試聴を開始できませんでした。ページ上の再生制限を確認してください。');
  }

  async function remove(asset: SoundAsset) {
    if (busy || !window.confirm(`「${asset.name}」を削除しますか？使用中の通知設定は、削除前に各通知の既定音へ切り替えます。`)) return;
    setBusy(true);
    onSharedLibraryBusyChange?.(true);
    setError('');
    setMessage('');
    try {
      const safeToDelete = await onBeforeDelete(asset.id);
      if (!safeToDelete) return;
      const result = await repository.removeAsset(asset.id);
      if (!result.ok) {
        setError(storageErrorMessage(result.reason));
        return;
      }
      setAssets((current) => current.filter(({ id }) => id !== asset.id));
      setMessage(`「${asset.name}」を削除しました。`);
    } catch {
      setError('選択中の音を既定音へ保存できなかったため、ファイルは削除していません。');
    } finally {
      setBusy(false);
      onSharedLibraryBusyChange?.(false);
    }
  }

  const selectedAsset = assets.find(({ id }) => id === selectedSoundId);
  const selectedMissing = selectedSoundId.startsWith('user-') && !selectedAsset;
  const previewSoundId = selectedMissing ? defaultSoundId : selectedSoundId;
  const fallbackSound = BUILTIN_COMPLETION_SOUNDS.find(({ id }) => id === defaultSoundId)?.label ?? '既定音';

  return (
    <section className="settings-card sound-settings" aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      <label className="tab-visibility">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggleEnabled(event.currentTarget.checked)}
        />
        {enabledLabel}
      </label>
      <p>保存後にこの通知の再生へ反映します。選択音の試聴には、この通知の音量を使います。</p>
      <div className="sound-volume-control">
        <label htmlFor={`${idPrefix}-volume`}>音量</label>
        <div className="sound-volume-control-row">
          <input
            id={`${idPrefix}-volume`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            aria-valuetext={`${volumePercent}%`}
            disabled={disabled}
            onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
          />
          <output htmlFor={`${idPrefix}-volume`}>{volumePercent}%</output>
        </div>
      </div>
      {volumePercent === 0 && <p className="sound-settings-status" role="status">音量0%のため試聴・通知音は再生されません。</p>}
      <label className="field-label sound-select-label">
        通知音
        <select
          aria-label={soundLabel}
          value={selectedSoundId}
          disabled={disabled || busy}
          onChange={(event) => onSelect(event.currentTarget.value)}
        >
          {selectedMissing && <option value={selectedSoundId}>保存音源が見つかりません（既定音にフォールバック）</option>}
          {BUILTIN_COMPLETION_SOUNDS.map((sound) => <option key={sound.id} value={sound.id}>{sound.label}</option>)}
          {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="sound-preview-button"
        disabled={disabled || busy || !!previewingId || volumePercent === 0}
        onClick={() => { void preview(previewSoundId, selectedAsset); }}
        aria-label={`${title}の選択音を現在の出力先で試聴`}
      >{previewingId === previewSoundId ? '試聴中…' : '選択中の音を選択中の出力先で試聴'}</button>
      {selectedMissing && assetsReady && <p className="sound-settings-warning" role="status">選択音源を読み込めません。再生時は{fallbackSound}を使用します。</p>}
      {selectedMissing && !assetsReady && !loadError && <p className="sound-settings-status" role="status">ユーザー音源を読み込んでいます。</p>}
      {error && <p className="sound-settings-error" role="alert">{error}</p>}
      {message && <p className="sound-settings-status" role="status">{message}</p>}
      {includeSharedLibrary && <>
        <AnswerCompletionOutputDeviceSettings disabled={disabled || busy || !!previewingId} />
        <p>WAV、MP3、OGGに対応。{MAX_SOUND_ASSET_DURATION_SECONDS}秒以内、1ファイル512 KiB以下、最大5件、保存音源の合計2 MiBまでです。音声内容も再生可能か検査します。Chromeの保存容量によっては追加できない場合があります。</p>
        <label className="sound-file-picker">
          音源ファイルを追加
          <input
            type="file"
            accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
            aria-label="通知音ファイルを追加"
            disabled={disabled || busy || !assetsReady || assets.length >= MAX_SOUND_ASSETS}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void addFile(file);
            }}
          />
        </label>
        {loadError && <p className="sound-settings-error" role="alert">{loadError}</p>}
        <ul className="sound-asset-list" aria-label="追加した通知音">
          {assets.map((asset) => (
            <li key={asset.id}>
              <span className="sound-asset-name">{asset.name}</span>
              <span className="sound-asset-size">{Math.ceil(asset.sizeBytes / 1024)} KiB</span>
              <button type="button" disabled={disabled || busy || !!previewingId || volumePercent === 0} onClick={() => { void preview(asset.id, asset); }}>
                {previewingId === asset.id ? '試聴中…' : '試聴'}
              </button>
              <button type="button" disabled={disabled || busy} onClick={() => { void remove(asset); }}>削除</button>
            </li>
          ))}
        </ul>
      </>}
    </section>
  );
}
