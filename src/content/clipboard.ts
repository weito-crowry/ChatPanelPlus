import type { EditFailureReason, EditResult, SelectionSnapshot } from './editor/adapter.ts';
import { readClipboardContentKind } from './clipboard-content.ts';
import {
  reportClipboardMetric,
  type ClipboardMetric,
  type ClipboardContentKind,
  type ClipboardMetricReporter,
  type ClipboardPasteStrategy,
} from './clipboard-metrics.ts';

export type { ClipboardMetric } from './clipboard-metrics.ts';

export type ClipboardManualReason = 'unavailable' | 'read-failed' | 'empty';

export type ClipboardPasteResult =
  | { readonly kind: 'inserted'; readonly edit: { readonly ok: true } }
  | { readonly kind: 'attachment-accepted'; readonly scope: 'composer-ui' }
  | { readonly kind: 'attachment-unconfirmed' }
  | { readonly kind: 'manual-required'; readonly reason: ClipboardManualReason }
  | { readonly kind: 'edit-failed'; readonly reason: Exclude<EditFailureReason, 'edit-unconfirmed'> }
  | { readonly kind: 'edit-unconfirmed'; readonly reason: 'edit-unconfirmed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'busy' };

export function requiresManualPasteDialog(result: ClipboardPasteResult): boolean {
  return result.kind === 'manual-required';
}

interface ClipboardPasteOptions {
  readonly clipboard: Pick<Clipboard, 'readText'> & Partial<Pick<Clipboard, 'read'>> | undefined;
  readonly captureSelection: () => SelectionSnapshot | null;
  readonly insert: (
    text: string,
    snapshot: SelectionSnapshot | null,
    onMetric?: ClipboardMetricReporter,
  ) => EditResult | Promise<EditResult>;
  readonly insertHTML?: (
    text: string,
    snapshot: SelectionSnapshot | null,
    onMetric?: ClipboardMetricReporter,
  ) => EditResult | Promise<EditResult>;
  readonly paste?: (
    snapshot: SelectionSnapshot | null,
    onMetric?: ClipboardMetricReporter,
  ) => ClipboardPasteAttempt | Promise<ClipboardPasteAttempt>;
  readonly onMetric?: (metric: ClipboardMetric) => void;
  readonly now?: () => number;
}

interface ClipboardPasteAttempt {
  readonly edit: EditResult;
  readonly characterCount?: number;
  readonly contentKind?: ClipboardContentKind;
  readonly attachmentUiChanged?: boolean;
}

export class ClipboardPasteController {
  private snapshot: SelectionSnapshot | null = null;
  private busy = false;
  private readonly now: () => number;
  private readonly options: ClipboardPasteOptions;
  private operationStarted = 0;
  private manualStarted: number | null = null;
  private strategy: ClipboardPasteStrategy = 'insertText';

  constructor(options: ClipboardPasteOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async start(
    snapshot?: SelectionSnapshot | null,
    strategy: ClipboardPasteStrategy = 'execCommandPaste',
  ): Promise<ClipboardPasteResult> {
    if (this.busy) return { kind: 'busy' };
    this.busy = true;
    this.strategy = strategy;
    this.operationStarted = this.timestamp();
    this.snapshot = snapshot === undefined ? this.options.captureSelection() : snapshot;
    if (strategy === 'execCommandPaste') {
      this.metric('click-to-action', this.operationStarted, 'command-starting');
      return this.performPaste();
    }
    if (!this.options.clipboard) return this.finishUnconfirmedRead('unavailable');
    this.metric('click-to-read', this.operationStarted, 'read-starting');
    const readStarted = this.timestamp();
    try {
      const text = await this.options.clipboard.readText();
      this.metric('read', readStarted, text ? 'success' : 'empty', { characterCount: text.length });
      if (!text) return this.requireManualWhenPlainText('empty');
      return this.performInsert(text.replace(/\r\n/g, '\n'));
    } catch {
      this.metric('read', readStarted, 'read-failed');
      return this.requireManualWhenPlainText('read-failed');
    }
  }

  async insertManual(text: string): Promise<ClipboardPasteResult> {
    if (!this.busy) return { kind: 'busy' };
    if (!text) {
      this.cancel();
      return { kind: 'cancelled' };
    }
    if (this.manualStarted !== null) this.metric('manual', this.manualStarted, 'submitted', { characterCount: text.length });
    return this.performInsert(text);
  }

  cancel(): void {
    const wasBusy = this.busy;
    this.snapshot = null;
    this.busy = false;
    if (this.manualStarted !== null) this.metric('manual', this.manualStarted, 'cancelled');
    if (wasBusy) this.metric('complete', this.operationStarted, 'cancelled');
    this.manualStarted = null;
  }

  private requireManual(reason: ClipboardManualReason): ClipboardPasteResult {
    this.manualStarted = this.timestamp();
    this.metric('manual', this.manualStarted, reason);
    return { kind: 'manual-required', reason };
  }

  private async performInsert(text: string): Promise<ClipboardPasteResult> {
    const snapshot = this.snapshot;
    const editStarted = this.timestamp();
    try {
      const insert = this.strategy === 'insertHTML' ? this.options.insertHTML : this.options.insert;
      const edit = await insert?.(text, snapshot, this.options.onMetric)
        ?? { ok: false, reason: 'unexpected-error' } as const;
      const editOutcome = edit.ok ? 'success' : edit.reason;
      return this.finishEdit(edit, editStarted, text.length, editOutcome);
    } catch {
      this.metric('edit', editStarted, 'unexpected-error', { characterCount: text.length });
      this.metric('complete', this.operationStarted, 'edit-error', { characterCount: text.length });
      return { kind: 'edit-failed', reason: 'unexpected-error' };
    } finally { this.finishOperation(); }
  }

  private async performPaste(): Promise<ClipboardPasteResult> {
    const editStarted = this.timestamp();
    let keepOperationOpen = false;
    try {
      const attempt: ClipboardPasteAttempt = await this.options.paste?.(this.snapshot, this.options.onMetric)
        ?? { edit: { ok: false, reason: 'unexpected-error' }, contentKind: 'unknown' };
      if (attempt.contentKind === 'files') {
        const accepted = attempt.edit.ok && attempt.attachmentUiChanged === true;
        const outcome = accepted ? 'attachment-ui-accepted' : 'attachment-ui-unconfirmed';
        this.metric('edit', editStarted, outcome, {});
        this.metric('complete', this.operationStarted, accepted ? 'attachment-accepted' : 'attachment-unconfirmed');
        return accepted
          ? { kind: 'attachment-accepted', scope: 'composer-ui' }
          : { kind: 'attachment-unconfirmed' };
      }
      if (!attempt.edit.ok && attempt.edit.reason === 'edit-rejected') {
        const contentKind = attempt.contentKind ?? await readClipboardContentKind(this.options.clipboard);
        if (contentKind === 'plain-text') {
          this.metric('edit', editStarted, attempt.edit.reason,
            attempt.characterCount === undefined ? {} : { characterCount: attempt.characterCount });
          this.strategy = 'insertText';
          keepOperationOpen = true;
          return this.requireManual('unavailable');
        }
        return this.finishUnconfirmedPaste(editStarted, attempt.characterCount);
      }
      const editOutcome = attempt.edit.ok ? 'success' : attempt.edit.reason;
      return this.finishEdit(attempt.edit, editStarted, attempt.characterCount, editOutcome);
    } catch {
      this.metric('edit', editStarted, 'unexpected-error');
      this.metric('complete', this.operationStarted, 'edit-error');
      return { kind: 'edit-failed', reason: 'unexpected-error' };
    } finally {
      if (!keepOperationOpen) this.finishOperation();
    }
  }

  private finishUnconfirmedPaste(editStarted: number, characterCount?: number): ClipboardPasteResult {
    const details = characterCount === undefined ? {} : { characterCount };
    this.metric('edit', editStarted, 'edit-unconfirmed', details);
    this.metric('complete', this.operationStarted, 'edit-unconfirmed', details);
    return { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' };
  }

  private async requireManualWhenPlainText(reason: ClipboardManualReason): Promise<ClipboardPasteResult> {
    if (await readClipboardContentKind(this.options.clipboard) === 'plain-text') return this.requireManual(reason);
    return this.finishUnconfirmedRead(reason);
  }

  private finishUnconfirmedRead(outcome: string): ClipboardPasteResult {
    this.metric('complete', this.operationStarted, `clipboard-${outcome}-unconfirmed`);
    this.finishOperation();
    return { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' };
  }

  private finishEdit(
    edit: EditResult,
    editStarted: number,
    characterCount: number | undefined,
    editOutcome: string,
  ): ClipboardPasteResult {
    const details = characterCount === undefined ? {} : { characterCount };
    this.metric('edit', editStarted, editOutcome, details);
    const result = edit.ok
      ? { kind: 'inserted', edit } as const
      : edit.reason === 'edit-unconfirmed'
        ? { kind: 'edit-unconfirmed', reason: edit.reason } as const
        : { kind: 'edit-failed', reason: edit.reason } as const;
    this.metric('complete', this.operationStarted, result.kind, details);
    return result;
  }

  private finishOperation(): void {
    this.snapshot = null;
    this.busy = false;
    this.manualStarted = null;
  }

  private metric(
    stage: ClipboardMetric['stage'],
    started: number,
    outcome?: string,
    details: Omit<ClipboardMetric, 'stage' | 'startedAtMs' | 'endedAtMs' | 'durationMs' | 'outcome'> = {},
  ): void {
    reportClipboardMetric(this.options.onMetric, stage, started, () => this.now(), outcome, {
      strategy: this.strategy,
      ...details,
    });
  }

  private timestamp(): number {
    return this.options.onMetric ? this.now() : 0;
  }
}
