import {
  isCodexBridgeTerminalEventSavedMessage,
  type CodexBridgeTerminalEventSavedMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { parseCodexBridgeFinalAnswer } from './codexbridge-watch-response.ts';
import type { EditResult } from './editor/adapter.ts';

export type CodexBridgeAutoReflectResult = Readonly<{ status: 'reflected' }> | Readonly<{
  status: 'not-reflected';
  reason: 'disabled' | 'route-or-setting-changed' | 'pending' | 'no-final-answer' | 'unconfirmed'
    | 'incomplete' | 'retrieval-failed' | 'empty-answer' | 'editor-not-found' | 'ime-composing'
    | 'complex-content' | 'insertion-failed';
}>;

export type CodexBridgeAutoReflectDependencies = Readonly<{
  isEligible: (event: CodexBridgeTerminalEventSavedMessage) => boolean;
  readFinalAnswer: (eventId: string) => Promise<unknown>;
  appendAnswer: (text: string) => EditResult;
  wait: (milliseconds: number) => Promise<void>;
  onResult: (eventId: string, result: CodexBridgeAutoReflectResult) => void;
}>;

const PENDING_RETRY_DELAYS = [250, 500] as const;

export function isTerminalEventNewerThanAutoReflectEnable(
  event: Pick<CodexBridgeTerminalEventSavedMessage, 'detectedAt'>,
  enabled: boolean,
  enabledAt: number | null,
): boolean {
  const detectedAt = Date.parse(event.detectedAt);
  return enabled && Number.isSafeInteger(enabledAt) && detectedAt > (enabledAt as number);
}

export function createCodexBridgeTerminalAnswerAutoReflector(dependencies: CodexBridgeAutoReflectDependencies) {
  const seen = new Set<string>();
  const conversationTails = new Map<string, Promise<void>>();

  async function process(event: CodexBridgeTerminalEventSavedMessage, enabledAtReceipt: boolean): Promise<void> {
    const report = (result: CodexBridgeAutoReflectResult) => dependencies.onResult(event.eventId, result);
    if (!enabledAtReceipt) { report({ status: 'not-reflected', reason: 'disabled' }); return; }
    for (let attempt = 0; attempt <= PENDING_RETRY_DELAYS.length; attempt += 1) {
      if (!dependencies.isEligible(event)) { report({ status: 'not-reflected', reason: 'route-or-setting-changed' }); return; }
      let response: unknown;
      try { response = await dependencies.readFinalAnswer(event.eventId); }
      catch { report({ status: 'not-reflected', reason: 'retrieval-failed' }); return; }
      if (!dependencies.isEligible(event)) { report({ status: 'not-reflected', reason: 'route-or-setting-changed' }); return; }
      const answer = parseCodexBridgeFinalAnswer(response);
      if (!answer) { report({ status: 'not-reflected', reason: 'retrieval-failed' }); return; }
      if (answer.status === 'pending') {
        const delay = PENDING_RETRY_DELAYS[attempt];
        if (delay !== undefined) {
          await dependencies.wait(delay);
          continue;
        }
        report({ status: 'not-reflected', reason: 'pending' });
        return;
      }
      if (answer.status === 'no-final-answer') { report({ status: 'not-reflected', reason: 'no-final-answer' }); return; }
      if (answer.status === 'incomplete') { report({ status: 'not-reflected', reason: 'incomplete' }); return; }
      if (answer.status === 'unavailable' || answer.status === 'failed') {
        report({ status: 'not-reflected', reason: 'retrieval-failed' }); return;
      }
      if (answer.completeness !== 'confirmed') { report({ status: 'not-reflected', reason: 'unconfirmed' }); return; }
      if (!answer.text) { report({ status: 'not-reflected', reason: 'empty-answer' }); return; }
      if (!dependencies.isEligible(event)) { report({ status: 'not-reflected', reason: 'route-or-setting-changed' }); return; }
      let insertion: EditResult;
      try { insertion = dependencies.appendAnswer(answer.text); }
      catch { report({ status: 'not-reflected', reason: 'insertion-failed' }); return; }
      if (insertion.ok) { report({ status: 'reflected' }); return; }
      if (insertion.reason === 'editor-not-found' || insertion.reason === 'editor-hidden' || insertion.reason === 'editor-disabled') {
        report({ status: 'not-reflected', reason: 'editor-not-found' }); return;
      }
      if (insertion.reason === 'ime-composing') { report({ status: 'not-reflected', reason: 'ime-composing' }); return; }
      if (insertion.reason === 'complex-content') { report({ status: 'not-reflected', reason: 'complex-content' }); return; }
      report({ status: 'not-reflected', reason: 'insertion-failed' });
      return;
    }
  }

  function receive(value: unknown, enabledAtReceipt: boolean): Promise<boolean> {
    if (!isCodexBridgeTerminalEventSavedMessage(value) || seen.has(value.eventId)) return Promise.resolve(false);
    seen.add(value.eventId);
    const event = value;
    const previous = conversationTails.get(event.ownerConversationId) ?? Promise.resolve();
    const task = previous.then(() => process(event, enabledAtReceipt));
    const tail = task.then(() => undefined, () => undefined);
    conversationTails.set(event.ownerConversationId, tail);
    void tail.finally(() => {
      if (conversationTails.get(event.ownerConversationId) === tail) conversationTails.delete(event.ownerConversationId);
    });
    return task.then(() => true, () => {
      dependencies.onResult(event.eventId, { status: 'not-reflected', reason: 'retrieval-failed' });
      return true;
    });
  }

  return { receive };
}
