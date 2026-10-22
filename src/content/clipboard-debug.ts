import type { ClipboardPasteStrategy } from './clipboard-metrics.ts';

export function debugPasteStrategy(search: string): ClipboardPasteStrategy {
  const params = new URLSearchParams(search);
  if (params.get('cppDebugClipboard') !== '1') return 'execCommandPaste';
  const strategy = params.get('cppDebugPaste');
  return strategy === 'insertHTML' || strategy === 'execCommandPaste' ? strategy : 'insertText';
}
