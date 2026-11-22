import { useEffect, useMemo, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import {
  resolveDefaultUI, type ButtonGroupId, type ButtonId, type CustomButtonDefinition,
  type CustomButtonId, type InsertionMode, type TabId,
} from '../../src/shared/default-ui.ts';
import type { ExtensionSettings } from '../../src/shared/settings.ts';
import { CustomButtonCreator } from './CustomButtonCreator';
import { OptionsTabControls } from './OptionsTabControls';
import { getEditorGroupFallback } from './options-v2-state.ts';
import {
  changeCustomButtonOperation, createCustomButton, deleteCustomButton, getLayoutPreview, getOptionsGroups,
  moveButtonOrder, moveTabOrder, reorderButtonBefore, reorderTabBefore, updateCustomButton,
  updateCustomTabLabel, updateTabVisibility,
} from './options-state';

type Props = Readonly<{ draft: ExtensionSettings; setDraft: Dispatch<SetStateAction<ExtensionSettings>>;
  ready: boolean; saving: boolean; status: (message: string) => void }>;

function expandHex(color: string): string {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color;
}

export function OptionsPanelEditor({ draft, setDraft, ready, saving, status }: Props) {
  const groups = getOptionsGroups(draft);
  const resolved = resolveDefaultUI(draft);
  const visibleGroups = groups.filter((group) => group.id === 'always' || resolved.tabs.some((tab) => tab.id === group.id && tab.visible));
  const [selectedGroup, setSelectedGroup] = useState<ButtonGroupId>('always');
  const selectedFallback = getEditorGroupFallback(selectedGroup, visibleGroups);
  useEffect(() => { if (selectedFallback !== selectedGroup) setSelectedGroup(selectedFallback as ButtonGroupId); }, [selectedFallback, selectedGroup]);
  const preview = useMemo(() => getLayoutPreview(draft), [draft]);
  const previewTab = preview.tabs.find((tab) => tab.id === selectedGroup);

  function updateButton(id: ButtonId, field: 'visible' | 'label' | 'color' | 'text', value: boolean | string) {
    setDraft((current) => ({ ...current, buttonOverrides: {
      ...(current.buttonOverrides ?? {}), [id]: { ...(current.buttonOverrides?.[id] ?? {}), [field]: value },
    } })); status('未保存の変更があります。');
  }
  function addButton(definition: CustomButtonDefinition) {
    setDraft((current) => createCustomButton(current, `custom-${crypto.randomUUID()}` as CustomButtonId, definition));
    status('カスタムボタンをドラフトに追加しました。保存後にパネルへ反映されます。');
  }
  function editCustom(id: CustomButtonId, field: 'visible' | 'label' | 'color' | 'text' | 'insertionMode', value: boolean | string) {
    setDraft((current) => updateCustomButton(current, id, field, value)); status('未保存の変更があります。');
  }
  function removeCustom(id: CustomButtonId, label: string) {
    if (!window.confirm(`「${label}」を削除しますか？削除はドラフトに適用され、保存後の復元にはJSONバックアップが必要です。`)) return;
    setDraft((current) => deleteCustomButton(current, id)); status('削除をドラフトに適用しました。');
  }
  function dragButton(event: DragEvent<HTMLButtonElement>, group: ButtonGroupId, id: ButtonId) {
    event.dataTransfer.setData('application/x-chatpanelplus-button', JSON.stringify({ group, id })); event.dataTransfer.effectAllowed = 'move';
  }
  function dropButton(event: DragEvent<HTMLElement>, group: ButtonGroupId, target: ButtonId) {
    if (!Array.from(event.dataTransfer.types).includes('application/x-chatpanelplus-button')) return;
    event.preventDefault(); event.stopPropagation();
    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-chatpanelplus-button')) as { group?: unknown; id?: unknown };
      if (source.group !== group || typeof source.id !== 'string') return;
      setDraft((current) => reorderButtonBefore(current, group, source.id as ButtonId, target)); status('未保存の変更があります。');
    } catch { /* Ignore other drag sources. */ }
  }
  function dropTab(event: DragEvent<HTMLElement>, target: TabId) {
    if (!Array.from(event.dataTransfer.types).includes('application/x-chatpanelplus-tab')) return;
    event.preventDefault(); event.stopPropagation();
    const source = event.dataTransfer.getData('application/x-chatpanelplus-tab');
    if (source) { setDraft((current) => reorderTabBefore(current, source as TabId, target)); status('未保存の変更があります。'); }
  }

  return <div className="panel-editor-layout">
    <section className="layout-preview" aria-labelledby="layout-preview-title">
      <h2 id="layout-preview-title">パネルプレビュー</h2>
      <div className="panel-preview">
        <div className="panel-preview-row" aria-label="常時表示ボタン">{preview.alwaysButtons.map((button) =>
          <span key={button.id} className="panel-preview-button" style={{ backgroundColor: button.color }}>{button.label}</span>)}</div>
        {preview.tabs.length ? <><div className="panel-preview-tabs" aria-label="表示中のタブ">{preview.tabs.map((tab, index) =>
          <span key={tab.id} className={tab.id === selectedGroup || (!previewTab && index === 0) ? 'panel-preview-tab active' : 'panel-preview-tab'}>{tab.label}</span>)}</div>
        {previewTab && <div className="panel-preview-row" aria-label={`${previewTab.label}のボタン`}>{previewTab.buttons.map((button) =>
          <span key={button.id} className="panel-preview-button" style={{ backgroundColor: button.color }}>{button.label}</span>)}</div>}</>
          : <p className="panel-preview-empty">表示中のタブはありません。</p>}
      </div><p className="preview-note">プレビューはドラフトに反映されます。パネルへの適用は保存後です。</p>
    </section>
    <section className="settings-card tab-order-card" aria-labelledby="tab-order-title">
      <h2 id="tab-order-title">タブの表示と順序</h2>
      {resolved.tabs.map((tab) => <div key={tab.id} className="tab-order-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropTab(event, tab.id)}>
        <div draggable={false} onDragOver={(event) => event.preventDefault()}>
          <OptionsTabControls tab={tab} ready={ready} saving={saving}
            onVisibilityChange={(id, visible) => { setDraft((current) => updateTabVisibility(current, id, visible)); status('未保存の変更があります。'); }}
            onMove={(id, delta) => { setDraft((current) => moveTabOrder(current, id, delta)); status('未保存の変更があります。'); }}
            onDragStart={(event, id) => { event.dataTransfer.setData('application/x-chatpanelplus-tab', id); event.dataTransfer.effectAllowed = 'move'; }}
            onLabelChange={(id, label) => { setDraft((current) => updateCustomTabLabel(current, id, label)); status('未保存の変更があります。'); }} />
        </div>
      </div>)}
    </section>
    <fieldset className="settings-editor selected-group-editor" disabled={!ready || saving}>
      <label className="group-picker">編集するグループ
        <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.currentTarget.value as ButtonGroupId)}>
          {visibleGroups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
        </select>
      </label>
      {groups.map((group) => <section key={group.id} className="settings-card" hidden={group.id !== selectedGroup}
        aria-labelledby={`group-${group.id}`} onDragOver={(event) => event.preventDefault()}>
        <h2 id={`group-${group.id}`}>{group.label}</h2>
        <div className="button-settings-list">
          {resolved.buttons.filter((button) => button.groupId === group.id).map((button) => {
            const customId = button.id.startsWith('custom-') ? button.id as CustomButtonId : null;
            const custom = customId ? draft.customButtons?.[customId] : undefined;
            const override = customId ? undefined : draft.buttonOverrides?.[button.id];
            const label = custom?.label ?? (typeof override?.label === 'string' ? override.label : button.label);
            const color = custom?.color ?? (typeof override?.color === 'string' ? override.color : button.color);
            const text = custom?.kind === 'insert' ? custom.text : typeof override?.text === 'string' ? override.text : button.text ?? '';
            const edit = (field: 'visible' | 'label' | 'color' | 'text' | 'insertionMode', value: boolean | string) => {
              if (customId) editCustom(customId, field, value); else if (field !== 'insertionMode') updateButton(button.id, field, value);
            };
            return <article className="button-settings" key={button.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropButton(event, group.id, button.id)}>
              <div className="button-settings-heading"><strong>{button.id}</strong><label><input type="checkbox" checked={button.visible}
                onChange={(event) => edit('visible', event.currentTarget.checked)} />表示</label>
                <span className="row-order"><button type="button" aria-label={`${label}を上へ`} onClick={() => { setDraft((current) => moveButtonOrder(current, group.id, button.id, -1)); status('未保存の変更があります。'); }}>上へ</button>
                  <button type="button" aria-label={`${label}を下へ`} onClick={() => { setDraft((current) => moveButtonOrder(current, group.id, button.id, 1)); status('未保存の変更があります。'); }}>下へ</button>
                  <button type="button" className="drag-handle" draggable={ready && !saving} aria-label={`${label}をドラッグして並べ替え`} title="ドラッグして並べ替え" onDragStart={(event) => dragButton(event, group.id, button.id)}>⠿</button></span>
              </div>
              <label className="field-label">ボタン名<input type="text" value={label} onChange={(event) => edit('label', event.currentTarget.value)} /></label>
              <label className="field-label color-field">ボタン色<input type="color" value={expandHex(/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color) ? color : button.color)} onChange={(event) => edit('color', event.currentTarget.value)} />
                <input type="text" aria-label={`${label}の色HEX値`} value={color} onChange={(event) => edit('color', event.currentTarget.value)} /></label>
              {customId && custom && <>
                <label className="field-label">操作種別<select value={custom.kind === 'insert' ? 'insert' : custom.action}
                  onChange={(event) => changeOperation(customId, event.currentTarget.value as 'insert' | 'insert-jst' | 'paste' | 'clear')}>
                  <option value="insert">定型文を挿入</option><option value="insert-jst">現在時刻を挿入</option>
                  <option value="paste">クリップボードを貼り付け</option><option value="clear">入力欄をクリア</option>
                </select></label>
                {custom.kind === 'insert' && <label className="field-label">挿入位置<select value={custom.insertionMode ?? 'beginning'} onChange={(event) => editCustom(customId, 'insertionMode', event.currentTarget.value as InsertionMode)}>
                  <option value="beginning">先頭に挿入</option><option value="caret">カーソル位置に挿入</option></select></label>}
                <button type="button" className="delete-custom-button" onClick={() => removeCustom(customId, label)}>このカスタムボタンを削除</button>
              </>}
              {button.kind === 'insert' && <label className="field-label">定型文<textarea rows={Math.min(8, Math.max(3, text.split('\n').length))} value={text}
                onChange={(event) => edit('text', event.currentTarget.value)} /></label>}
            </article>;
          })}
        </div><CustomButtonCreator groupId={group.id} onAdd={addButton} />
      </section>)}
    </fieldset>
  </div>;

  function changeOperation(id: CustomButtonId, operation: 'insert' | 'insert-jst' | 'paste' | 'clear') {
    setDraft((current) => changeCustomButtonOperation(current, id, operation)); status('未保存の変更があります。');
  }
}
