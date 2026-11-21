import { PanelView } from './PanelView';
import { usePanelController } from './usePanelController';

export function ChatPanel() {
  const controller = usePanelController();
  return <PanelView {...controller} />;
}
