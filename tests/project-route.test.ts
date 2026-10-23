import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectIdFromPathname,
  projectIdFromProjectPathname,
  projectConversationFromPathname,
} from '../src/shared/project-route.ts';

const PROJECT_ID = 'g-p-11223344556677889900aabbccddeeff';

test('32桁hexのProject IDをURLから切り出し会話slugをIDに含めない', () => {
  assert.equal(
    projectIdFromPathname(`/g/${PROJECT_ID}-example-project/c/chat-1`),
    PROJECT_ID,
  );
  assert.equal(projectIdFromPathname(`/g/${PROJECT_ID}/c/chat-1`), PROJECT_ID);
  assert.equal(projectIdFromPathname(`/g/${PROJECT_ID}/project`), PROJECT_ID);
  assert.equal(projectIdFromPathname(`/g/${PROJECT_ID}x/project`), null);
  assert.equal(projectIdFromPathname('/g/g-p-alpha/c/chat-1'), null);
});

test('Project表示リンクはcanonical IDのproject pathだけから解決する', () => {
  assert.equal(projectIdFromProjectPathname(`/g/${PROJECT_ID}/project`), PROJECT_ID);
  assert.equal(projectIdFromProjectPathname(`/g/${PROJECT_ID}/project/`), PROJECT_ID);
  assert.equal(projectIdFromProjectPathname(`/g/${PROJECT_ID}-example-project/project`), null);
  assert.equal(projectIdFromProjectPathname('/g/custom-gpt/project'), null);
});

test('active会話リンクのProject IDとchat IDを安全に読み取る', () => {
  assert.deepEqual(
    projectConversationFromPathname(`/g/${PROJECT_ID}/c/chat-123`),
    { projectId: PROJECT_ID, conversationId: 'chat-123' },
  );
  assert.deepEqual(
    projectConversationFromPathname(`/g/${PROJECT_ID}-example-project/c/chat-123`),
    { projectId: PROJECT_ID, conversationId: 'chat-123' },
  );
  assert.equal(projectConversationFromPathname('/g/custom-gpt/c/chat-123'), null);
  assert.equal(projectConversationFromPathname('/c/chat-123'), null);
});

test('通常GPTと通常chatをProjectと誤認しない', () => {
  assert.equal(projectIdFromPathname('/g/custom-gpt/c/chat-1'), null);
  assert.equal(projectIdFromPathname('/g/g-custom/c/chat-1'), null);
  assert.equal(projectIdFromPathname('/c/chat-1'), null);
  assert.equal(projectIdFromPathname(`/search/${PROJECT_ID}`), null);
});
