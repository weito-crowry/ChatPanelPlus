import type { OptionsSectionId } from './options-v2-state.ts';

const ITEMS: readonly Readonly<{ id: OptionsSectionId; label: string }>[] = [
  { id: 'panel', label: 'パネル編集' }, { id: 'connection', label: '接続設定' },
  { id: 'projects', label: 'プロジェクト' }, { id: 'audio', label: '通知・音声' },
  { id: 'auto-reflect', label: '自動反映' }, { id: 'data', label: 'データ管理' },
];

type Props = Readonly<{ active: OptionsSectionId; onNavigate: (id: OptionsSectionId) => void }>;
export function OptionsNavigation({ active, onNavigate }: Props) {
  return <nav className="options-navigation" aria-label="目次">
    <h2>目次</h2>
    <ul>{ITEMS.map(({ id, label }) => <li key={id}>
      <a href={`#${id}`} aria-current={active === id ? 'page' : undefined} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate(id);
      }}>{label}</a>
    </li>)}</ul>
  </nav>;
}
