import { useEffect, useState, type DragEvent } from 'react';
import type { ButtonGroupId, TabId } from '../../src/shared/default-ui';

type Props = Readonly<{
  id: TabId;
  label: string;
  visible: boolean;
  custom: boolean;
  destinations: readonly { id: ButtonGroupId; label: string }[];
  onRename: (id: TabId, label: string) => void;
  onVisibility: (id: TabId, visible: boolean) => void;
  onMove: (id: TabId, delta: -1 | 1) => void;
  onDelete: (id: TabId, destination: ButtonGroupId) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, id: TabId) => void;
}>;

export function TabSettingsEditor(props: Props) {
  const [destination, setDestination] = useState<ButtonGroupId>('always');
  const [name, setName] = useState(props.label);
  useEffect(() => setName(props.label), [props.label]);
  const currentDestination = props.destinations.some(({ id }) => id === destination && id !== props.id)
    ? destination : 'always';
  return (
    <>
      <label className="field-label">
        タブ名
        <input type="text" maxLength={40} value={name} onChange={(event) => setName(event.currentTarget.value)} onBlur={() => {
          const normalized = name.trim();
          if (normalized.length >= 1 && normalized.length <= 40) props.onRename(props.id, normalized);
          else setName(props.label);
        }} />
      </label>
      <label className="tab-visibility">
        <input type="checkbox" checked={props.visible} onChange={(event) => props.onVisibility(props.id, event.currentTarget.checked)} />
        このタブを表示
        <span className="row-order">
          <button type="button" aria-label={`${props.label}を上へ`} onClick={() => props.onMove(props.id, -1)}>上へ</button>
          <button type="button" aria-label={`${props.label}を下へ`} onClick={() => props.onMove(props.id, 1)}>下へ</button>
          <button type="button" className="drag-handle" draggable aria-label={`${props.label}をドラッグして並べ替え`} title="ドラッグして並べ替え" onDragStart={(event) => props.onDragStart(event, props.id)}>⠿</button>
        </span>
      </label>
      {props.custom && (
        <div className="tab-delete-controls">
          <label className="field-label">
            削除後のボタン移動先
            <select value={currentDestination} onChange={(event) => setDestination(event.currentTarget.value as ButtonGroupId)}>
              {props.destinations.filter(({ id }) => id !== props.id).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <button type="button" className="delete-custom-button" onClick={() => props.onDelete(props.id, currentDestination)}>このタブを削除</button>
        </div>
      )}
    </>
  );
}
