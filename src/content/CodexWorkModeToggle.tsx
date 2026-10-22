import { useEffect, useRef, useState } from 'react';
import { CodexWorkModeController, type CodexWorkModeControllerState } from './codex-work-mode-controller.ts';
import { getCodexWorkModePresentation } from './codex-work-mode-presentation.ts';
import { createCodexWorkModeRouteObserver } from './codex-work-mode-route.ts';
import { createChromeCodexWorkModeRepository } from '../shared/codex-work-mode-repository.ts';

export function CodexWorkModeToggle({ minimized }: { readonly minimized: boolean }) {
  const controllerRef = useRef<CodexWorkModeController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CodexWorkModeController(
      createChromeCodexWorkModeRepository(),
      createCodexWorkModeRouteObserver(window),
    );
  }
  const controller = controllerRef.current;
  const [state, setState] = useState<CodexWorkModeControllerState>(controller.state);
  const presentation = getCodexWorkModePresentation(state, minimized);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  return (
    <div className={`codex-work-mode-control${minimized ? ' is-minimized' : ''}`}>
      <button
        type="button"
        className={`codex-work-mode-toggle${presentation.className ? ` ${presentation.className}` : ''}`}
        aria-label={presentation.ariaLabel}
        aria-pressed={presentation.ariaPressed}
        aria-busy={presentation.ariaBusy}
        title="手動表示です。Codexの実稼働状態とは連動しません。"
        disabled={presentation.disabled}
        onClick={() => {
          if (presentation.retryOnToggle) void controller.retry();
          else if (state.status === 'ready') void controller.toggle();
        }}
      >
        {presentation.label}
      </button>
      {presentation.message && (
        <div
          className="codex-work-mode-message"
          role={presentation.message.role}
          aria-live={presentation.message.role === 'alert' ? 'assertive' : 'polite'}
        >
          <p>{presentation.message.text}</p>
          {presentation.showInitialize && (
            <div className="codex-work-mode-actions">
              <button type="button" onClick={() => { void controller.initializeOff(); }}>OFFで初期化</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
