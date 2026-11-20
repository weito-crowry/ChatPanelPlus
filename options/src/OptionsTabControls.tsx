import type { DragEvent } from 'react';
import type { CustomTabId, ResolvedTab, TabId } from '../../src/shared/default-ui.ts';

type Props = Readonly<{
  tab: ResolvedTab;
  ready: boolean;
  saving: boolean;
  onVisibilityChange: (id: TabId, visible: boolean) => void;
  onMove: (id: TabId, delta: -1 | 1) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, id: TabId) => void;
  onLabelChange: (id: CustomTabId, label: string) => void;
}>;

export function OptionsTabControls({ tab, ready, saving, onVisibilityChange, onMove, onDragStart, onLabelChange }: Props) {
  return (
    <>
      <label className="tab-visibility">
        <input type="checkbox" checked={tab.visible} onChange={(event) => onVisibilityChange(tab.id, event.currentTarget.checked)} />
        このタブを表示
        <span className="row-order">
          <button type="button" aria-label={`${tab.label}を上へ`} onClick={() => onMove(tab.id, -1)}>上へ</button>
          <button type="button" aria-label={`${tab.label}を下へ`} onClick={() => onMove(tab.id, 1)}>下へ</button>
          <button type="button" className="drag-handle" draggable={ready && !saving} aria-label={`${tab.label}をドラッグして並べ替え`} title="ドラッグして並べ替え" onDragStart={(event) => onDragStart(event, tab.id)}>⠿</button>
        </span>
      </label>
      {tab.id.startsWith('custom-tab-') && (
        <label className="field-label">
          タブ名
          <input type="text" value={tab.label} onChange={(event) => onLabelChange(tab.id as CustomTabId, event.currentTarget.value)} />
        </label>
      )}
    </>
  );
}
