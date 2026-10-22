import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentPath = fileURLToPath(new URL('../src/content/ConversationStatistics.tsx', import.meta.url));
const panelPath = fileURLToPath(new URL('../src/content/Panel.tsx', import.meta.url));
const stylePath = fileURLToPath(new URL('../src/content/panel.css', import.meta.url));

test('Turnsホバー、クリック詳細、INPUT/OUTPUT/総数、再集計を提供する', async () => {
  const source = await readFile(componentPath, 'utf8');
  for (const required of [
    'title={tooltip}',
    'aria-haspopup="dialog"',
    'INPUT文字数',
    'OUTPUT文字数',
    '総文字数',
    '再集計',
    'role="status"',
    '未保存の統計があります。',
  ]) assert.ok(source.includes(required), `統計UIに ${required} がありません`);
});

test('再集計と全履歴走査を詳細パネル最下部に横並びで表示し、走査中は中止へ切り替える', async () => {
  const [source, styles] = await Promise.all([readFile(componentPath, 'utf8'), readFile(stylePath, 'utf8')]);
  assert.match(source, /className="statistics-actions"[\s\S]*?再集計[\s\S]*?全履歴を集計/);
  assert.match(source, /state\.historyScan\.scanning[\s\S]*?中止/);
  assert.match(source, /statistics-actions/);
  assert.match(styles, /\.statistics-action\s*\{[\s\S]*?min-height:\s*40px/);
});

test('走査中はTurnsと取得数を表示し、終了理由を区別する', async () => {
  const source = await readFile(componentPath, 'utf8');
  for (const status of ['過去履歴を集計中', '新たに', '部分取得', '中止しました', '走査を完了', 'エラー']) {
    assert.ok(source.includes(status), `進捗状態 ${status} がありません`);
  }
  assert.doesNotMatch(source, /%|進捗率/);
});

test('全履歴を確認できない場合は総文字数を集計済み総文字数と表示する', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /state\.aggregate\.partial\s*\?\s*'集計済み総文字数'\s*:\s*'総文字数'/);
  assert.match(source, /<dt>\{totalLabel\}<\/dt>/);
  assert.match(source, /未読込の履歴を含まない可能性があります/);
});

test('TurnsがDOM件数ではなく会話の計測済み累積数と分かる説明を表示する', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /この会話で計測したユニークTurn Keyの累積/);
  assert.match(source, /保存済みの計測済みTurn Key数/);
});

test('詳細小窓はIME中のEscapeを奪わず、画面に合わせて配置し、説明だけスクロールする', async () => {
  const [component, panel, styles] = await Promise.all([
    readFile(componentPath, 'utf8'), readFile(panelPath, 'utf8'), readFile(stylePath, 'utf8'),
  ]);
  assert.match(component, /event\.nativeEvent\.isComposing/);
  assert.match(component, /setDetailsOpen\(false\)/);
  assert.match(panel, /<div className="panel-content" hidden=\{currentViewState\.minimized\}>[\s\S]*?<ConversationStatistics answerCompletionSoundEnabled=\{settings\.answerCompletionSoundEnabled === true\} \/>/);
  assert.match(component, /getBoundingClientRect\(\)/);
  assert.match(component, /findComposerForm/);
  assert.match(styles, /\.statistics-popover\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(styles, /\.statistics-popover-body\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(styles, /\.statistics-actions\s*\{[\s\S]*?flex:\s*0 0 auto/);
});

test('統計監視はsubmitを観測するだけで送信を止めず、統計UIから送信しない', async () => {
  const [controller, component] = await Promise.all([
    readFile(fileURLToPath(new URL('../src/content/conversation-statistics-controller.ts', import.meta.url)), 'utf8'),
    readFile(componentPath, 'utf8'),
  ]);
  assert.match(controller, /form\.addEventListener\('submit', this\.onComposerSubmit, true\)/);
  assert.doesNotMatch(controller, /preventDefault|stopPropagation|\.click\(\)|sendMessage/);
  assert.doesNotMatch(component, /sendMessage|\.click\(\)|key === ['"]Enter['"]/);
  assert.match(component, /type="button"/);
});
