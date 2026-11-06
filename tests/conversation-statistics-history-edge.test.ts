import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDocument, FakeElement, turn } from './conversation-statistics-controller-fixture.ts';
import { ConversationStatisticsHistoryScanner } from '../src/content/conversation-statistics-history.ts';

class ChangingScrollElement extends FakeElement {
  scrollHeight = 1_000;
  clientHeight = 200;
  private position = 350;
  onPosition: ((position: number) => void) | null = null;

  get scrollTop(): number { return this.position; }
  set scrollTop(value: number) {
    this.position = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, value));
    this.onPosition?.(this.position);
  }
}

for (const change of ['viewport-shrink', 'history-height', 'scroll-anchor'] as const) {
  test(`末尾の安定待機中の${change}後も新しい端へ進んでから完了する`, async () => {
    const document = new FakeDocument();
    document.root.append(turn('visible', '質問', '回答', 'answer-visible'));
    const scroller = new ChangingScrollElement();
    scroller.setOwnerDocument(document);
    scroller.append(document.root);
    let bottomSnapshots = 0;
    let changePending = false;
    let changed = false;
    let revealed = false;
    scroller.onPosition = (position) => {
      if (changed && !revealed && position >= scroller.scrollHeight - scroller.clientHeight - 1) {
        revealed = true;
        document.root.append(turn('previously-unseen', '遅延質問', '遅延回答', 'answer-late'));
      }
    };
    const window = {
      getComputedStyle: (element: Element) => ({
        overflowY: element === (scroller as unknown as Element) ? 'auto' : 'visible',
      }),
      setTimeout: (callback: () => void) => globalThis.setTimeout(() => {
        // The layout changes while awaiting the final edge observation, without
        // mutating the observed conversation subtree. No wall-clock race is used.
        if (changePending && !changed) {
          changed = true;
          if (change === 'viewport-shrink') scroller.clientHeight = 100;
          else if (change === 'history-height') scroller.scrollHeight = 1_100;
          else scroller.scrollTop = 700;
        }
        callback();
      }, 0),
    } as unknown as Window;
    const collected = new Set<string>();
    const scanner = new ConversationStatisticsHistoryScanner({
      document: document as unknown as Document,
      window,
      root: document.root as unknown as HTMLElement,
      conversationId: 'conversation-a',
      currentConversationId: () => 'conversation-a',
      onSnapshot: (snapshot) => { snapshot.turnKeys.forEach((key) => collected.add(key)); },
      onProgress: ({ direction }) => {
        if (direction === 'newer' && scroller.scrollTop === 800 && !changed) {
          bottomSnapshots += 1;
          // First: arrival at the bottom. Second: first stable edge observation.
          if (bottomSnapshots === 2) changePending = true;
        }
      },
      settleDelayMs: 0,
      stableEdgeObservations: 2,
      maxSteps: 40,
      maxDurationMs: 2_000,
    });

    const result = await scanner.start();

    assert.equal(changed, true, '末尾の非同期待機中にレイアウトを変更した');
    assert.equal(result.status, 'completed');
    assert.deepEqual([...collected].sort(), ['previously-unseen', 'visible'],
      '待機前の古い端判定で完了せず、移動後に見える履歴も計測する');
    assert.equal(scroller.scrollTop, 350, '走査後は開始位置を復元する');
  });
}
