import { useEffect, useMemo, useState } from 'react';
import { resolveDefaultUI } from '../../src/shared/default-ui.ts';
import { createChromeSettingsRepository } from '../../src/shared/settings-repository.ts';
import {
  DEFAULT_COMPLETION_SOUND_ID,
  DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID,
} from '../../src/shared/answer-completion-sound-definitions.ts';
import { DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT } from '../../src/shared/answer-completion-sound-volume.ts';
import { CODEX_BRIDGE_MCP_DEFAULT_URL } from '../../src/shared/codexbridge-mcp-protocol.ts';
import {
  CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN,
  DEFAULT_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE,
} from '../../src/shared/codexbridge-terminal-answer-template.ts';
import { prepareSoundAssetDeletion } from './answer-completion-sound-actions.ts';
import { AnswerCompletionSoundSettings } from './AnswerCompletionSoundSettings';
import { McpConnectionSettings } from './McpConnectionSettings';
import { OptionsDataManager } from './OptionsDataManager';
import { OptionsNavigation } from './OptionsNavigation';
import { OptionsPanelEditor } from './OptionsPanelEditor';
import { ProjectFolderPatternsSettings } from './ProjectFolderPatternsSettings';
import { TerminalAnswerTemplateSettings } from './TerminalAnswerTemplateSettings';
import {
  getCustomButtonImportDeletions, getCustomTabImportDeletions, mergeImportedSettings,
  resetSettingsPreservingCustomButtons,
} from './options-state';
import { getOptionsSectionFromHash, type OptionsSectionId } from './options-v2-state.ts';
import {
  DEFAULT_SETTINGS, parseSettingsJson, serializeSettings, validateExtensionSettings,
  type ExtensionSettings,
} from '../../src/shared/settings.ts';

type ImportPreview = Readonly<{ settings: ExtensionSettings; savedCustomCount: number; importedCustomCount: number;
  deletionIds: readonly string[]; deletedCustomTabCount: number; legacy: boolean }>;

export function OptionsPage() {
  const repository = useMemo(() => createChromeSettingsRepository(), []);
  const [base, setBase] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [soundAssetOperation, setSoundAssetOperation] = useState(false);
  const [resetViewOnSave, setResetViewOnSave] = useState(false);
  const [replaceKnownFieldsOnSave, setReplaceKnownFieldsOnSave] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [status, setStatus] = useState('設定を読み込んでいます。');
  const [section, setSection] = useState<OptionsSectionId>(() => getOptionsSectionFromHash(window.location.hash));

  async function reload() {
    const result = await repository.loadSettings();
    if (!result.ok) {
      setReady(false);
      setStatus(result.reason === 'corrupt-settings'
        ? '保存済み設定が破損しているか未対応です。既存値を保護するため保存を停止しました。'
        : '設定を読み込めませんでした。既定値で表示していますが保存は停止しました。');
      return;
    }
    setBase(result.settings); setDraft(result.settings); setReady(true);
    setResetViewOnSave(false); setReplaceKnownFieldsOnSave(false); setStatus('保存済み設定を読み込みました。');
  }
  useEffect(() => { void reload(); }, [repository]);
  useEffect(() => {
    const sync = () => setSection(getOptionsSectionFromHash(window.location.hash));
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  function navigate(id: OptionsSectionId) {
    setSection(id);
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
  }
  function updateSetting(field: keyof ExtensionSettings, value: unknown) {
    setDraft((current) => ({ ...current, [field]: value })); setStatus('未保存の変更があります。');
  }
  function updateAnswerCompletionSoundVolume(volumePercent: number) {
    setDraft((current) => ({ ...current, answerCompletionSoundVolumePercent: volumePercent }));
    setStatus('未保存の変更があります。');
  }
  function updateCodexTerminalSoundVolume(volumePercent: number) {
    setDraft((current) => ({ ...current, codexBridgeTerminalSoundVolumePercent: volumePercent }));
    setStatus('未保存の変更があります。');
  }
  async function prepareAnswerCompletionSoundDeletion(soundId: string): Promise<boolean> {
    const result = await prepareSoundAssetDeletion(repository, soundId);
    if (!result.ok) {
      setStatus(result.reason === 'settings-load-failed'
        ? '保存済み設定を確認できないため、音源ファイルは削除していません。'
        : '選択音を既定値へ保存できなかったため、音源ファイルは削除していません。再読み込みして確認してください。');
      return false;
    }
    setBase(result.base);
    setDraft((current) => ({
      ...current,
      ...(current.answerCompletionSoundId === soundId ? { answerCompletionSoundId: DEFAULT_COMPLETION_SOUND_ID } : {}),
      ...(current.codexBridgeTerminalSoundId === soundId
        ? { codexBridgeTerminalSoundId: DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID } : {}),
    }));
    return true;
  }
  async function save() {
    if (!ready || saving || soundAssetOperation) return;
    const validated = validateExtensionSettings(draft);
    if (!validated.ok) {
      setStatus(validated.reason === 'invalid-terminal-answer-template'
        ? `最終回答テンプレートに「${CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN}」を含め、8,192 UTF-16文字以内で入力してください。`
        : '設定に不正な値があります。色は #RGB または #RRGGBB で入力してください。');
      return;
    }
    setSaving(true);
    const tabs = resolveDefaultUI(validated.settings).tabs.filter(({ visible }) => visible);
    const result = await repository.saveSettings(base, validated.settings, {
      ...(resetViewOnSave ? { resetViewState: { selectedTabId: tabs[0]?.id ?? null, minimized: false } } : {}),
      ...(replaceKnownFieldsOnSave ? { replaceKnownFields: true } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setStatus(result.reason === 'conflict' ? '別のOptions画面で同じ項目が変更されました。再読み込みして変更を確認してください。'
        : result.reason === 'corrupt-settings' ? '保存済み設定が破損しているため上書きできません。'
          : result.reason === 'storage-failed' ? '保存に失敗しました。ドラフトは保持されています。'
            : '設定を検証できませんでした。ドラフトは保持されています。');
      return;
    }
    setBase(result.settings); setDraft(result.settings); setResetViewOnSave(false);
    setReplaceKnownFieldsOnSave(false); setStatus('設定を保存しました。');
  }
  function exportSettings() {
    const validated = validateExtensionSettings(draft);
    if (!validated.ok) {
      setStatus(validated.reason === 'invalid-terminal-answer-template'
        ? `最終回答テンプレートに「${CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN}」を含め、8,192 UTF-16文字以内で入力してください。`
        : '設定に不正な値があります。保存値を確認してください。');
      return;
    }
    const blob = new Blob([serializeSettings(validated.settings)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'chatpanelplus-settings.json'; link.click(); URL.revokeObjectURL(url);
  }
  async function inspectImport(file?: File) {
    setImportPreview(null); if (!file) return;
    let json: string;
    try { json = await file.text(); } catch { setStatus('ファイルを読み込めませんでした。保存済み設定は変更されていません。'); return; }
    const parsed = parseSettingsJson(json);
    if (!parsed.ok) {
      setStatus(parsed.reason === 'invalid-terminal-answer-template'
        ? `JSONの最終回答テンプレートに「${CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN}」を含め、8,192 UTF-16文字以内で入力してください。`
        : parsed.reason === 'unsupported-schema' ? '未対応の設定schemaです。保存済み設定は変更されていません。'
          : 'JSONまたは設定値が不正です。保存済み設定は変更されていません。'); return;
    }
    const legacy = !Object.hasOwn(parsed.settings, 'customButtons') && !Object.hasOwn(parsed.settings, 'customTabs');
    const imported = mergeImportedSettings(parsed.settings, base);
    setImportPreview({ settings: imported, savedCustomCount: Object.keys(base.customButtons ?? {}).length,
      importedCustomCount: Object.keys(imported.customButtons ?? {}).length,
      deletionIds: getCustomButtonImportDeletions(base, parsed.settings),
      deletedCustomTabCount: getCustomTabImportDeletions(base, parsed.settings).length, legacy });
    setStatus('読込内容を確認し、ドラフトへ適用してください。');
  }
  function resetDraft() {
    if (soundAssetOperation) return;
    if (!window.confirm('ボタンとタブの設定を既定値へ戻す変更をドラフトに適用しますか？保存するまで反映されません。')) return;
    setDraft((current) => resetSettingsPreservingCustomButtons(current)); setResetViewOnSave(true); setReplaceKnownFieldsOnSave(true);
    setStatus('既定値への変更をドラフトに適用しました。保存すると確定します。');
  }
  function applyImport() {
    if (!importPreview || soundAssetOperation) return;
    const { deletionIds, deletedCustomTabCount } = importPreview;
    if ((deletionIds.length || deletedCustomTabCount) && !window.confirm(
      `JSONの適用でカスタム構造を置換し、カスタムボタン${deletionIds.length}個・タブ${deletedCustomTabCount}個を削除します。保存後の復元にはJSONバックアップが必要です。\n\n${deletionIds.join('\n')}\n\nドラフトに適用しますか？`)) {
      setStatus('インポートの適用を取り消しました。編集中のドラフトは変更されていません。'); return;
    }
    setDraft(importPreview.settings); setResetViewOnSave(false); setReplaceKnownFieldsOnSave(true);
    setImportPreview(null); setStatus('インポート設定をドラフトへ適用しました。保存するまで反映されません。');
  }

  return <main className="options-page options-v2">
    <header className="page-header"><p className="product-name">ChatPanelPlus</p><h1>設定</h1>
      <p>目次から編集する設定を選べます。入力中のドラフトは切り替えても保持されます。</p></header>
    <p className="settings-status" role="status">{status}</p>
    <div className="options-workspace"><OptionsNavigation active={section} onNavigate={navigate} />
      <div className="options-content">
        <section className="options-section" id="panel" aria-labelledby="panel-title" hidden={section !== 'panel'}>
          <h2 id="panel-title">パネル編集</h2><OptionsPanelEditor draft={draft} setDraft={setDraft} ready={ready} saving={saving} status={setStatus} />
        </section>
        <section className="options-section" id="connection" aria-labelledby="connection-title" hidden={section !== 'connection'}>
          <h2 id="connection-title">接続設定</h2><p className="scope-note">接続先は共通設定、MCP tokenはsession領域に独立して保存されます。</p>
          <McpConnectionSettings endpoint={draft.codexBridgeMcpUrl ?? CODEX_BRIDGE_MCP_DEFAULT_URL} disabled={!ready || saving || soundAssetOperation}
            onEndpointChange={(value) => updateSetting('codexBridgeMcpUrl', value)} />
        </section>
        <section className="options-section" id="projects" aria-labelledby="projects-title" hidden={section !== 'projects'}>
          <h2 id="projects-title">プロジェクト</h2><p className="scope-note">保存済みプロジェクト名とフォルダパターンはプロジェクトIDに紐づく独立保存です。</p>
          <ProjectFolderPatternsSettings />
        </section>
        <section className="options-section" id="audio" aria-labelledby="audio-title" hidden={section !== 'audio'}>
          <h2 id="audio-title">通知・音声</h2><p className="scope-note">通知ごとに有効化・音源・音量を設定できます。音源ライブラリと複数出力先は共通、ミュートは会話別です。出力先は独立保存領域で、共通設定JSONには含まれません。</p>
          <fieldset disabled={!ready || saving || soundAssetOperation}>
            <AnswerCompletionSoundSettings
              idPrefix="answer-completion"
              title="ChatGPT回答完了音"
              enabledLabel="ChatGPTの回答完了時に音を鳴らす"
              soundLabel="ChatGPT回答完了時に再生する音"
              selectedSoundId={draft.answerCompletionSoundId ?? DEFAULT_COMPLETION_SOUND_ID}
              enabled={draft.answerCompletionSoundEnabled === true}
              volumePercent={draft.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}
              disabled={!ready || saving || soundAssetOperation}
              onSelect={(value) => updateSetting('answerCompletionSoundId', value)}
              onToggleEnabled={(value) => updateSetting('answerCompletionSoundEnabled', value)}
              onVolumeChange={updateAnswerCompletionSoundVolume}
              onBeforeDelete={prepareAnswerCompletionSoundDeletion}
              defaultSoundId={DEFAULT_COMPLETION_SOUND_ID}
              includeSharedLibrary
              onSharedLibraryBusyChange={setSoundAssetOperation} />
            <AnswerCompletionSoundSettings
              idPrefix="codex-terminal-completion"
              title="Codex監視終了音"
              enabledLabel="Codexスレッドの監視終了時に音を鳴らす"
              soundLabel="Codex監視終了時に再生する音"
              selectedSoundId={draft.codexBridgeTerminalSoundId ?? DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID}
              enabled={draft.codexBridgeTerminalSoundEnabled === true}
              volumePercent={draft.codexBridgeTerminalSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}
              disabled={!ready || saving || soundAssetOperation}
              onSelect={(value) => updateSetting('codexBridgeTerminalSoundId', value)}
              onToggleEnabled={(value) => updateSetting('codexBridgeTerminalSoundEnabled', value)}
              onVolumeChange={updateCodexTerminalSoundVolume}
              onBeforeDelete={prepareAnswerCompletionSoundDeletion}
              defaultSoundId={DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID} />
          </fieldset>
        </section>
        <section className="options-section" id="auto-reflect" aria-labelledby="auto-reflect-title" hidden={section !== 'auto-reflect'}>
          <h2 id="auto-reflect-title">自動反映</h2>
          <p className="scope-note">監視終了時の最終回答を、会話別にONにした入力欄へ未送信の下書きとして反映します。</p>
          <TerminalAnswerTemplateSettings value={draft.codexBridgeTerminalAnswerTemplate ?? DEFAULT_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE}
            disabled={!ready || saving || soundAssetOperation}
            onChange={(value) => updateSetting('codexBridgeTerminalAnswerTemplate', value)} />
        </section>
        <section className="options-section" id="data" aria-labelledby="data-title" hidden={section !== 'data'}>
          <h2 id="data-title">データ管理</h2><OptionsDataManager active={section === 'data'} />
          <section className="settings-card layout-actions" aria-labelledby="layout-actions-title">
            <h2 id="layout-actions-title">設定JSON</h2>
            <p>JSONはタブ・ボタン等の共通設定のみです。全保存領域のバックアップではなく、フォルダパターンとMCP tokenを含みません。</p>
            <div className="layout-buttons"><button type="button" disabled={!ready || saving || soundAssetOperation} onClick={resetDraft}>既定値に戻す</button>
              <button type="button" disabled={!ready || saving || soundAssetOperation} onClick={exportSettings}>JSONを書き出す</button>
              <label className="import-picker">JSONを読み込む<input type="file" accept="application/json,.json" disabled={!ready || saving || soundAssetOperation}
                onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void inspectImport(file); }} /></label></div>
            {importPreview && <div className="import-preview" aria-label="インポートプレビュー">
              <p>schemaVersion {importPreview.settings.schemaVersion}、ボタン{importPreview.importedCustomCount}個の設定です。</p>
              <p>保存済みカスタムボタン: {importPreview.savedCustomCount}個 / 適用後: {importPreview.importedCustomCount}個{importPreview.legacy ? '（旧JSONのため保存済み定義を保持）' : ''}</p>
              {importPreview.deletedCustomTabCount > 0 && <p>明示置換で削除されるカスタムタブ: {importPreview.deletedCustomTabCount}個</p>}
              {importPreview.deletionIds.length > 0 && <p>削除予定ID: {importPreview.deletionIds.join('、')}</p>}
              <button type="button" disabled={!ready || saving || soundAssetOperation} onClick={applyImport}>この設定をドラフトに適用</button>
            </div>}
          </section>
        </section>
      </div>
    </div>
    <footer className="save-bar"><span className="save-bar-status" aria-hidden="true">{status}</span>
      <button type="button" disabled={!ready || saving || soundAssetOperation} onClick={() => void reload()}>保存値を再読み込み</button>
      <button type="button" className="save-button" disabled={!ready || saving || soundAssetOperation} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button></footer>
  </main>;
}
