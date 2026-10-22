import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPanel } from './Panel';
import { findActiveEditor, type EditorEnvironment } from './editor/adapter';
import { startInteractionDiagnostics } from './interaction-debug';
import { startPanelLifecycle, type PlacementTarget } from './lifecycle';
import panelStyles from './panel.css?inline';

const HOST_ID = 'chatpanelplus-extension-root';

// Add ?cppDebugInteraction=1 to opt into event metadata logging without suppressing actions.
startInteractionDiagnostics(window.location.search, document);

startPanelLifecycle({
  document,
  window,
  findTarget(): PlacementTarget | null {
    const editorEnvironment: EditorEnvironment = {
      document,
      isVisible(editor) {
        if (!editor.isConnected || editor.hidden || editor.getAttribute('aria-hidden') === 'true') return false;
        if (typeof editor.checkVisibility === 'function' && !editor.checkVisibility()) return false;
        return editor.getClientRects().length > 0;
      },
    };
    const form = findActiveEditor(editorEnvironment)?.closest('form');
    return form?.parentNode
      ? { parent: form.parentNode as Node & ParentNode, before: form }
      : null;
  },
  createHost() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-label', 'ChatPanelPlus');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelStyles;
    const appRoot = document.createElement('div');
    shadowRoot.append(style, appRoot);
    createRoot(appRoot).render(
      <StrictMode>
        <ChatPanel />
      </StrictMode>,
    );
    return host;
  },
  observe(callback) {
    const observer = new MutationObserver(callback);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    return observer;
  },
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: (id) => window.clearInterval(id),
});
