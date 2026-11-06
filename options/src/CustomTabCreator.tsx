import { useState, type FormEvent } from 'react';

type Props = Readonly<{ onAdd: (label: string) => void }>;

export function CustomTabCreator({ onAdd }: Props) {
  const [label, setLabel] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAdd(label);
    setLabel('');
  }
  return (
    <form className="custom-tab-creator" onSubmit={submit}>
      <label className="field-label">
        新しいタブ名
        <input type="text" maxLength={40} value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
      </label>
      <button type="submit" disabled={!label.trim() || label.trim().length > 40}>タブを追加</button>
    </form>
  );
}
