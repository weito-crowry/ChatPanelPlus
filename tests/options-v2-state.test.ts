import assert from 'node:assert/strict';
import test from 'node:test';
import { getOptionsSectionFromHash, getEditorGroupFallback, type OptionsSectionId } from '../options/src/options-v2-state.ts';

test('Options V2 resolves supported hash sections and falls back to panel', () => {
  const sections: OptionsSectionId[] = ['panel', 'connection', 'projects', 'audio', 'data'];
  for (const section of sections) assert.equal(getOptionsSectionFromHash(`#${section}`), section);
  assert.equal(getOptionsSectionFromHash('#unknown'), 'panel');
  assert.equal(getOptionsSectionFromHash(''), 'panel');
});

test('editor group falls back when the selected tab disappears or becomes hidden', () => {
  const groups = [{ id: 'always' }, { id: 'directive' }, { id: 'wall' }];
  assert.equal(getEditorGroupFallback('wall', groups), 'wall');
  assert.equal(getEditorGroupFallback('removed', groups), 'always');
  assert.equal(getEditorGroupFallback('hidden', [{ id: 'always' }]), 'always');
});
