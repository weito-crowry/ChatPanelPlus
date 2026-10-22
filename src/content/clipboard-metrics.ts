export type ClipboardMetricStage =
  | 'click-to-read'
  | 'click-to-action'
  | 'read'
  | 'composer'
  | 'selection'
  | 'command'
  | 'validation'
  | 'manual'
  | 'edit'
  | 'complete';

export interface ClipboardInputEventMetric {
  readonly inputType: string | null;
  readonly trusted: boolean;
  readonly targetMatchesEditor: boolean;
  readonly dataIsNull: boolean;
  readonly dataCharacterCount: number | null;
}

export type ClipboardPasteStrategy = 'insertText' | 'insertHTML' | 'execCommandPaste';

export type ClipboardContentKind = 'plain-text' | 'rich-text' | 'files' | 'other' | 'unknown';

export interface ClipboardObservedEventMetric extends ClipboardInputEventMetric {
  readonly type: 'paste' | 'beforeinput' | 'input';
}

export interface ClipboardMetric {
  readonly stage: ClipboardMetricStage;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
  readonly outcome?: string;
  readonly strategy?: ClipboardPasteStrategy;
  readonly characterCount?: number;
  readonly commandAccepted?: boolean;
  readonly inputEventReceived?: boolean;
  readonly inputTrusted?: boolean;
  readonly inputType?: string | null;
  readonly dataMatches?: boolean | null;
  readonly editorChanged?: boolean | null;
  readonly inputEventCount?: number;
  readonly inputEvents?: readonly ClipboardInputEventMetric[];
  readonly inputDataCharacterCount?: number;
  readonly observedEvents?: readonly ClipboardObservedEventMetric[];
  readonly pasteEventCount?: number;
  readonly pasteEventReceived?: boolean;
  readonly pasteEventTrusted?: boolean | null;
  readonly pasteTextCharacterCount?: number | null;
  readonly pasteContentKind?: ClipboardContentKind;
  readonly pasteFileCount?: number;
  readonly attachmentUiChanged?: boolean;
  readonly beforeInputEventCount?: number;
  readonly contentMatches?: boolean | null;
  readonly composerMatchesEditor?: boolean | null;
  readonly postCaretMatchesEditor?: boolean;
  readonly verificationMethod?: 'editor-range' | 'input-events' | null;
}

export type ClipboardMetricReporter = (metric: ClipboardMetric) => void;

export function reportClipboardMetric(
  reporter: ClipboardMetricReporter | undefined,
  stage: ClipboardMetricStage,
  startedAtMs: number,
  now: () => number,
  outcome?: string,
  details: Omit<ClipboardMetric, 'stage' | 'startedAtMs' | 'endedAtMs' | 'durationMs' | 'outcome'> = {},
): void {
  if (!reporter) return;
  try {
    const endedAtMs = now();
    reporter({
      stage,
      startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      ...(outcome ? { outcome } : {}),
      ...details,
    });
  } catch { /* Optional diagnostic reporting cannot change the paste result. */ }
}
