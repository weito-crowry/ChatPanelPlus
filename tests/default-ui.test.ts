import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_BUTTONS, DEFAULT_TABS, resolveDefaultUI } from '../src/shared/default-ui.ts';

const promptSpec = await readFile(new URL('../docs/design/03-prompt-actions.md', import.meta.url), 'utf8');
const textBlocks = [...promptSpec.matchAll(/~~~text\r?\n([\s\S]*?)~~~/g)].map((match) => match[1].replaceAll('\r\n', '\n'));

test('defines the twenty canonical buttons and five tabs in canonical layout order', () => {
  assert.equal(DEFAULT_BUTTONS.length, 20);
  assert.equal(DEFAULT_TABS.length, 5);
  assert.deepEqual(DEFAULT_BUTTONS.map(({ id }) => id), [
    'now-btn', 'paste-btn', 'clear-btn', 'chat-btn', 'full-btn', 'summary-btn',
    'translate-btn', 'search-btn', 'zokudake-btn', 'handover-btn', 'wall-start-btn',
    'wall-task-btn', 'wall-sum-btn', 'wall-resume-btn', 'yes-btn', 'no-btn',
    'a-btn', 'b-btn', 'c-btn', 'd-btn',
  ]);
  assert.deepEqual(DEFAULT_TABS.map(({ id, label }) => [id, label]), [
    ['directive', '指示'], ['control', '会話制御'], ['wall', '壁打ち'],
    ['binary', '二択'], ['quad', '四択'],
  ]);
  assert.deepEqual(DEFAULT_TABS.map(({ id, buttonIds }) => [id, buttonIds]), [
    ['directive', ['full-btn', 'summary-btn', 'translate-btn', 'search-btn']],
    ['control', ['zokudake-btn', 'handover-btn']],
    ['wall', ['wall-start-btn', 'wall-task-btn', 'wall-sum-btn', 'wall-resume-btn']],
    ['binary', ['yes-btn', 'no-btn']], ['quad', ['a-btn', 'b-btn', 'c-btn', 'd-btn']],
  ]);
});

test('preserves canonical labels, colors, kinds, actions, and short prompt text', () => {
  assert.deepEqual(DEFAULT_BUTTONS.map(({ id, label, color, kind, action, text }) =>
    [id, label, color, kind, action ?? null, text ?? null]), [
    ['now-btn', '現在時刻', '#5a9edc', 'action', 'insert-jst', null],
    ['paste-btn', 'コピペ', '#2ca24c', 'action', 'paste', null],
    ['clear-btn', 'クリア', '#888', 'action', 'clear', null],
    ['chat-btn', '雑談', '#8b5cf6', 'insert', null, '雑談モードで対応してください\n'],
    ['full-btn', '全文', '#6e5adb', 'insert', null, '全文出力してください'],
    ['summary-btn', '要約', '#4b5563', 'insert', null, '以下を要約して\n'],
    ['translate-btn', '翻訳', '#e0912d', 'insert', null, '以下の文を日本語に翻訳してください\n'],
    ['search-btn', '調べて', '#1ca3ec', 'insert', null, '以下のものについて詳しく網羅的に調べてください\n'],
    ['zokudake-btn', '続けて', '#10a37f', 'insert', null, '続けて'],
    ['handover-btn', '引継ぎ', '#0b7285', 'insert', null, textBlocks[0]],
    ['wall-start-btn', '壁打ち開始', '#0ea5e9', 'insert', null, textBlocks[1].slice(0, -1)],
    ['wall-task-btn', '作業依頼', '#0891b2', 'insert', null, '作業依頼\n'],
    ['wall-sum-btn', 'まとめ', '#0f766e', 'insert', null, 'ここまでまとめてください'],
    ['wall-resume-btn', '壁打ち再開', '#2563eb', 'insert', null, '壁打ちモードを再開してください'],
    ['yes-btn', 'はい', '#2069e0', 'insert', null, 'はい'],
    ['no-btn', 'いいえ', '#ea4e43', 'insert', null, 'いいえ'],
    ['a-btn', 'A案', '#10a37f', 'insert', null, 'A案'],
    ['b-btn', 'B案', '#2069e0', 'insert', null, 'B案'],
    ['c-btn', 'C案', '#ea4e43', 'insert', null, 'C案'],
    ['d-btn', 'D案', '#6e5adb', 'insert', null, 'D案'],
  ]);
  assert.equal(textBlocks.length, 2);
  assert.equal(DEFAULT_BUTTONS.find(({ id }) => id === 'handover-btn')?.text?.endsWith('\n'), true);
  assert.equal(DEFAULT_BUTTONS.find(({ id }) => id === 'wall-start-btn')?.text?.endsWith('\n'), false);
});

test('resolves defaults when settings are absent and selects the leftmost visible tab', () => {
  const ui = resolveDefaultUI();
  assert.equal(ui.buttons.length, 20);
  assert.equal(ui.tabs.length, 5);
  assert.equal(ui.selectedTabId, 'directive');
});

test('normalizes duplicate, unknown, and missing order ids deterministically', () => {
  const ui = resolveDefaultUI({
    schemaVersion: 1,
    buttonOrder: { always: ['clear-btn', 'clear-btn', 'ghost'], directive: ['search-btn'] },
    tabOrder: ['wall', 'ghost', 'wall'],
  });
  assert.deepEqual(ui.buttons.filter(({ groupId }) => groupId === 'always').map(({ id }) => id), [
    'clear-btn', 'now-btn', 'paste-btn', 'chat-btn',
  ]);
  assert.deepEqual(ui.buttons.filter(({ groupId }) => groupId === 'directive').map(({ id }) => id), [
    'search-btn', 'full-btn', 'summary-btn', 'translate-btn',
  ]);
  assert.deepEqual(ui.tabs.map(({ id }) => id), ['wall', 'directive', 'control', 'binary', 'quad']);
  assert.equal(ui.selectedTabId, 'wall');
});

test('uses default order when stored order fields are malformed', () => {
  const ui = resolveDefaultUI({
    schemaVersion: 1,
    buttonOrder: { always: { id: 'clear-btn' } },
    tabOrder: 7,
  } as never);
  assert.deepEqual(ui.buttons.slice(0, 4).map(({ id }) => id), [
    'now-btn', 'paste-btn', 'clear-btn', 'chat-btn',
  ]);
  assert.deepEqual(ui.tabs.map(({ id }) => id), ['directive', 'control', 'wall', 'binary', 'quad']);
});

test('projects valid overrides and ignores invalid fields without losing valid siblings', () => {
  const ui = resolveDefaultUI({
    schemaVersion: 1,
    buttonOverrides: {
      'full-btn': { label: '全文表示', color: '#abc', text: '置換文' },
      'now-btn': { label: '時計', text: '実行文字列' },
      'ghost-btn': { label: '不明' },
    },
    tabOverrides: { directive: { visible: false } },
  });
  const full = ui.buttons.find(({ id }) => id === 'full-btn');
  assert.equal(full?.label, '全文表示');
  assert.equal(full?.color, '#abc');
  assert.equal(full?.text, '置換文');
  assert.equal(ui.buttons.find(({ id }) => id === 'now-btn')?.label, '時計');
  assert.equal(ui.buttons.find(({ id }) => id === 'now-btn')?.text, undefined);
  assert.equal(ui.tabs.find(({ id }) => id === 'directive')?.visible, false);
  assert.equal(ui.selectedTabId, 'control');
});

test('falls back to the leftmost visible tab when the selected default tab is hidden', () => {
  const ui = resolveDefaultUI({
    schemaVersion: 1,
    tabOverrides: { directive: { visible: false }, control: { visible: false } },
  });
  assert.equal(ui.selectedTabId, 'wall');
});
