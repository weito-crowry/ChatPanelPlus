import type { ResolvedButton } from '../shared/default-ui.ts';

export type PanelButtonActionHandlers = Readonly<{
  insert: (text: string) => void;
  insertJst: () => void;
  paste: () => void;
  clear: () => void;
}>;

export function dispatchPanelButton(button: ResolvedButton, handlers: PanelButtonActionHandlers): void {
  if (button.kind === 'insert') {
    handlers.insert(button.text ?? '');
    return;
  }
  if (button.action === 'insert-jst') handlers.insertJst();
  else if (button.action === 'paste') handlers.paste();
  else if (button.action === 'clear') handlers.clear();
}
