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

test('Optionsで通知音と出力先を試聴・選択し、音源管理と上限を説明する', async () => {
  const [component, options, actions, assets, outputDevice] = await Promise.all([
    read('../options/src/AnswerCompletionSoundSettings.tsx'),
    read('../options/src/OptionsPage.tsx'),
    read('../options/src/answer-completion-sound-actions.ts'),
    read('../src/shared/answer-completion-sound-assets.ts'),
    read('../options/src/AnswerCompletionOutputDeviceSettings.tsx'),
  ]);
  for (const text of ['aria-label="回答完了時に再生する音"', 'onSelect(event.currentTarget.value)', '選択中の音を選択中の出力先で試聴', 'accept=".wav,.mp3,.ogg', 'role="alert"', 'role="status"', 'window.confirm', 'asset.name', '既定の短音へ切り替え']) {
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
  for (const text of ['再生デバイス', 'システムの既定', '回答完了音の出力デバイス', 'デバイス一覧を更新',
    'マイク権限を確認して出力先を表示', 'requestAudioOutputPermission', '接続中', '未接続または利用不可',
    '録音・保存・送信はしていません']) {
    assert.ok(outputDevice.includes(text), `出力先UIに ${text} がありません`);
  }
  assert.ok(component.includes('ANSWER_COMPLETION_SOUND_PREVIEW'));
});

test('Optionsの音量rangeは値を表示し、previewにdraft値を渡し、0%で再生できないと示す', async () => {
  const [component, options, panel] = await Promise.all([
    read('../options/src/AnswerCompletionSoundSettings.tsx'),
    read('../options/src/OptionsPage.tsx'),
    read('../src/content/Panel.tsx'),
  ]);
  assert.match(component, /type="range"/);
  assert.match(component, /min=\{0\}/);
  assert.match(component, /max=\{100\}/);
  assert.match(component, /step=\{1\}/);
  assert.match(component, /htmlFor="answer-completion-sound-volume"/);
  assert.match(component, /aria-valuetext=\{`\$\{volumePercent\}%`\}/);
  assert.match(component, /\{volumePercent\}%/);
  assert.match(component, /音量0%のため試聴・通知音は再生されません/);
  assert.match(component, /previewCompletionSound\(document, soundId, asset, \(\) => audioContextFactory\(\), volumePercent\)/);
  assert.ok(options.includes('volumePercent={draft.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}'));
  assert.ok(options.includes('onVolumeChange={updateAnswerCompletionSoundVolume}'));
  assert.ok(options.includes('answerCompletionSoundVolumePercent: volumePercent'));
  assert.ok(panel.includes('answerCompletionSoundVolumePercent={settings.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}'));
});

test('音声プレイヤー・完了Tracker・タブ表示通知は統計UIの再マウント時に破棄され、二重登録しない', async () => {
  const component = await read('../src/content/ConversationStatistics.tsx');
  assert.match(component, /active.stop\(\);\s*tabCompletionIndicator\.dispose\(\);\s*player\.dispose\(\);/);
  assert.match(component, /new ConversationStatisticsController/);
  assert.match(component, /player\.setSoundId\(soundId\.current\)/);
  assert.ok(component.includes('player.setVolumePercent(soundVolumePercent.current)'));
  assert.ok(component.includes('soundPlayer.current?.setSoundId(answerCompletionSoundId)'));
  assert.ok(component.includes('soundPlayer.current?.setVolumePercent(answerCompletionSoundVolumePercent)'));
  assert.ok(component.includes('soundPlayer.current?.setEnabled(answerCompletionSoundEnabled)'));
  assert.ok(component.includes('onAnswerCompleted: () => {'));
  assert.ok(component.includes('notifyTab: () => tabCompletionIndicator.onAnswerCompleted()'));
  assert.ok(component.includes('soundEnabled: soundEnabled.current'));
  assert.ok(component.includes('soundVolumePercent: soundVolumePercent.current'));
});
