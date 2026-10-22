import assert from 'node:assert/strict';
import test from 'node:test';
import { startInteractionDiagnostics } from '../src/content/interaction-debug.ts';

function eventDocument(): Document {
  return new EventTarget() as unknown as Document;
}

test('明示的な診断フラグがないとsubmitを記録しない', () => {
  const document = eventDocument();
  const events: unknown[] = [];
  startInteractionDiagnostics('', document, (event) => events.push(event), () => 100);

  document.dispatchEvent(new Event('submit', { cancelable: true }));

  assert.deepEqual(events, []);
});

test('有効時は非機密なイベント時系列だけ記録しイベントを抑止しない', () => {
  const document = eventDocument();
  const events: Array<Record<string, unknown>> = [];
  let time = 100;
  const stop = startInteractionDiagnostics(
    '?cppDebugInteraction=1',
    document,
    (event) => events.push(event as unknown as Record<string, unknown>),
    () => time,
  );
  const input = new Event('beforeinput', { cancelable: true });
  Object.defineProperties(input, {
    inputType: { value: 'insertText' },
    data: { value: 'private text must not be recorded' },
  });

  document.dispatchEvent(input);
  time = 110;
  document.dispatchEvent(new Event('focusin'));
  time = 125;
  document.dispatchEvent(new Event('submit', { cancelable: true }));

  assert.deepEqual(events.map(({ type, atMs, source, trusted, defaultPrevented, sendEvent }) => ({
    type, atMs, source, trusted, defaultPrevented, sendEvent,
  })), [
    { type: 'beforeinput', atMs: 0, source: 'document', trusted: false, defaultPrevented: false, sendEvent: false },
    { type: 'focusin', atMs: 10, source: 'document', trusted: false, defaultPrevented: false, sendEvent: false },
    { type: 'submit', atMs: 25, source: 'document', trusted: false, defaultPrevented: false, sendEvent: true },
  ]);
  assert.equal(events[0]?.inputType, 'insertText');
  assert.equal(Object.hasOwn(events[0] ?? {}, 'data'), false);
  assert.equal(input.defaultPrevented, false);
  stop();
});
