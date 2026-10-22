import { isUserCompletionSoundId } from './answer-completion-sound-definitions.ts';

export const SOUND_ASSETS_STORAGE_KEY = 'chatPanelPlus.answerCompletionSoundAssets';
export const MAX_SOUND_ASSETS = 5;
export const MAX_SOUND_ASSET_BYTES = 512 * 1024;
export const MAX_SOUND_ASSET_TOTAL_BYTES = 2 * 1024 * 1024;
export const MAX_SOUND_ASSET_DURATION_SECONDS = 5;
export const MAX_SOUND_ASSET_NAME_LENGTH = 128;

export interface SoundAsset {
  readonly id: string;
  readonly name: string;
  readonly mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/ogg';
  readonly data: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
}

export type PreparedSoundAsset = Omit<SoundAsset, 'id'>;

export type SoundAssetError = 'unsupported-format' | 'file-too-large' | 'total-size-limit' | 'asset-limit'
  | 'duration-limit' | 'unplayable-audio' | 'invalid-file' | 'corrupt-assets' | 'storage-failed';

export interface SoundAssetStorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SoundAssetStorageChangesLike {
  addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
  removeListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
}

export interface SoundAssetLockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SoundFileLike {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type SoundDecode = (data: ArrayBuffer) => Promise<{ readonly duration: number }>;

export type PreparedSoundAssetResult =
  | { readonly ok: true; readonly asset: PreparedSoundAsset }
  | { readonly ok: false; readonly reason: 'unsupported-format' | 'file-too-large' | 'duration-limit' | 'unplayable-audio' | 'invalid-file' };
export type PreparedSoundAssetError = Extract<PreparedSoundAssetResult, { readonly ok: false }>['reason'];

type SupportedFormat = 'wav' | 'mp3' | 'ogg';

const FORMAT_MIME: Readonly<Record<SupportedFormat, SoundAsset['mimeType']>> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

function supportedExtension(name: string): SupportedFormat | null {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return extension === 'wav' || extension === 'mp3' || extension === 'ogg' ? extension : null;
}

function hasSignature(bytes: Uint8Array, format: SupportedFormat): boolean {
  if (format === 'wav') {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
  }
  if (format === 'ogg') return bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  return (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
    || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
}

function mimeMatches(type: string, format: SupportedFormat): boolean {
  const normalized = type.split(';', 1)[0]!.trim().toLowerCase();
  if (!normalized || normalized === 'application/octet-stream') return true;
  if (format === 'wav') return normalized === 'audio/wav' || normalized === 'audio/x-wav' || normalized === 'audio/wave';
  if (format === 'mp3') return normalized === 'audio/mpeg' || normalized === 'audio/mp3';
  return normalized === 'audio/ogg' || normalized === 'application/ogg' || normalized === 'audio/opus';
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function prepareSoundAsset(file: SoundFileLike, decode: SoundDecode): Promise<PreparedSoundAssetResult> {
  if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > MAX_SOUND_ASSET_NAME_LENGTH
    || typeof file.type !== 'string' || !Number.isSafeInteger(file.size) || file.size <= 0 || typeof file.arrayBuffer !== 'function') {
    return { ok: false, reason: 'invalid-file' };
  }
  const format = supportedExtension(file.name);
  if (!format || !mimeMatches(file.type, format)) return { ok: false, reason: 'unsupported-format' };
  if (file.size > MAX_SOUND_ASSET_BYTES) return { ok: false, reason: 'file-too-large' };

  let bytes: Uint8Array;
  let decoded: { readonly duration: number };
  try {
    const buffer = await file.arrayBuffer();
    bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== file.size || !hasSignature(bytes, format)) return { ok: false, reason: 'unsupported-format' };
    decoded = await decode(buffer.slice(0));
  } catch {
    return { ok: false, reason: 'unplayable-audio' };
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) return { ok: false, reason: 'unplayable-audio' };
  if (decoded.duration > MAX_SOUND_ASSET_DURATION_SECONDS) return { ok: false, reason: 'duration-limit' };
  return {
    ok: true,
    asset: {
      name: file.name,
      mimeType: FORMAT_MIME[format],
      data: encodeBase64(bytes),
      sizeBytes: bytes.byteLength,
      durationSeconds: decoded.duration,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validStoredAsset(value: unknown): value is SoundAsset {
  if (!isRecord(value) || Object.keys(value).some((key) => !['id', 'name', 'mimeType', 'data', 'sizeBytes', 'durationSeconds'].includes(key))) return false;
  return typeof value.id === 'string' && isUserCompletionSoundId(value.id)
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= MAX_SOUND_ASSET_NAME_LENGTH
    && (value.mimeType === 'audio/wav' || value.mimeType === 'audio/mpeg' || value.mimeType === 'audio/ogg')
    && typeof value.data === 'string' && value.data.length > 0 && value.data.length % 4 === 0
    && /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value.data)
    && Number.isSafeInteger(value.sizeBytes) && (value.sizeBytes as number) > 0 && (value.sizeBytes as number) <= MAX_SOUND_ASSET_BYTES
    && value.data.length === Math.ceil((value.sizeBytes as number) / 3) * 4
    && Number.isFinite(value.durationSeconds) && (value.durationSeconds as number) > 0
    && (value.durationSeconds as number) <= MAX_SOUND_ASSET_DURATION_SECONDS;
}

function validateAssets(value: unknown): SoundAsset[] | null {
  if (!Array.isArray(value) || value.length > MAX_SOUND_ASSETS) return null;
  const assets: SoundAsset[] = [];
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const valueAsset of value) {
    if (!validStoredAsset(valueAsset) || ids.has(valueAsset.id)) return null;
    ids.add(valueAsset.id);
    totalBytes += valueAsset.data.length;
    if (totalBytes > MAX_SOUND_ASSET_TOTAL_BYTES) return null;
    assets.push(valueAsset);
  }
  return assets;
}

function cloneAssets(assets: readonly SoundAsset[]): SoundAsset[] {
  return assets.map((asset) => ({ ...asset }));
}

function assetTotalBytes(assets: readonly SoundAsset[]): number {
  return assets.reduce((total, asset) => total + asset.data.length, 0);
}

export type SoundAssetsLoadResult =
  | { readonly ok: true; readonly assets: readonly SoundAsset[] }
  | { readonly ok: false; readonly reason: 'corrupt-assets' | 'storage-failed' };

export type SoundAssetMutationResult =
  | { readonly ok: true; readonly asset?: SoundAsset }
  | { readonly ok: false; readonly reason: SoundAssetError };

export class SoundAssetRepository {
  private readonly area: SoundAssetStorageAreaLike;
  private readonly changes?: SoundAssetStorageChangesLike;
  private readonly locks?: SoundAssetLockManagerLike;
  private readonly randomUUID: () => string;

  constructor(
    area: SoundAssetStorageAreaLike,
    changes?: SoundAssetStorageChangesLike,
    options: { readonly locks?: SoundAssetLockManagerLike; readonly randomUUID?: () => string } = {},
  ) {
    this.area = area;
    this.changes = changes;
    this.locks = options.locks;
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  }

  async loadAssets(): Promise<SoundAssetsLoadResult> {
    try {
      const stored = await this.area.get([SOUND_ASSETS_STORAGE_KEY]);
      if (!(SOUND_ASSETS_STORAGE_KEY in stored)) return { ok: true, assets: [] };
      const assets = validateAssets(stored[SOUND_ASSETS_STORAGE_KEY]);
      return assets ? { ok: true, assets: cloneAssets(assets) } : { ok: false, reason: 'corrupt-assets' };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async addAsset(prepared: PreparedSoundAsset): Promise<SoundAssetMutationResult> {
    return this.mutate(async (assets) => {
      if (assets.length >= MAX_SOUND_ASSETS) return { ok: false, reason: 'asset-limit' };
      const asset: SoundAsset = { ...prepared, id: `user-${this.randomUUID()}` };
      if (!validStoredAsset(asset)) return { ok: false, reason: 'invalid-file' };
      if (assetTotalBytes([...assets, asset]) > MAX_SOUND_ASSET_TOTAL_BYTES) return { ok: false, reason: 'total-size-limit' };
      return { ok: true, assets: [...assets, asset], result: { ok: true, asset } };
    });
  }

  async removeAsset(id: string): Promise<SoundAssetMutationResult> {
    return this.mutate(async (assets) => {
      if (!assets.some((asset) => asset.id === id)) return { ok: true, assets, result: { ok: true } };
      return { ok: true, assets: assets.filter((asset) => asset.id !== id), result: { ok: true } };
    });
  }

  subscribeAssets(listener: (result: SoundAssetsLoadResult) => void): () => void {
    if (!this.changes) return () => {};
    const handler = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(SOUND_ASSETS_STORAGE_KEY in changes)) return;
      const value = changes[SOUND_ASSETS_STORAGE_KEY]?.newValue;
      if (value === undefined) {
        listener({ ok: true, assets: [] });
        return;
      }
      const assets = validateAssets(value);
      listener(assets ? { ok: true, assets: cloneAssets(assets) } : { ok: false, reason: 'corrupt-assets' });
    };
    this.changes.addListener(handler);
    return () => this.changes?.removeListener(handler);
  }

  private async mutate(
    callback: (assets: readonly SoundAsset[]) => Promise<
      | { readonly ok: false; readonly reason: SoundAssetError }
      | { readonly ok: true; readonly assets: readonly SoundAsset[]; readonly result: SoundAssetMutationResult }
    >,
  ): Promise<SoundAssetMutationResult> {
    const save = async (): Promise<SoundAssetMutationResult> => {
      const loaded = await this.loadAssets();
      if (!loaded.ok) return loaded;
      const outcome = await callback(loaded.assets);
      if (!outcome.ok) return outcome;
      if (outcome.assets === loaded.assets) return outcome.result;
      try {
        await this.area.set({ [SOUND_ASSETS_STORAGE_KEY]: cloneAssets(outcome.assets) });
        return outcome.result;
      } catch {
        return { ok: false, reason: 'storage-failed' };
      }
    };
    try {
      return this.locks
        ? await this.locks.request(`${SOUND_ASSETS_STORAGE_KEY}.write`, save)
        : await save();
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }
}

export function createChromeSoundAssetRepository(): SoundAssetRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, () => callback()) }
    : undefined;
  return new SoundAssetRepository(chrome.storage.local, chrome.storage.onChanged, { locks });
}
