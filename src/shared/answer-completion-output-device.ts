export const ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY = 'chatPanelPlus.answerCompletionOutputDevice';
export const DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE = Object.freeze({
  deviceId: 'default',
  label: 'システムの既定',
});

export interface AnswerCompletionOutputDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface AudioOutputDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

export interface OutputDeviceStorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface OutputDeviceStorageChangesLike {
  addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
  removeListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
}

export type OutputDeviceLoadResult =
  | { readonly ok: true; readonly device: AnswerCompletionOutputDevice }
  | { readonly ok: false; readonly reason: 'corrupt-selection' | 'storage-failed' };
export type OutputDeviceSaveResult =
  | { readonly ok: true; readonly device: AnswerCompletionOutputDevice }
  | { readonly ok: false; readonly reason: 'invalid-selection' | 'storage-failed' };
export type EnumerateOutputDevicesResult =
  | { readonly ok: true; readonly devices: readonly AudioOutputDeviceOption[] }
  | { readonly ok: false; readonly reason: 'unsupported' | 'permission-denied' | 'enumeration-failed' };
export type RequestOutputPermissionResult =
  | { readonly ok: true; readonly stoppedTracks: number }
  | { readonly ok: false; readonly reason: 'unsupported' | 'permission-denied' | 'request-failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDeviceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && /^[A-Za-z\d+/_=-]+$/.test(value);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export function validateAnswerCompletionOutputDevice(value: unknown): AnswerCompletionOutputDevice | null {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'deviceId' && key !== 'label')) return null;
  if (!validDeviceId(value.deviceId) || typeof value.label !== 'string' || value.label.length > 256
    || value.label.trim() !== value.label || hasControlCharacter(value.label)) return null;
  if (value.deviceId === 'default') return DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE;
  if (value.label.length === 0) return null;
  return { deviceId: value.deviceId, label: value.label };
}

export function normalizeAudioOutputDevices(devices: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): AudioOutputDeviceOption[] {
  const seen = new Set<string>();
  const result: AudioOutputDeviceOption[] = [];
  for (const device of devices) {
    if (device.kind !== 'audiooutput' || !validDeviceId(device.deviceId) || seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    result.push({
      deviceId: device.deviceId,
      label: device.deviceId === 'default' ? 'システムの既定' : (device.label.trim() || '名前非表示の出力デバイス'),
    });
  }
  return result;
}

export interface MediaDeviceAccessLike {
  enumerateDevices?(): Promise<readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]>;
  getUserMedia?(constraints: { readonly audio: true }): Promise<{ getTracks(): readonly { stop(): void }[] }>;
}

function permissionError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
}

export async function enumerateAudioOutputDevices(mediaDevices: MediaDeviceAccessLike | undefined): Promise<EnumerateOutputDevicesResult> {
  if (!mediaDevices?.enumerateDevices) return { ok: false, reason: 'unsupported' };
  try {
    const devices = await mediaDevices.enumerateDevices();
    return { ok: true, devices: normalizeAudioOutputDevices(devices) };
  } catch (error) {
    return { ok: false, reason: permissionError(error) ? 'permission-denied' : 'enumeration-failed' };
  }
}

export async function requestAudioOutputPermission(mediaDevices: MediaDeviceAccessLike | undefined): Promise<RequestOutputPermissionResult> {
  if (!mediaDevices?.getUserMedia) return { ok: false, reason: 'unsupported' };
  let stream: { getTracks(): readonly { stop(): void }[] } | undefined;
  let stoppedTracks = 0;
  let tracksStopped = false;
  try {
    stream = await mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getTracks();
    for (const track of tracks) {
      track.stop();
      stoppedTracks += 1;
    }
    tracksStopped = true;
    return { ok: true, stoppedTracks };
  } catch (error) {
    return { ok: false, reason: permissionError(error) ? 'permission-denied' : 'request-failed' };
  } finally {
    if (stream && !tracksStopped) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* Permission cleanup must not affect Options. */ }
      }
    }
  }
}

export class AnswerCompletionOutputDeviceRepository {
  private readonly area: OutputDeviceStorageAreaLike;
  private readonly changes?: OutputDeviceStorageChangesLike;

  constructor(area: OutputDeviceStorageAreaLike, changes?: OutputDeviceStorageChangesLike) {
    this.area = area;
    this.changes = changes;
  }

  async load(): Promise<OutputDeviceLoadResult> {
    try {
      const stored = await this.area.get([ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]);
      const value = stored[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY];
      if (value === undefined) return { ok: true, device: DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE };
      const device = validateAnswerCompletionOutputDevice(value);
      return device ? { ok: true, device } : { ok: false, reason: 'corrupt-selection' };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async save(value: unknown): Promise<OutputDeviceSaveResult> {
    const device = validateAnswerCompletionOutputDevice(value);
    if (!device) return { ok: false, reason: 'invalid-selection' };
    try {
      await this.area.set({ [ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]: device });
      return { ok: true, device };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  subscribe(listener: (result: OutputDeviceLoadResult) => void): () => void {
    if (!this.changes) return () => {};
    const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY in changes)) return;
      const value = changes[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]?.newValue;
      const device = value === undefined ? DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE : validateAnswerCompletionOutputDevice(value);
      listener(device ? { ok: true, device } : { ok: false, reason: 'corrupt-selection' });
    };
    this.changes.addListener(onChanged);
    return () => this.changes?.removeListener(onChanged);
  }
}

export function createChromeAnswerCompletionOutputDeviceRepository(): AnswerCompletionOutputDeviceRepository {
  return new AnswerCompletionOutputDeviceRepository(chrome.storage.local, chrome.storage.onChanged);
}
