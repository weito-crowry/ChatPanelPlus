import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectConversationIdentities,
  collectConversationSnapshot,
  collectConversationTurnKeys,
  collectTurnIdentity,
  collectTurnObservation,
  conversationIdFromPath,
  findTurnElement,
  findUniqueTurnElement,
  readCompletedAssistantMessageText,
} from '../src/content/conversation-statistics-dom.ts';

class FakeElement {
  readonly attributes: Readonly<Record<string, string>>;
  readonly baseText: string;
  readonly children: FakeElement[];
  readonly tagName: string;
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  removed = false;
  cloneCalls = 0;

  constructor(attributes: Record<string, string> = {}, baseText = '', children: FakeElement[] = [], tagName = 'div') {
    this.attributes = attributes;
    this.baseText = baseText;
    this.children = children;
    this.tagName = tagName.toLowerCase();
    for (const child of children) child.parentElement = this;
  }

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  get innerText(): string { return this.baseText + this.children.filter((child) => !child.removed).map((child) => child.innerText).join(''); }
  get textContent(): string { return this.innerText; }
  get childNodes(): NodeListOf<ChildNode> {
    const textNodes = this.baseText ? [{ nodeType: 3, textContent: this.baseText }] : [];
    return [...textNodes, ...this.children.filter((child) => !child.removed)] as unknown as NodeListOf<ChildNode>;
  }
  remove(): void { this.removed = true; }
  cloneNode(): FakeElement { this.cloneCalls += 1; return new FakeElement({ ...this.attributes }, this.baseText, this.children.map((child) => child.cloneNode()), this.tagName); }
  contains(element: FakeElement): boolean { return this.children.includes(element) || this.children.some((child) => child.contains(element)); }

  querySelectorAll(selector: string): FakeElement[] {
    const selectors = selector.split(',').map((item) => item.trim());
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return descendants.filter((element) => selectors.some((part) => element.matches(part)));
  }

  private matches(selector: string): boolean {
    if (selector === '*') return true;
    if (selector === this.tagName) return true;
    const role = /^\[role="([^"]+)"\]$/u.exec(selector)?.[1];
    if (role) return this.attributes.role === role;
    const equalsValue = /^\[([^=*]+)="([^"]+)"\]$/u.exec(selector);
    if (equalsValue) return this.attributes[equalsValue[1]!] === equalsValue[2];
    const containsValue = /^\[([^\]]+)\*="([^"]+)"\]$/u.exec(selector);
    if (containsValue) return (this.attributes[containsValue[1]!] ?? '').includes(containsValue[2]!);
    const attribute = /^\[([^\]]+)\]$/u.exec(selector)?.[1];
    return attribute ? attribute in this.attributes : false;
  }
}

function turn(turnKey: string, state: string, userText: string, assistantId?: string, outputText?: string, controls: FakeElement[] = []) {
  const user = new FakeElement({ 'data-user-message-bubble': '' }, userText);
  const assistant = assistantId
    ? new FakeElement({ 'data-chatgpt-selection-message-id': assistantId }, '', [
      new FakeElement({ 'data-dil-message-id': assistantId }, outputText ?? '', controls),
    ])
    : new FakeElement();
  return new FakeElement({ 'data-turn-key': turnKey }, '', [
    new FakeElement({ 'data-talvt-turn-state': state }, '', [user, assistant]),
  ]);
}

function collect(...turns: FakeElement[]) {
  return collectConversationSnapshot(new FakeElement({}, '', turns) as unknown as ParentNode);
}

test('実測した親子構造からUserとAssistantを独立収集し、DILの同一IDを二重計数しない', () => {
  const result = collect(turn('turn-1', 'complete', '  A\n😀', 'answer-1', 'B\n😀'));
  assert.deepEqual(result.turnKeys, ['turn-1']);
  assert.deepEqual(result.observations, [{ turnKey: 'turn-1', inputChars: 5, assistantMessageId: 'answer-1', outputChars: 3, assistantState: 'complete' }]);
});

test('in_progressと未知状態では出力文字数を確定せず、完了でも本文なしを成功扱いしない', () => {
  const result = collect(
    turn('turn-live', 'in_progress', '質問', undefined),
    turn('turn-unknown', 'pending', '別の質問', 'answer-unknown', '未確定'),
    turn('turn-empty', 'complete', '空回答', 'answer-empty'),
  );
  assert.deepEqual(result.observations, [
    { turnKey: 'turn-live', inputChars: 2, assistantState: 'in_progress' },
    { turnKey: 'turn-unknown', inputChars: 4, assistantMessageId: 'answer-unknown', assistantState: 'unknown' },
    { turnKey: 'turn-empty', inputChars: 3, assistantMessageId: 'answer-empty', assistantState: 'complete' },
  ]);
});

test('DIL IDがAssistant IDと一致しないときは文字数を推測しない', () => {
  const mismatched = new FakeElement({ 'data-turn-key': 'turn-mismatch' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }, '', [
      new FakeElement({ 'data-user-message-bubble': '' }, '質問'),
      new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-1' }, '', [
        new FakeElement({ 'data-dil-message-id': 'assistant-2' }, 'この本文は確定しない'),
      ]),
    ]),
  ]);
  assert.deepEqual(collect(mismatched).observations, [{
    turnKey: 'turn-mismatch', inputChars: 2, assistantMessageId: 'assistant-1', assistantState: 'complete',
  }]);
});

test('同じTurn KeyとAssistant IDが重複DOMに現れても1件だけ収集する', () => {
  const result = collect(
    turn('turn-1', 'complete', '質問', 'answer-1', '回答'),
    turn('turn-1', 'complete', '質問', 'answer-1', '回答'),
  );
  assert.deepEqual(result.turnKeys, ['turn-1']);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0]?.outputChars, 2);
});

test('手動スナップショットはUser発言のある非表示でないターンだけを集め、画面外ターンを残す', () => {
  const hidden = new FakeElement({ 'aria-hidden': 'true' }, '', [
    turn('hidden-old-branch', 'complete', '旧質問', 'old-answer', '旧回答'),
  ]);
  const withoutUser = new FakeElement({ 'data-turn-key': 'assistant-only' }, '', [
    new FakeElement({ 'data-chatgpt-selection-message-id': 'answer-only' }, '回答'),
  ]);
  const offscreen = turn('offscreen-history', 'complete', '過去の質問', 'history-answer', '過去の回答');

  const result = collect(hidden, withoutUser, offscreen);

  assert.deepEqual(result.turnKeys, ['offscreen-history']);
  assert.deepEqual(result.observations, [{
    turnKey: 'offscreen-history', inputChars: 5, assistantMessageId: 'history-answer', outputChars: 5, assistantState: 'complete',
  }]);
});

test('同じTurn Keyの可視DOMが異なる分岐を示す場合は混合せず部分スナップショットにする', () => {
  const result = collect(
    turn('ambiguous-turn', 'complete', '同じ質問', 'answer-old', '旧回答'),
    turn('ambiguous-turn', 'complete', '同じ質問', 'answer-new', '新回答'),
  );

  assert.deepEqual(result.turnKeys, []);
  assert.deepEqual(result.observations, []);
  assert.equal(result.partial, true);
});

test('回答再生成後は非表示の旧回答ではなく現在選択中の回答を計測する', () => {
  const oldAssistant = new FakeElement({ 'data-chatgpt-selection-message-id': 'answer-old', 'aria-hidden': 'true' }, '', [
    new FakeElement({ 'data-dil-message-id': 'answer-old' }, 'old response'),
  ]);
  const selectedAssistant = new FakeElement({ 'data-chatgpt-selection-message-id': 'answer-current' }, '', [
    new FakeElement({ 'data-dil-message-id': 'answer-current' }, 'current response'),
  ]);
  const currentTurn = new FakeElement({ 'data-turn-key': 'regen-turn' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }, '', [
      new FakeElement({ 'data-user-message-bubble': '' }, 'question'),
      oldAssistant,
      selectedAssistant,
    ]),
  ]);

  assert.deepEqual(collect(currentTurn).observations, [{
    turnKey: 'regen-turn', inputChars: 8, assistantMessageId: 'answer-current', outputChars: 16, assistantState: 'complete',
  }]);
});

test('同じ選択Assistant IDの表示DOMが異なる本文を持つ場合はOUTPUTを確定しない', () => {
  const currentTurn = new FakeElement({ 'data-turn-key': 'duplicate-answer-turn' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }, '', [
      new FakeElement({ 'data-user-message-bubble': '' }, 'question'),
      new FakeElement({ 'data-chatgpt-selection-message-id': 'answer-current' }, '', [
        new FakeElement({ 'data-dil-message-id': 'answer-current' }, 'current response'),
      ]),
      new FakeElement({ 'data-chatgpt-selection-message-id': 'answer-current' }, '', [
        new FakeElement({ 'data-dil-message-id': 'answer-current' }, 'stale response'),
      ]),
    ]),
  ]);

  assert.deepEqual(collect(currentTurn).observations, [{
    turnKey: 'duplicate-answer-turn', inputChars: 8, assistantMessageId: 'answer-current', assistantState: 'complete',
  }]);
});

test('同じUser本文の重複DOMと添付要素を二重に数えない', () => {
  const duplicate = new FakeElement({ 'data-turn-key': 'turn-duplicate' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }, '', [
      new FakeElement({ 'data-user-message-bubble': '' }, '問😀', [new FakeElement({}, 'photo.png', [], 'img')]),
      new FakeElement({ 'data-user-message-bubble': '' }, '問😀', [new FakeElement({}, 'photo.png', [], 'img')]),
      new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-1' }, '回答'),
    ]),
  ]);
  assert.equal(collect(duplicate).observations[0]?.inputChars, 2);
});

test('操作UI・添付実体の表示を除外し、会話URLからConversation IDを読む', () => {
  const result = collect(turn('turn-1', 'complete', '文', 'answer-1', '答', [
    new FakeElement({}, 'Copy', [], 'button'),
    new FakeElement({ 'data-testid': 'message-attachment' }, 'file.pdf'),
  ]));
  assert.deepEqual(result.observations, [{ turnKey: 'turn-1', inputChars: 1, assistantMessageId: 'answer-1', outputChars: 1, assistantState: 'complete' }]);
  assert.equal(conversationIdFromPath('/c/conv-123'), 'conv-123');
  assert.equal(conversationIdFromPath('/g/gpt-1/c/conv-456'), 'conv-456');
  assert.equal(conversationIdFromPath('/'), null);
});

test('増分ID走査は本文を複製せず、特定ターンだけを後から本文収集できる', () => {
  const first = turn('turn-1', 'in_progress', '質問', 'answer-1', '回答');
  const second = turn('turn-2', 'complete', '古い質問', 'answer-2', '古い回答');
  const root = new FakeElement({}, '', [first, second]);
  assert.deepEqual(collectConversationIdentities(root as unknown as ParentNode), {
    turnKeys: ['turn-1', 'turn-2'],
    identities: [
      { turnKey: 'turn-1', assistantMessageId: 'answer-1', assistantState: 'in_progress' },
      { turnKey: 'turn-2', assistantMessageId: 'answer-2', assistantState: 'complete' },
    ],
  });
  assert.deepEqual(collectConversationTurnKeys(root as unknown as ParentNode), ['turn-1', 'turn-2']);
  assert.equal(first.children[0]?.children[0]?.cloneCalls, 0);
  const identity = collectTurnIdentity(first as unknown as Element);
  assert.deepEqual(identity, { turnKey: 'turn-1', assistantMessageId: 'answer-1', assistantState: 'in_progress' });
  assert.deepEqual(collectTurnObservation(first as unknown as Element), {
    turnKey: 'turn-1', inputChars: 2, assistantMessageId: 'answer-1', assistantState: 'in_progress',
  });
  assert.equal(findTurnElement(root as unknown as ParentNode, 'turn-2'), second);
  assert.ok(first.children[0]?.children[0]?.cloneCalls > 0);
});

test('完了した正確なassistant messageのDIL本文だけを読み、UIとhidden textを除外する', () => {
  const candidate = turn('current-turn', 'complete', '質問', 'assistant-current', '完了本文', [
    new FakeElement({}, 'Copy control text', [], 'button'),
    new FakeElement({ 'aria-hidden': 'true' }, 'hidden ID text'),
  ]);
  const previous = turn('previous-turn', 'complete', '過去質問', 'assistant-previous', '過去のID');
  const root = new FakeElement({}, '', [previous, candidate]);

  assert.equal(findUniqueTurnElement(root as unknown as ParentNode, 'current-turn'), candidate);
  assert.equal(findUniqueTurnElement(root as unknown as ParentNode, 'missing-turn'), null);
  assert.equal(readCompletedAssistantMessageText(candidate as unknown as Element, 'assistant-current'), '完了本文');
  assert.equal(readCompletedAssistantMessageText(candidate as unknown as Element, 'assistant-previous'), null);
  assert.equal(readCompletedAssistantMessageText(turn('streaming', 'in_progress', '質問', 'assistant-live', '部分回答') as unknown as Element,
    'assistant-live'), null);
  assert.equal(readCompletedAssistantMessageText(new FakeElement({}, '', [candidate, candidate]) as unknown as Element,
    'assistant-current'), null);
  const plainText = new FakeElement({ 'data-turn-key': 'plain-text-turn' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }),
    new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-text' }, 'plain text answer', [
      new FakeElement({}, 'copy', [], 'button'),
    ]),
  ]);
  assert.equal(readCompletedAssistantMessageText(plainText as unknown as Element, 'assistant-text'), 'plain text answer');
});

test('同じ確定message IDに複数の異なる本文があれば完了本文を曖昧として拒否する', () => {
  const duplicate = new FakeElement({ 'data-turn-key': 'ambiguous-body' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }, '', [
      new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-same' }, '', [
        new FakeElement({ 'data-dil-message-id': 'assistant-same' }, 'first response'),
      ]),
      new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-same' }, '', [
        new FakeElement({ 'data-dil-message-id': 'assistant-same' }, 'different response'),
      ]),
    ]),
  ]);
  assert.equal(readCompletedAssistantMessageText(duplicate as unknown as Element, 'assistant-same'), null);
});

test('自動監視本文はbr・表セル・コードブロックのDOM境界を保持する', () => {
  const turnElement = new FakeElement({ 'data-turn-key': 'block-text-turn' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }),
    new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-block-text' }, '', [
      new FakeElement({ 'data-dil-message-id': 'assistant-block-text' }, '', [
        new FakeElement({}, '段落1', [], 'p'),
        new FakeElement({}, '', [new FakeElement({}, '01a207cf-52ab-7900-a91d-3288982ab221', [], 'code')], 'p'),
        new FakeElement({}, '', [
          new FakeElement({}, '行1'), new FakeElement({}, '', [], 'br'), new FakeElement({}, '行2'),
        ], 'p'),
        new FakeElement({}, '', [new FakeElement({}, '', [
          new FakeElement({}, '', [new FakeElement({}, '01a207d0-12ab-7c00-a911-3288982ab222', [], 'code')], 'td'),
          new FakeElement({}, '', [new FakeElement({}, '01a207d1-12ab-7c00-a911-3288982ab223', [], 'code')], 'td'),
        ], 'tr')], 'table'),
        new FakeElement({}, '', [new FakeElement({}, '01a207d2-12ab-7c00-a911-3288982ab224', [], 'code')], 'pre'),
      ]),
    ]),
  ]);

  assert.equal(readCompletedAssistantMessageText(turnElement as unknown as Element, 'assistant-block-text'),
    '段落1\n01a207cf-52ab-7900-a91d-3288982ab221\n行1\n行2\n01a207d0-12ab-7c00-a911-3288982ab222\n01a207d1-12ab-7c00-a911-3288982ab223\n01a207d2-12ab-7c00-a911-3288982ab224');
});

test('統計OUTPUT文字数はブロック本文の既存flat text計数を維持する', () => {
  const turnElement = new FakeElement({ 'data-turn-key': 'statistics-block-turn' }, '', [
    new FakeElement({ 'data-talvt-turn-state': 'complete' }),
    new FakeElement({ 'data-user-message-bubble': '' }, 'question'),
    new FakeElement({ 'data-chatgpt-selection-message-id': 'assistant-statistics-block' }, '', [
      new FakeElement({ 'data-dil-message-id': 'assistant-statistics-block' }, '', [
        new FakeElement({}, 'ab', [], 'p'), new FakeElement({}, 'cd', [], 'p'),
      ]),
    ]),
  ]);

  assert.deepEqual(collect(turnElement).observations, [{
    turnKey: 'statistics-block-turn', inputChars: 8, assistantMessageId: 'assistant-statistics-block',
    outputChars: 4, assistantState: 'complete',
  }]);
});
