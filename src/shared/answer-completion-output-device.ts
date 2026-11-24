export const ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY = 'chatPanelPlus.answerCompletionOutputDevice';
export const ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION = 2 as const;
export const MAX_ANSWER_COMPLETION_OUTPUT_DEVICES = 8;
export const ANSWER_COMPLETION_OUTPUT_DEVICE_WRITE_LOCK = `${ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY}.write`;
export const DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE = Object.freeze({
  deviceId: 'default',
  label: 'システムの既定',
});
export const DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION = Object.freeze({
  schemaVersion: ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION,
  devices: Object.freeze([]) as readonly AnswerCompletionOutputDevice[],
});

export interface AnswerCompletionOutputDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface AnswerCompletionOutputDeviceSelection {
  readonly schemaVersion: typeof ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION;
  readonly devices: readonly AnswerCompletionOutputDevice[];
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

export interface OutputDeviceLockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export type OutputDeviceLoadResult =
  | { readonly ok: true; readonly selection: AnswerCompletionOutputDeviceSelection }
  | { readonly ok: false; readonly reason: 'corrupt-selection' | 'storage-failed' };
export type OutputDeviceSaveResult =
  | { readonly ok: true; readonly selection: AnswerCompletionOutputDeviceSelection }
  | { readonly ok: false; readonly reason: 'invalid-selection' | 'selection-limit' | 'corrupt-selection' | 'storage-failed' };
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

export function normalizeAnswerCompletionOutputDeviceSelection(value: unknown): AnswerCompletionOutputDeviceSelection | null {
  if (!isRecord(value)) return null;
  if (!Object.hasOwn(value, 'schemaVersion')) {
    const legacy = validateAnswerCompletionOutputDevice(value);
    if (!legacy) return null;
    return legacy.deviceId === 'default'
      ? DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION
      : { schemaVersion: ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION, devices: [legacy] };
  }
  if (value.schemaVersion !== ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION
    || Object.keys(value).some((key) => key !== 'schemaVersion' && key !== 'devices')
    || !Array.isArray(value.devices)) return null;

  const validatedDevices: AnswerCompletionOutputDevice[] = [];
  for (const rawDevice of value.devices) {
    const device = validateAnswerCompletionOutputDevice(rawDevice);
    if (!device) return null;
    validatedDevices.push(device);
  }
  const hasDefault = validatedDevices.some(({ deviceId }) => deviceId === 'default');
  const hasPhysical = validatedDevices.some(({ deviceId }) => deviceId !== 'default');
  if (hasDefault && hasPhysical) return null;
  if (hasDefault) return DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION;

  const seen = new Set<string>();
  const devices: AnswerCompletionOutputDevice[] = [];
  for (const device of validatedDevices) {
    if (seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    devices.push(device);
    if (devices.length > MAX_ANSWER_COMPLETION_OUTPUT_DEVICES) return null;
  }
  return { schemaVersion: ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION, devices };
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
  private readonly locks?: OutputDeviceLockManagerLike;

  constructor(area: OutputDeviceStorageAreaLike, changes?: OutputDeviceStorageChangesLike, locks?: OutputDeviceLockManagerLike) {
    this.area = area;
    this.changes = changes;
    this.locks = locks;
  }

  async load(): Promise<OutputDeviceLoadResult> {
    try {
      const stored = await this.area.get([ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]);
      const value = stored[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY];
      if (value === undefined) return { ok: true, selection: DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION };
      const selection = normalizeAnswerCompletionOutputDeviceSelection(value);
      return selection ? { ok: true, selection } : { ok: false, reason: 'corrupt-selection' };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async save(value: unknown): Promise<OutputDeviceSaveResult> {
    const selection = normalizeAnswerCompletionOutputDeviceSelection(value);
    if (!selection) return { ok: false, reason: 'invalid-selection' };
    return this.withWriteLock(async () => this.writeSelection(selection));
  }

  async setDeviceSelected(deviceValue: unknown, selected: boolean): Promise<OutputDeviceSaveResult> {
    const device = validateAnswerCompletionOutputDevice(deviceValue);
    if (!device || device.deviceId === 'default') return { ok: false, reason: 'invalid-selection' };
    return this.withWriteLock(async () => {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const current = loaded.selection.devices;
      const exists = current.some(({ deviceId }) => deviceId === device.deviceId);
      if (exists === selected) return { ok: true, selection: loaded.selection };
      if (selected && current.length >= MAX_ANSWER_COMPLETION_OUTPUT_DEVICES) return { ok: false, reason: 'selection-limit' };
      const devices = selected ? [...current, device] : current.filter(({ deviceId }) => deviceId !== device.deviceId);
      return this.writeSelection({ schemaVersion: ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION_SCHEMA_VERSION, devices });
    });
  }

  async resetToDefault(): Promise<OutputDeviceSaveResult> {
    return this.withWriteLock(async () => this.writeSelection(DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION));
  }

  private async writeSelection(selection: AnswerCompletionOutputDeviceSelection): Promise<OutputDeviceSaveResult> {
    try {
      await this.area.set({ [ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]: selection });
      return { ok: true, selection };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  private async withWriteLock(operation: () => Promise<OutputDeviceSaveResult>): Promise<OutputDeviceSaveResult> {
    try {
      return this.locks ? await this.locks.request(ANSWER_COMPLETION_OUTPUT_DEVICE_WRITE_LOCK, operation) : await operation();
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  subscribe(listener: (result: OutputDeviceLoadResult) => void): () => void {
    if (!this.changes) return () => {};
    const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY in changes)) return;
      const value = changes[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]?.newValue;
      const selection = value === undefined ? DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION
        : normalizeAnswerCompletionOutputDeviceSelection(value);
      listener(selection ? { ok: true, selection } : { ok: false, reason: 'corrupt-selection' });
    };
    this.changes.addListener(onChanged);
    return () => this.changes?.removeListener(onChanged);
  }
}

export function createChromeAnswerCompletionOutputDeviceRepository(): AnswerCompletionOutputDeviceRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T,>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, callback) }
    : undefined;
  return new AnswerCompletionOutputDeviceRepository(chrome.storage.local, chrome.storage.onChanged, locks);
}
