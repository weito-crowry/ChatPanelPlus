import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

async function editorRenderer() {
  const source = await readFile(new URL('../options/src/TabSettingsEditor.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const states = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = value; }];
    },
    useEffect(effect) { effect(); },
  };
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: (name) => name === 'react' ? hooks : require(name) });
  return (props) => {
    cursor = 0;
    return module.exports.TabSettingsEditor(props);
  };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}

test('削除先タブが消えた後は表示と削除操作の移動先を常時表示へ戻す', async () => {
  const render = await editorRenderer();
  const removedId = 'custom-tab-123e4567-e89b-42d3-a456-426614174001';
  const deleted = [];
  const props = {
    id: 'custom-tab-123e4567-e89b-42d3-a456-426614174002',
    label: '残すタブ', visible: true, custom: true,
    destinations: [{ id: 'always', label: '常時表示' }, { id: removedId, label: '削除予定' }],
    onDelete: (...args) => deleted.push(args),
  };
  const select = elements(render(props)).find(({ type }) => type === 'select');
  select.props.onChange({ currentTarget: { value: removedId } });
  assert.equal(elements(render(props)).find(({ type }) => type === 'select').props.value, removedId);
  const afterDeletion = elements(render({ ...props, destinations: [{ id: 'always', label: '常時表示' }] }));
  assert.equal(afterDeletion.find(({ type }) => type === 'select').props.value, 'always');
  afterDeletion.find(({ type, props: item }) => type === 'button' && item.children === 'このタブを削除').props.onClick();
  assert.deepEqual(deleted, [[props.id, 'always']]);
});
