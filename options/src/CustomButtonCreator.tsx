import { useRef, useState, type FormEvent } from 'react';
import type { ButtonGroupId, CustomButtonDefinition } from '../../src/shared/default-ui';
import type { CustomButtonOperation } from './options-state';

type Props = Readonly<{
  groupId: ButtonGroupId;
  onAdd: (definition: CustomButtonDefinition) => void;
}>;

const operationDefaults: Record<CustomButtonOperation, Readonly<{ label: string; color: string }>> = {
  insert: { label: '定型文', color: '#6e5adb' },
  'insert-jst': { label: '現在時刻', color: '#5a9edc' },
  paste: { label: 'コピペ', color: '#2ca24c' },
  clear: { label: 'クリア', color: '#888' },
};

function colorPickerValue(color: string, fallback: string): string {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[\da-f]{6}$/i.test(color) ? color : fallback;
}

export function CustomButtonCreator({ groupId, onAdd }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [operation, setOperation] = useState<CustomButtonOperation>('insert');
  const [label, setLabel] = useState(operationDefaults.insert.label);
  const [color, setColor] = useState(operationDefaults.insert.color);
  const [text, setText] = useState('');

  function changeOperation(next: CustomButtonOperation) {
    setOperation(next);
    setLabel(operationDefaults[next].label);
    setColor(operationDefaults[next].color);
    setText('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = { groupId, label, color, visible: true };
    const definition: CustomButtonDefinition = operation === 'insert'
      ? { ...common, kind: 'insert', text }
      : { ...common, kind: 'action', action: operation };
    onAdd(definition);
    const defaults = operationDefaults.insert;
    setOperation('insert');
    setLabel(defaults.label);
    setColor(defaults.color);
    setText('');
    if (detailsRef.current) detailsRef.current.open = false;
  }

  function cancel() {
    setOperation('insert');
    setLabel(operationDefaults.insert.label);
    setColor(operationDefaults.insert.color);
    setText('');
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details ref={detailsRef} className="custom-button-creator">
      <summary>ボタンを追加</summary>
      <form onSubmit={submit}>
        <label className="field-label">
          操作種別
          <select value={operation} onChange={(event) => changeOperation(event.currentTarget.value as CustomButtonOperation)}>
            <option value="insert">定型文を挿入</option>
            <option value="insert-jst">現在時刻を挿入</option>
            <option value="paste">クリップボードを貼り付け</option>
            <option value="clear">入力欄をクリア</option>
          </select>
        </label>
        <label className="field-label">
          ボタン名
          <input type="text" value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
        </label>
        <label className="field-label color-field">
          ボタン色
          <input type="color" value={colorPickerValue(color, operationDefaults[operation].color)} onChange={(event) => setColor(event.currentTarget.value)} />
          <input type="text" aria-label="追加ボタンの色HEX値" value={color} onChange={(event) => setColor(event.currentTarget.value)} />
        </label>
        {operation === 'insert' && (
          <label className="field-label">
            定型文
            <textarea rows={3} value={text} onChange={(event) => setText(event.currentTarget.value)} />
          </label>
        )}
        <button type="submit">このグループに追加</button>
        <button type="button" onClick={cancel}>取り消す</button>
      </form>
    </details>
  );
}

