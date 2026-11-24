import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('パネルのスピーカー1個は実効音声状態を示し、会話別muteだけを操作する', async () => {
  const [component, panel, controller, styles, baseStyles, muteHook, options] = await Promise.all([
    read('../src/content/ConversationStatistics.tsx'),
    read('../src/content/PanelView.tsx'),
    read('../src/content/usePanelController.ts'),
    read('../src/content/panel-main-views.css'),
    read('../src/content/panel.css'),
    read('../src/content/useConversationAudioMute.ts'),
    read('../options/src/OptionsPage.tsx'),
  ]);
  const mutePosition = component.indexOf('className="statistics-conversation-mute-toggle"');
  const turnsPosition = component.indexOf('className="statistics-trigger"');
  assert.ok(mutePosition >= 0 && mutePosition < turnsPosition);
  assert.equal((component.match(/className="statistics-conversation-mute-toggle"/g) ?? []).length, 1);
  assert.doesNotMatch(component, /statistics-sound-toggle|toggleSound|onToggleAnswerCompletionSound|soundTogglePending/);
  assert.match(component, /const speakerMuted = !answerCompletionSoundEnabled \|\| conversationMuted/);
  assert.match(component, /const speakerStatus = `全体の回答完了音は\$\{answerCompletionSoundEnabled \? 'ON' : 'OFF'\}です。このタブ・会話のミュートは\$\{conversationMuted \? 'ON' : 'OFF'\}です。`/);
  assert.match(component, /aria-label=\{conversationSpeakerLabel\}/);
  assert.match(component, /aria-pressed=\{conversationMuted\}/);
  assert.match(component, /title=\{conversationSpeakerTitle\}/);
  assert.match(component, /speakerMuted \? <path d="m16 9/);
  assert.match(component, /onClick=\{\(\) => \{ void onToggleConversationMute\?\.\(!conversationMuted\); \}\}/);
  assert.match(component, /disabled=\{!conversationId \|\| !conversationMuteLoaded \|\| conversationMutePending/);
  assert.match(component, /getMuteSnapshotRef\.current\?\.\(\)/);
  assert.match(component, /conversationIdFromPath\(window\.location\.pathname\) !== eventConversationId/);
  assert.match(component, /onClick=\{\(\) => setDetailsOpen\(\(open\) => !open\)\}/);
  assert.doesNotMatch(baseStyles, /\.statistics-sound-toggle/);
  assert.match(styles, /\.statistics-conversation-mute-toggle:focus-visible\s*\{/);
  assert.ok(panel.includes('answerCompletionSoundId={answerCompletionSoundId}'));
  assert.ok(panel.includes('answerCompletionSoundEnabled={answerCompletionSoundEnabled}'));
  assert.doesNotMatch(panel, /onToggleAnswerCompletionSound|soundTogglePending|soundToggleError/);
  assert.ok(panel.includes('conversationMuted={conversationMuted}'));
  assert.ok(panel.includes('onToggleConversationMute={onToggleConversationMute}'));
  assert.ok(controller.includes("answerCompletionSoundId: settings.answerCompletionSoundId ?? 'tone-660'"));
  assert.ok(controller.includes('answerCompletionSoundEnabled: settings.answerCompletionSoundEnabled === true'));
  assert.doesNotMatch(controller, /toggleAnswerCompletionSound|soundToggleOptimistic|answerCompletionSoundEnabled: enabled/);
  assert.ok(controller.includes('getConversationMuteSnapshot: conversationMute.getSnapshot'));
  assert.ok(muteHook.includes('setMuted(id, nextMuted)'));
  assert.ok(options.includes('enabled={draft.answerCompletionSoundEnabled === true}'));
  assert.ok(options.includes('enabled={draft.codexBridgeTerminalSoundEnabled === true}'));
  assert.ok(options.includes('volumePercent={draft.codexBridgeTerminalSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}'));
  assert.match(options, /current\.codexBridgeTerminalSoundId === soundId[\s\S]*?codexBridgeTerminalSoundId: DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID/);
  assert.match(options, /codexBridgeTerminalSoundVolumePercent: volumePercent/);
  assert.equal((options.match(/<AnswerCompletionSoundSettings/g) ?? []).length, 2);
});

test('Optionsで通知音と出力先を試聴・選択し、音源管理と上限を説明する', async () => {
  const [component, options, actions, assets, outputDevice] = await Promise.all([
    read('../options/src/AnswerCompletionSoundSettings.tsx'),
    read('../options/src/OptionsPage.tsx'),
    read('../options/src/answer-completion-sound-actions.ts'),
    read('../src/shared/answer-completion-sound-assets.ts'),
    read('../options/src/AnswerCompletionOutputDeviceSettings.tsx'),
  ]);
  for (const text of ['aria-label={soundLabel}', 'onSelect(event.currentTarget.value)', '選択中の音を選択中の出力先で試聴', 'accept=".wav,.mp3,.ogg', 'role="alert"', 'role="status"', 'window.confirm', 'asset.name', '各通知の既定音へ切り替え']) {
    assert.ok(component.includes(text), `音設定UIに ${text} がありません`);
  }
  assert.ok(component.indexOf('await onBeforeDelete(asset.id)') < component.indexOf('await repository.removeAsset(asset.id)'));
  assert.match(options, /onBeforeDelete=\{prepareAnswerCompletionSoundDeletion\}/);
  assert.match(actions, /codexBridgeTerminalSoundId: DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID/);
  assert.match(assets, /chatPanelPlus.answerCompletionSoundAssets/);
  assert.match(component, /最大5件/);
  assert.match(component, /512 KiB/);
  assert.match(component, /合計2 MiB/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
  for (const text of ['再生デバイス', 'システムの既定', '音を再生する出力先', 'デバイス一覧を更新',
    'マイク権限を確認して出力先を表示', 'requestAudioOutputPermission', '接続中', '未接続または利用不可',
    '録音・保存・送信はしていません']) {
    assert.ok(outputDevice.includes(text), `出力先UIに ${text} がありません`);
  }
  assert.ok(component.includes('ANSWER_COMPLETION_SOUND_PREVIEW'));
  assert.match(component, /一部の出力先で試聴しました/);
  assert.match(component, /response\.playback\.succeededCount/);
  assert.match(component, /response\.playback\.outputCount/);
  assert.equal((component.match(/<AnswerCompletionOutputDeviceSettings/g) ?? []).length, 1);
  assert.ok(component.includes('includeSharedLibrary'));
});

test('Optionsの音量rangeは値を表示し、previewにdraft値を渡し、0%で再生できないと示す', async () => {
  const [component, options, panel, controller] = await Promise.all([
    read('../options/src/AnswerCompletionSoundSettings.tsx'),
    read('../options/src/OptionsPage.tsx'),
    read('../src/content/PanelView.tsx'),
    read('../src/content/usePanelController.ts'),
  ]);
  assert.match(component, /type="range"/);
  assert.match(component, /min=\{0\}/);
  assert.match(component, /max=\{100\}/);
  assert.match(component, /step=\{1\}/);
  assert.match(component, /htmlFor=\{`\$\{idPrefix\}-volume`\}/);
  assert.match(component, /aria-valuetext=\{`\$\{volumePercent\}%`\}/);
  assert.match(component, /\{volumePercent\}%/);
  assert.match(component, /音量0%のため試聴・通知音は再生されません/);
  assert.match(component, /previewCompletionSound\(document, soundId, asset, \(\) => audioContextFactory\(\), volumePercent\)/);
  assert.ok(options.includes('volumePercent={draft.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}'));
  assert.ok(options.includes('onVolumeChange={updateAnswerCompletionSoundVolume}'));
  assert.ok(options.includes('answerCompletionSoundVolumePercent: volumePercent'));
  assert.ok(panel.includes('answerCompletionSoundVolumePercent={answerCompletionSoundVolumePercent}'));
  assert.ok(controller.includes('answerCompletionSoundVolumePercent: settings.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT'));
});

test('出力先UIは複数checkbox・選択数・未接続選択保持・既定出力を示し、共通JSON範囲を変えない', async () => {
  const [output, options, dataManager] = await Promise.all([
    read('../options/src/AnswerCompletionOutputDeviceSettings.tsx'),
    read('../options/src/OptionsPage.tsx'),
    read('../options/src/saved-data-manager.ts'),
  ]);
  assert.match(output, /type="checkbox"/);
  assert.match(output, /選択中/);
  assert.match(output, /MAX_ANSWER_COMPLETION_OUTPUT_DEVICES/);
  assert.match(output, /未接続または利用不可/);
  assert.match(output, /setDeviceSelected/);
  assert.match(output, /システムの既定出力を使用/);
  assert.doesNotMatch(output, /<select/);
  assert.match(options, /共通設定JSONには含まれません/);
  assert.match(dataManager, /normalizeAnswerCompletionOutputDeviceSelection/);
});

test('音声プレイヤー・完了Tracker・タブ表示通知は統計UIの再マウント時に破棄され、二重登録しない', async () => {
  const component = await read('../src/content/ConversationStatistics.tsx');
  assert.match(component, /active.stop\(\);\s*indicator\.dispose\(\);[\s\S]*?if \(tabCompletionIndicator\.current === indicator\) tabCompletionIndicator\.current = null;[\s\S]*?player\.dispose\(\);/);
  assert.match(component, /new ConversationStatisticsController/);
  assert.match(component, /player\.setSoundId\(soundId\.current\)/);
  assert.ok(component.includes('player.setVolumePercent(soundVolumePercent.current)'));
  assert.ok(component.includes('soundPlayer.current?.setSoundId(answerCompletionSoundId)'));
  assert.ok(component.includes('soundPlayer.current?.setVolumePercent(answerCompletionSoundVolumePercent)'));
  assert.ok(component.includes('soundPlayer.current?.setEnabled(answerCompletionSoundEnabled)'));
  const completionCheck = component.indexOf('onAnswerCompletionChecked: (eventDetected, reason, eventConversationId) => {');
  const publishedCheck = component.indexOf('publishCodexBridgeAutoWatchCompletionCheck(', completionCheck);
  const completionCallback = component.indexOf('onAnswerCompleted: (event, eventConversationId) => {');
  const autoWatchCompletion = component.indexOf('publishCodexBridgeAutoWatchCompletion(', completionCallback);
  const soundDispatch = component.indexOf('dispatchAnswerCompletionNotifications({', completionCallback);
  assert.ok(completionCheck >= 0 && publishedCheck > completionCheck);
  assert.ok(completionCallback >= 0 && autoWatchCompletion > completionCallback && soundDispatch > autoWatchCompletion);
  assert.ok(component.includes('notifyTab: () => tabCompletionIndicator.current?.onAnswerCompleted()'));
  assert.ok(component.includes('soundEnabled: soundEnabled.current'));
  assert.ok(component.includes('soundVolumePercent: soundVolumePercent.current'));
});
