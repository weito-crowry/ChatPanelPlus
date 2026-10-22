import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  resolveDefaultUI,
  type ButtonGroupId,
  type ButtonId,
  type CustomButtonDefinition,
  type CustomButtonId,
  type TabId,
} from '../../src/shared/default-ui';
import { createChromeSettingsRepository } from '../../src/shared/settings-repository';
import { DEFAULT_COMPLETION_SOUND_ID } from '../../src/shared/answer-completion-sound-definitions.ts';
import { DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT } from '../../src/shared/answer-completion-sound-volume.ts';
import { CustomButtonCreator } from './CustomButtonCreator';
import { AnswerCompletionSoundSettings } from './AnswerCompletionSoundSettings';
import { prepareSoundAssetDeletion } from './answer-completion-sound-actions.ts';
import {
  changeCustomButtonOperation,
  createCustomButton,
  deleteCustomButton,
  getCustomButtonImportDeletions,
  getLayoutPreview,
  getOptionsGroups,
  mergeImportedSettings,
  moveButtonOrder,
  moveTabOrder,
  reorderButtonBefore,
  reorderTabBefore,
  resetSettingsPreservingCustomButtons,
  updateCustomButton,
} from './options-state';
import {
  DEFAULT_SETTINGS,
  parseSettingsJson,
  serializeSettings,
  validateExtensionSettings,
  type ExtensionSettings,
} from '../../src/shared/settings';

type ImportPreview = Readonly<{
  settings: ExtensionSettings;
  savedCustomCount: number;
  importedCustomCount: number;
  deletionIds: readonly CustomButtonId[];
  legacy: boolean;
}>;

function expandHex(color: string): string {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color;
}

export function OptionsPage() {
  const repository = useMemo(() => createChromeSettingsRepository(), []);
  const [base, setBase] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetViewOnSave, setResetViewOnSave] = useState(false);
  const [replaceKnownFieldsOnSave, setReplaceKnownFieldsOnSave] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [status, setStatus] = useState('設定を読み込んでいます。');

  async function reload() {
    const result = await repository.loadSettings();
    if (!result.ok) {
      setReady(false);
      setStatus(result.reason === 'corrupt-settings'
        ? '保存済み設定が破損しているか未対応です。既存値を保護するため保存を停止しました。'
        : '設定を読み込めませんでした。既定値で表示していますが保存は停止しました。');
      return;
    }
    setBase(result.settings);
    setDraft(result.settings);
    setReady(true);
    setResetViewOnSave(false);
    setReplaceKnownFieldsOnSave(false);
    setStatus('保存済み設定を読み込みました。');
  }

  useEffect(() => {
    void reload();
  }, [repository]);

  function updateButton(id: ButtonId, field: 'visible' | 'label' | 'color' | 'text', value: boolean | string) {
    setDraft((current) => {
      const overrides = { ...(current.buttonOverrides ?? {}) };
      overrides[id] = { ...(overrides[id] ?? {}), [field]: value };
      return { ...current, buttonOverrides: overrides };
    });
    setStatus('未保存の変更があります。');
  }

  function addCustomButton(definition: CustomButtonDefinition) {
    const id = `custom-${crypto.randomUUID()}` as CustomButtonId;
    setDraft((current) => createCustomButton(current, id, definition));
    setStatus('カスタムボタンをドラフトに追加しました。保存後にパネルへ反映されます。');
  }

  function editCustomButton(id: CustomButtonId, field: 'visible' | 'label' | 'color' | 'text', value: boolean | string) {
    setDraft((current) => updateCustomButton(current, id, field, value));
    setStatus('未保存の変更があります。');
  }

  function editCustomButtonOperation(id: CustomButtonId, operation: 'insert' | 'insert-jst' | 'paste' | 'clear') {
    setDraft((current) => changeCustomButtonOperation(current, id, operation));
    setStatus('未保存の変更があります。');
  }

  function removeCustomButton(id: CustomButtonId, label: string) {
    if (!window.confirm(`「${label}」を削除しますか？削除はドラフトに適用され、保存後の復元にはJSONバックアップが必要です。`)) return;
    setDraft((current) => deleteCustomButton(current, id));
    setStatus('削除をドラフトに適用しました。保存するまでパネルには反映されません。');
  }

  function updateTab(id: TabId, visible: boolean) {
    setDraft((current) => ({
      ...current,
      tabOverrides: { ...(current.tabOverrides ?? {}), [id]: { ...(current.tabOverrides?.[id] ?? {}), visible } },
    }));
    setStatus('未保存の変更があります。');
  }

  function updateAnswerCompletionSound(enabled: boolean) {
    setDraft((current) => ({ ...current, answerCompletionSoundEnabled: enabled }));
    setStatus('未保存の変更があります。');
  }

  function updateAnswerCompletionSoundId(soundId: string) {
    setDraft((current) => ({ ...current, answerCompletionSoundId: soundId }));
    setStatus('未保存の変更があります。');
  }

  function updateAnswerCompletionSoundVolume(volumePercent: number) {
    setDraft((current) => ({ ...current, answerCompletionSoundVolumePercent: volumePercent }));
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
    setDraft((current) => current.answerCompletionSoundId === soundId
      ? { ...current, answerCompletionSoundId: DEFAULT_COMPLETION_SOUND_ID }
      : current);
    return true;
  }

  function moveButton(group: ButtonGroupId, id: ButtonId, delta: -1 | 1) {
    setDraft((current) => moveButtonOrder(current, group, id, delta));
    setStatus('未保存の変更があります。');
  }

  function moveTab(id: TabId, delta: -1 | 1) {
    setDraft((current) => moveTabOrder(current, id, delta));
    setStatus('未保存の変更があります。');
  }

  function startButtonDrag(event: DragEvent<HTMLButtonElement>, group: ButtonGroupId, id: ButtonId) {
    event.dataTransfer.setData('application/x-chatpanelplus-button', JSON.stringify({ group, id }));
    event.dataTransfer.effectAllowed = 'move';
  }

  function dropButton(event: DragEvent<HTMLElement>, group: ButtonGroupId, targetId: ButtonId) {
    if (!Array.from(event.dataTransfer.types).includes('application/x-chatpanelplus-button')) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-chatpanelplus-button')) as {
        group?: unknown;
        id?: unknown;
      };
      if (source.group !== group || typeof source.id !== 'string') return;
      setDraft((current) => reorderButtonBefore(current, group, source.id as ButtonId, targetId));
      setStatus('未保存の変更があります。');
    } catch {
      // Other drag sources and malformed transfer data are ignored.
    }
  }

  function startTabDrag(event: DragEvent<HTMLButtonElement>, id: TabId) {
    event.dataTransfer.setData('application/x-chatpanelplus-tab', id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function dropTab(event: DragEvent<HTMLElement>, targetId: TabId) {
    if (!Array.from(event.dataTransfer.types).includes('application/x-chatpanelplus-tab')) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData('application/x-chatpanelplus-tab');
    if (!sourceId) return;
    setDraft((current) => reorderTabBefore(current, sourceId as TabId, targetId));
    setStatus('未保存の変更があります。');
  }

  async function save() {
    if (!ready || saving) return;
    const validated = validateExtensionSettings(draft);
    if (!validated.ok) {
      setStatus('設定に不正な値があります。色は #RGB または #RRGGBB で入力してください。');
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
      setStatus(result.reason === 'conflict'
        ? '別のOptions画面で同じ項目が変更されました。再読み込みして変更を確認してください。'
        : result.reason === 'corrupt-settings'
          ? '保存済み設定が破損しているため上書きできません。'
          : result.reason === 'storage-failed'
            ? '保存に失敗しました。ドラフトは保持されています。'
            : '設定を検証できませんでした。ドラフトは保持されています。');
      return;
    }
    setBase(result.settings);
    setDraft(result.settings);
    setResetViewOnSave(false);
    setReplaceKnownFieldsOnSave(false);
    setStatus('設定を保存しました。');
  }

  function exportSettings() {
    const blob = new Blob([serializeSettings(draft)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chatpanelplus-settings.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function inspectImport(file?: File) {
    setImportPreview(null);
    if (!file) return;
    let json: string;
    try {
      json = await file.text();
    } catch {
      setStatus('ファイルを読み込めませんでした。保存済み設定は変更されていません。');
      return;
    }
    const parsed = parseSettingsJson(json);
    if (!parsed.ok) {
      setStatus(parsed.reason === 'unsupported-schema'
        ? '未対応の設定schemaです。保存済み設定は変更されていません。'
        : 'JSONまたは設定値が不正です。保存済み設定は変更されていません。');
      return;
    }
    const legacy = !Object.prototype.hasOwnProperty.call(parsed.settings, 'customButtons');
    const imported = mergeImportedSettings(parsed.settings, base);
    setImportPreview({
      settings: imported,
      savedCustomCount: Object.keys(base.customButtons ?? {}).length,
      importedCustomCount: Object.keys(imported.customButtons ?? {}).length,
      deletionIds: getCustomButtonImportDeletions(base, parsed.settings),
      legacy,
    });
    setStatus('読込内容を確認し、ドラフトへ適用してください。');
  }

  const resolved = resolveDefaultUI(draft);
  const buttonGroups = getOptionsGroups(draft);
  const preview = getLayoutPreview(draft);
  const previewTab = preview.tabs[0];

  return (
    <main className="options-page">
      <header className="page-header">
        <p className="product-name">ChatPanelPlus</p>
        <h1>設定</h1>
        <p>ボタンとタブの表示・順序・ラベル・色・定型文を編集します。</p>
      </header>

      <p className="settings-status" role="status">{status}</p>

      <section className="layout-preview" aria-labelledby="layout-preview-title">
        <h2 id="layout-preview-title">パネルプレビュー</h2>
        <div className="panel-preview">
          <div className="panel-preview-row" aria-label="常時表示ボタン">
            {preview.alwaysButtons.map((button) => (
              <span key={button.id} className="panel-preview-button" style={{ backgroundColor: button.color }}>{button.label}</span>
            ))}
          </div>
          {preview.tabs.length > 0 ? (
            <>
              <div className="panel-preview-tabs" aria-label="表示中のタブ">
                {preview.tabs.map((tab, index) => <span key={tab.id} className={index === 0 ? 'panel-preview-tab active' : 'panel-preview-tab'}>{tab.label}</span>)}
              </div>
              <div className="panel-preview-row" aria-label={`${previewTab?.label ?? ''}のボタン`}>
                {previewTab?.buttons.map((button) => (
                  <span key={button.id} className="panel-preview-button" style={{ backgroundColor: button.color }}>{button.label}</span>
                ))}
              </div>
            </>
          ) : <p className="panel-preview-empty">表示中のタブはありません。</p>}
        </div>
        <p className="preview-note">プレビューはドラフトに反映されます。パネルへの適用は保存後です。</p>
      </section>

      <fieldset className="settings-editor" disabled={!ready || saving}>
        {buttonGroups.map((group) => (
          <section
            key={group.id}
            className="settings-card"
            aria-labelledby={`group-${group.id}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => group.id === 'always' ? undefined : dropTab(event, group.id)}
          >
            <h2 id={`group-${group.id}`}>{group.label}</h2>
            {group.id !== 'always' && (() => {
              const tab = resolved.tabs.find(({ id }) => id === group.id)!;
              return (
                <label className="tab-visibility">
                  <input type="checkbox" checked={tab.visible} onChange={(event) => updateTab(tab.id, event.currentTarget.checked)} />
                  このタブを表示
                  <span className="row-order">
                    <button type="button" aria-label={`${tab.label}を上へ`} onClick={() => moveTab(tab.id, -1)}>上へ</button>
                    <button type="button" aria-label={`${tab.label}を下へ`} onClick={() => moveTab(tab.id, 1)}>下へ</button>
                    <button type="button" className="drag-handle" draggable={ready && !saving} aria-label={`${tab.label}をドラッグして並べ替え`} title="ドラッグして並べ替え" onDragStart={(event) => startTabDrag(event, tab.id)}>⠿</button>
                  </span>
                </label>
              );
            })()}
            <div className="button-settings-list">
              {resolved.buttons.filter((button) => button.groupId === group.id).map((button) => (
                (() => {
                  const customId = button.id.startsWith('custom-') ? button.id as CustomButtonId : null;
                  const custom = customId ? draft.customButtons?.[customId] : undefined;
                  const override = customId ? undefined : draft.buttonOverrides?.[button.id];
                  const label = custom?.label ?? (typeof override?.label === 'string' ? override.label : button.label);
                  const color = custom?.color ?? (typeof override?.color === 'string' ? override.color : button.color);
                  const text = custom?.kind === 'insert'
                    ? custom.text
                    : typeof override?.text === 'string' ? override.text : button.text ?? '';
                  const edit = (field: 'visible' | 'label' | 'color' | 'text', value: boolean | string) => {
                    if (customId) editCustomButton(customId, field, value);
                    else updateButton(button.id, field, value);
                  };
                  return <article
                    className="button-settings"
                    key={button.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropButton(event, group.id, button.id)}
                  >
                  <div className="button-settings-heading">
                    <strong>{button.id}</strong>
                    <label>
                      <input type="checkbox" checked={button.visible} onChange={(event) => edit('visible', event.currentTarget.checked)} />
                      表示
                    </label>
                    <span className="row-order">
                      <button type="button" aria-label={`${label}を上へ`} onClick={() => moveButton(group.id, button.id, -1)}>上へ</button>
                      <button type="button" aria-label={`${label}を下へ`} onClick={() => moveButton(group.id, button.id, 1)}>下へ</button>
                      <button type="button" className="drag-handle" draggable={ready && !saving} aria-label={`${label}をドラッグして並べ替え`} title="ドラッグして並べ替え" onDragStart={(event) => startButtonDrag(event, group.id, button.id)}>⠿</button>
                    </span>
                  </div>
                  <label className="field-label">
                    ボタン名
                    <input type="text" value={label} onChange={(event) => edit('label', event.currentTarget.value)} />
                  </label>
                  <label className="field-label color-field">
                    ボタン色
                    <input type="color" value={expandHex(/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color) ? color : button.color)} onChange={(event) => edit('color', event.currentTarget.value)} />
                    <input type="text" aria-label={`${label}の色HEX値`} value={color} onChange={(event) => edit('color', event.currentTarget.value)} />
                  </label>
                  {customId && custom && (
                    <>
                      <label className="field-label">
                        操作種別
                        <select value={custom.kind === 'insert' ? 'insert' : custom.action} onChange={(event) => editCustomButtonOperation(customId, event.currentTarget.value as 'insert' | 'insert-jst' | 'paste' | 'clear')}>
                          <option value="insert">定型文を挿入</option>
                          <option value="insert-jst">現在時刻を挿入</option>
                          <option value="paste">クリップボードを貼り付け</option>
                          <option value="clear">入力欄をクリア</option>
                        </select>
                      </label>
                      <button type="button" className="delete-custom-button" onClick={() => removeCustomButton(customId, label)}>このカスタムボタンを削除</button>
                    </>
                  )}
                  {button.kind === 'insert' && (
                    <label className="field-label">
                      定型文
                      <textarea
                        rows={Math.min(8, Math.max(3, text.split('\n').length))}
                        value={text}
                        onChange={(event) => edit('text', event.currentTarget.value)}
                      />
                    </label>
                  )}
                </article>
                })()
              ))}
            </div>
            <CustomButtonCreator groupId={group.id} onAdd={addCustomButton} />
          </section>
        ))}
        <AnswerCompletionSoundSettings
          selectedSoundId={draft.answerCompletionSoundId ?? DEFAULT_COMPLETION_SOUND_ID}
          enabled={draft.answerCompletionSoundEnabled === true}
          volumePercent={draft.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT}
          disabled={!ready || saving}
          onSelect={updateAnswerCompletionSoundId}
          onToggleEnabled={updateAnswerCompletionSound}
          onVolumeChange={updateAnswerCompletionSoundVolume}
          onBeforeDelete={prepareAnswerCompletionSoundDeletion}
        />
      </fieldset>

      <section className="settings-card layout-actions" aria-labelledby="layout-actions-title">
        <h2 id="layout-actions-title">レイアウトとファイル</h2>
        <p>リセットとインポートはドラフトへ反映し、「保存」後に適用されます。</p>
        <div className="layout-buttons">
          <button type="button" disabled={!ready || saving} onClick={() => {
            if (!window.confirm('ボタンとタブの設定を既定値へ戻す変更をドラフトに適用しますか？保存するまで反映されません。')) return;
            setDraft((current) => resetSettingsPreservingCustomButtons(current));
            setResetViewOnSave(true);
            setReplaceKnownFieldsOnSave(true);
            setStatus('既定値への変更をドラフトに適用しました。保存すると確定します。');
          }}>既定値に戻す</button>
          <button type="button" disabled={!ready || saving} onClick={exportSettings}>JSONを書き出す</button>
          <label className="import-picker">
            JSONを読み込む
            <input type="file" accept="application/json,.json" disabled={!ready || saving} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void inspectImport(file);
            }} />
          </label>
        </div>
        {importPreview && (
          <div className="import-preview" aria-label="インポートプレビュー">
            <p>schemaVersion {importPreview.settings.schemaVersion}、ボタン{resolveDefaultUI(importPreview.settings).buttons.length}個、タブ{resolveDefaultUI(importPreview.settings).tabs.length}個の設定です。</p>
            <p>保存済みカスタムボタン: {importPreview.savedCustomCount}個 / 適用後: {importPreview.importedCustomCount}個{importPreview.legacy ? '（旧JSONのため保存済み定義を保持）' : ''}</p>
            {importPreview.deletionIds.length > 0 && (
              <div>
                <p>削除予定ID（適用前に確認します）:</p>
                <ul>{importPreview.deletionIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
              </div>
            )}
            <button type="button" disabled={!ready || saving} onClick={() => {
              if (importPreview.deletionIds.length > 0 && !window.confirm(`JSONの適用でカスタムボタンを削除します。保存後の復元にはJSONバックアップが必要です。\n\n${importPreview.deletionIds.join('\n')}\n\nドラフトに適用しますか？`)) {
                setStatus('インポートの適用を取り消しました。編集中のドラフトは変更されていません。');
                return;
              }
              setDraft(importPreview.settings);
              setResetViewOnSave(false);
              setReplaceKnownFieldsOnSave(true);
              setImportPreview(null);
              setStatus('インポート設定をドラフトへ適用しました。保存するまで反映されません。');
            }}>この設定をドラフトに適用</button>
          </div>
        )}
      </section>

      <footer className="save-bar">
        <button type="button" disabled={!ready || saving} onClick={() => void reload()}>保存値を再読み込み</button>
        <button type="button" className="save-button" disabled={!ready || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
      </footer>
    </main>
  );
}
