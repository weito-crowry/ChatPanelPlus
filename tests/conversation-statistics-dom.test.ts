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
} from '../src/content/conversation-statistics-dom.ts';

class FakeElement {
  readonly attributes: Readonly<Record<string, string>>;
  readonly baseText: string;
  readonly children: FakeElement[];
  readonly tagName: string;
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
