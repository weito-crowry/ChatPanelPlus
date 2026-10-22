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
import {
  BUILTIN_COMPLETION_SOUNDS,
  DEFAULT_COMPLETION_SOUND_ID,
} from '../../src/shared/answer-completion-sound-definitions.ts';
import { decodeSoundData, previewCompletionSound } from '../../src/shared/answer-completion-sound-playback.ts';

interface AnswerCompletionSoundSettingsProps {
  readonly selectedSoundId: string;
  readonly enabled: boolean;
  readonly volumePercent: number;
  readonly disabled: boolean;
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

export function AnswerCompletionSoundSettings({
  selectedSoundId,
  enabled,
  volumePercent,
  disabled,
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
    const prepared = await prepareSoundAsset(file, (data) => decodeSoundData(data, audioContextFactory));
    if (!prepared.ok) {
      setError(fileErrorMessage(prepared.reason));
      setMessage('');
      setBusy(false);
      return;
    }
    const result = await repository.addAsset(prepared.asset);
    setBusy(false);
    if (!result.ok) {
      setError(storageErrorMessage(result.reason));
      setMessage('');
      return;
    }
    setAssets((current) => current.some(({ id }) => id === result.asset?.id) || !result.asset
      ? current
      : [...current, result.asset]);
    setMessage(`「${result.asset?.name ?? file.name}」を保存しました。選択欄から指定できます。`);
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
    const played = await previewCompletionSound(document, soundId, asset, () => audioContextFactory(), volumePercent);
    setPreviewingId('');
    if (played) setMessage('試聴を開始しました。');
    else setError('試聴を開始できませんでした。ページ上の再生制限を確認してください。');
  }

  async function remove(asset: SoundAsset) {
    if (busy || !window.confirm(`「${asset.name}」を削除しますか？${selectedSoundId === asset.id ? '\n選択中のため、先に既定の短音へ切り替えます。' : ''}`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    let safeToDelete: boolean;
    try {
      safeToDelete = await onBeforeDelete(asset.id);
    } catch {
      safeToDelete = false;
      setError('選択中の音を既定音へ保存できなかったため、ファイルは削除していません。');
    }
    if (!safeToDelete) {
      setBusy(false);
      return;
    }
    const result = await repository.removeAsset(asset.id);
    setBusy(false);
    if (!result.ok) {
      setError(storageErrorMessage(result.reason));
      return;
    }
    setAssets((current) => current.filter(({ id }) => id !== asset.id));
    setMessage(`「${asset.name}」を削除しました。`);
  }

  const selectedAsset = assets.find(({ id }) => id === selectedSoundId);
  const selectedMissing = selectedSoundId.startsWith('user-') && !selectedAsset;
  const previewSoundId = selectedMissing ? DEFAULT_COMPLETION_SOUND_ID : selectedSoundId;

  return (
    <section className="settings-card sound-settings" aria-labelledby="answer-completion-sound-title">
      <h2 id="answer-completion-sound-title">回答完了音</h2>
      <label className="tab-visibility">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggleEnabled(event.currentTarget.checked)}
        />
        ChatGPTの回答完了時に音を鳴らす
      </label>
      <p>初期状態は無効です。有効にした後、ChatGPTページで操作すると再生できるようになります。</p>
      <div className="sound-volume-control">
        <label htmlFor="answer-completion-sound-volume">音量</label>
        <div className="sound-volume-control-row">
          <input
            id="answer-completion-sound-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            aria-valuetext={`${volumePercent}%`}
            disabled={disabled}
            onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
          />
          <output htmlFor="answer-completion-sound-volume">{volumePercent}%</output>
        </div>
      </div>
      {volumePercent === 0 && <p className="sound-settings-status" role="status">音量0%のため試聴・通知音は再生されません。</p>}
      <label className="field-label sound-select-label">
        通知音
        <select
          aria-label="回答完了時に再生する音"
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
      >{previewingId === previewSoundId ? '試聴中…' : '選択中の音を試聴'}</button>
      {selectedMissing && assetsReady && <p className="sound-settings-warning" role="status">選択音源を読み込めません。再生時は短音（660 Hz）を使用します。</p>}
      {selectedMissing && !assetsReady && !loadError && <p className="sound-settings-status" role="status">ユーザー音源を読み込んでいます。</p>}
      <p>WAV、MP3、OGGに対応。5秒以内、1ファイル512 KiB以下、最大5件、保存音源の合計2 MiBまでです。音声内容も再生可能か検査します。Chromeの保存容量によっては追加できない場合があります。</p>
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
      {error && <p className="sound-settings-error" role="alert">{error}</p>}
      {message && <p className="sound-settings-status" role="status">{message}</p>}
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
    </section>
  );
}
