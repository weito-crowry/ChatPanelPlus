import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexBridgeFinalAnswer } from '../src/content/codexbridge-watch-response.ts';
import { finalAnswerLabel } from '../src/content/codexbridge-watch-presentation.ts';

test('confirmed final-answer result is retained and shown as confirmed', () => {
  const result = parseCodexBridgeFinalAnswer({
    ok: true,
    data: { status: 'retrieved', text: 'answer\nwith Markdown', completeness: 'confirmed' },
  });

  assert.deepEqual(result, { status: 'retrieved', text: 'answer\nwith Markdown', completeness: 'confirmed' });
  assert.match(finalAnswerLabel(result), /確定/);
  assert.doesNotMatch(finalAnswerLabel(result), /未確認/);
});

test('new Bridge statuses preserve safe reason internally but UI never echoes the raw reason', () => {
  for (const [status, reason] of [
    ['pending', 'turn_terminal_not_observed'],
    ['incomplete', 'terminal_status_conflict'],
    ['incomplete', 'remote_response_identity_mismatch'],
    ['unavailable', 'storage_unavailable'],
    ['unavailable', 'remote_tool_unsupported'],
  ]) {
    const result = parseCodexBridgeFinalAnswer({ ok: true, data: {
      status, reason, ...(status === 'incomplete' ? { completeness: 'unconfirmed' } : {}),
    } });
    assert.equal(result?.status, status);
    assert.equal('reason' in result && result.reason === reason, true);
    assert.equal(finalAnswerLabel(result).includes(reason), false);
  }
});

test('unsafe reason or nonretrieved answer text is rejected before content UI receives it', () => {
  assert.equal(parseCodexBridgeFinalAnswer({
    ok: true, data: { status: 'unavailable', reason: 'private data token' },
  }), null);
  assert.equal(parseCodexBridgeFinalAnswer({
    ok: true, data: { status: 'incomplete', reason: 'terminal_status_conflict', text: 'hidden answer' },
  }), null);
});
