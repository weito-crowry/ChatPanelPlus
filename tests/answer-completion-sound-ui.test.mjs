import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('音量ボタンはTurnsの直前に独立し、状態・操作名・キーボードフォーカスを持つ', async () => {
  const [component, panel, styles] = await Promise.all([
    read('../src/content/ConversationStatistics.tsx'),
    read('../src/content/Panel.tsx'),
    read('../src/content/panel.css'),
  ]);
  const soundPosition = component.indexOf('className="statistics-sound-toggle"');
  const turnsPosition = component.indexOf('className="statistics-trigger"');
  assert.ok(soundPosition >= 0 && soundPosition < turnsPosition);
  assert.match(component, /aria-label=\{`回答完了音を\$\{displayedSoundEnabled \? 'オフ' : 'オン'\}にする`\}/);
  assert.match(component, /aria-pressed=\{displayedSoundEnabled\}/);
  assert.match(component, /title=\{`回答完了音を/);
  assert.match(component, /onClick=\{\(\) => \{ void toggleSound\(\); \}\}/);
  assert.match(component, /onClick=\{\(\) => setDetailsOpen\(\(open\) => !open\)\}/);
  assert.match(styles, /\.statistics-sound-toggle:focus-visible\s*\{/);
  assert.ok(panel.includes("answerCompletionSoundId={settings.answerCompletionSoundId ?? 'tone-660'}"));
  assert.ok(panel.includes('answerCompletionSoundEnabled={soundToggleOptimistic ?? settings.answerCompletionSoundEnabled === true}'));
});

test('Optionsで内蔵音とユーザー音源を試聴・追加・選択・確認削除でき、上限と状態を説明する', async () => {
  const [component, options, actions, assets] = await Promise.all([
    read('../options/src/AnswerCompletionSoundSettings.tsx'),
    read('../options/src/OptionsPage.tsx'),
    read('../options/src/answer-completion-sound-actions.ts'),
    read('../src/shared/answer-completion-sound-assets.ts'),
  ]);
  for (const text of ['aria-label="回答完了時に再生する音"', 'onSelect(event.currentTarget.value)', '選択中の音を試聴', 'accept=".wav,.mp3,.ogg', 'role="alert"', 'role="status"', 'window.confirm', 'asset.name', '既定の短音へ切り替え']) {
    assert.ok(component.includes(text), `音設定UIに ${text} がありません`);
  }
  assert.ok(component.indexOf('await onBeforeDelete(asset.id)') < component.indexOf('await repository.removeAsset(asset.id)'));
  assert.match(options, /onBeforeDelete=\{prepareAnswerCompletionSoundDeletion\}/);
  assert.match(actions, /answerCompletionSoundId: DEFAULT_COMPLETION_SOUND_ID/);
  assert.match(assets, /chatPanelPlus.answerCompletionSoundAssets/);
  assert.match(component, /最大5件/);
  assert.match(component, /512 KiB/);
  assert.match(component, /合計2 MiB/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
});

test('音声プレイヤー・完了Trackerは統計UIの再マウント時に破棄され、二重登録しない', async () => {
  const component = await read('../src/content/ConversationStatistics.tsx');
  assert.match(component, /active.stop\(\);\s*player.dispose\(\);/);
  assert.match(component, /new ConversationStatisticsController/);
  assert.match(component, /player\.setSoundId\(soundId\.current\)/);
  assert.ok(component.includes('soundPlayer.current?.setSoundId(answerCompletionSoundId)'));
  assert.ok(component.includes('soundPlayer.current?.setEnabled(answerCompletionSoundEnabled)'));
});
