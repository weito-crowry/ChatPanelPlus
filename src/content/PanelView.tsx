import { useCallback, useState } from 'react';
import { ConversationStatistics } from './ConversationStatistics';
import { CodexWorkModeToggle } from './CodexWorkModeToggle';
import { CodexBridgeList } from './CodexBridgeList';
import { ProjectPanelTitle } from './ProjectPanelTitle';
import { BridgeSummaryBar } from './BridgeSummaryBar';
import type { PanelControllerState } from './usePanelController';
import type { RunningThreadSummary } from './codexbridge-running-summary.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { projectIdFromPathname } from '../shared/project-route.ts';

const MIN_ICON_SVG = <svg className="panel-minimize-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
</svg>;

type BridgeConnection = Readonly<{ state: 'loading' | 'connected' | 'error'; targetId: string | null; targetName: string | null }>;

export function PanelView({
  model,
  currentViewState,
  activeTab,
  activeButtons,
  conversationId,
  bridgeExpanded,
  bridgeWatchSelection,
  bridgeEventSelection,
  conversationMuted,
  muteLoaded,
  mutePending,
  muteRevision,
  getConversationMuteSnapshot,
  error,
  answerCompletionSoundEnabled,
  answerCompletionSoundId,
  answerCompletionSoundVolumePercent,
  manualPasteOpen,
  manualPasteText,
  onButtonPointerDown,
  onButtonClick,
  onSelectTab,
  onToggleMinimized,
  onToggleBridgeExpanded,
  onSelectBridgeWatch,
  onSelectBridgeEvent,
  onToggleConversationMute,
  onOpenSettings,
  onManualPasteTextChange,
  onSubmitManualPaste,
  onCancelManualPaste,
}: PanelControllerState) {
  const [bridgeConnection, setBridgeConnection] = useState<BridgeConnection>({ state: 'loading', targetId: null, targetName: null });
  const [runningSummary, setRunningSummary] = useState<RunningThreadSummary>({ targetId: null, count: null, status: 'loading' });
  const [bridgeSummary, setBridgeSummary] = useState<Readonly<{
    conversationId: string;
    watchingCount: number;
    unacknowledgedThreadCount: number;
  }> | null>(null);
  const currentBridgeSummary = bridgeSummary?.conversationId === conversationId && conversationId
    && conversationIdFromPath(window.location.pathname) === conversationId ? bridgeSummary : null;
  const updateBridgeSummary = useCallback((summary: Readonly<{ watchingCount: number; unacknowledgedThreadCount: number }> | null) => {
    setBridgeSummary(summary && conversationId ? { ...summary, conversationId } : null);
  }, [conversationId]);
  const updateBridgeConnection = useCallback((connection: BridgeConnection) => setBridgeConnection(connection), []);
  const updateRunningSummary = useCallback((summary: RunningThreadSummary) => setRunningSummary(summary), []);
  return (
    <aside className={'panel' + (currentViewState.minimized ? ' is-minimized' : '')} aria-label="ChatPanelPlus パネル">
      <header className="panel-header">
        <div className="panel-header-brand">
          <svg className="panel-brand-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5h14v14H5zM8 9h8M8 12h5M8 15h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div className="panel-brand-copy">
            <h1 className="panel-title">ChatPanelPlus</h1>
            <span className="panel-project-divider" aria-hidden="true">·</span>
            <span className="panel-project-title"><ProjectPanelTitle /></span>
          </div>
        </div>
        <div className="panel-header-actions">
          <CodexWorkModeToggle minimized={currentViewState.minimized} />
          <div className="panel-header-statistics">
            <ConversationStatistics
              answerCompletionSoundEnabled={answerCompletionSoundEnabled}
              answerCompletionSoundId={answerCompletionSoundId}
              answerCompletionSoundVolumePercent={answerCompletionSoundVolumePercent}
              conversationId={conversationId}
              conversationMuted={conversationMuted}
              conversationMuteLoaded={muteLoaded}
              conversationMutePending={mutePending}
              conversationMuteRevision={muteRevision}
              getConversationMuteSnapshot={getConversationMuteSnapshot}
              onToggleConversationMute={onToggleConversationMute}
            />
          </div>
          <button type="button" className="panel-options-toggle" aria-label="Optionsを開く" title="Optionsを開く" onClick={onOpenSettings}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m9-8h-2m-14 0H3m15.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className={'panel-minimize-toggle' + (currentViewState.minimized ? ' is-minimized' : '')}
            aria-label={currentViewState.minimized ? '復帰' : '最小化'} title={currentViewState.minimized ? '復帰' : '最小化'}
            aria-expanded={!currentViewState.minimized} onClick={onToggleMinimized}>
            {MIN_ICON_SVG}
          </button>
        </div>
        {currentViewState.minimized && <BridgeSummaryBar compact conversationId={conversationId}
          summary={currentBridgeSummary} connection={bridgeConnection} runningSummary={runningSummary} />}
      </header>
      <div className="panel-content" hidden={currentViewState.minimized}>
        <div className="utility-row" aria-label="常時表示操作">
          {model.utilityButtons.map((button) => (
            <button
              type="button"
              className="action-button"
              key={button.id}
              data-button-id={button.id}
              style={{ backgroundColor: button.color }}
              onPointerDown={button.action === 'paste' || (button.kind === 'insert' && button.insertionMode === 'caret') ? () => onButtonPointerDown(button.id) : undefined}
              onClick={(event) => onButtonClick(button, event.detail > 0)}
            >
              {button.label}
            </button>
          ))}
        </div>
        {model.tabs.length > 0 && (
          <div className="tab-list" role="tablist" aria-label="操作カテゴリ">
            {model.tabs.map((tab) => (
              <button
                type="button"
                className={'tab-button' + (activeTab?.id === tab.id ? ' is-active' : '')}
                key={tab.id}
                id={'chatpanel-tab-' + tab.id}
                role="tab"
                aria-selected={activeTab?.id === tab.id}
                aria-controls="chatpanel-tab-content"
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {activeTab && (
          <div
            className="tab-content"
            id="chatpanel-tab-content"
            role="tabpanel"
            aria-labelledby={'chatpanel-tab-' + activeTab.id}
          >
            {activeButtons.map((button) => (
              <button
                type="button"
                className="action-button"
                key={button.id}
                data-button-id={button.id}
                style={{ backgroundColor: button.color }}
                onPointerDown={button.action === 'paste' || (button.kind === 'insert' && button.insertionMode === 'caret') ? () => onButtonPointerDown(button.id) : undefined}
                onClick={(event) => onButtonClick(button, event.detail > 0)}
              >
                {button.label}
              </button>
            ))}
          </div>
        )}
        <BridgeSummaryBar conversationId={conversationId} summary={currentBridgeSummary} connection={bridgeConnection}
          runningSummary={runningSummary} expanded={bridgeExpanded} onToggle={onToggleBridgeExpanded} />
        <div id="panel-bridge-details" className="panel-bridge-details" hidden={!bridgeExpanded}>
          <CodexBridgeList
            foregroundEnabled={!currentViewState.minimized} conversationId={conversationId}
            currentProjectId={projectIdFromPathname(window.location.pathname)}
            bridgeWatchSelection={bridgeWatchSelection} bridgeEventSelection={bridgeEventSelection}
            onSelectBridgeWatch={onSelectBridgeWatch} onSelectBridgeEvent={onSelectBridgeEvent}
            onSummaryChange={updateBridgeSummary} onConnectionChange={updateBridgeConnection}
            onRunningSummaryChange={updateRunningSummary}
          />
        </div>
        {error && <div className="panel-error" role="status">{error}</div>}
      </div>
      {manualPasteOpen && (
        <div
          className="manual-paste-backdrop"
          onClick={onCancelManualPaste}
        >
          <section
            className="manual-paste-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-paste-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelManualPaste();
                return;
              }
              if (event.key !== 'Tab') return;
              const controls = event.currentTarget.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)');
              const first = controls.item(0);
              const last = controls.item(controls.length - 1);
              const root = event.currentTarget.getRootNode();
              const activeElement = root instanceof ShadowRoot ? root.activeElement ?? document.activeElement : document.activeElement;
              if (event.shiftKey && activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <h2 id="manual-paste-title">直接貼り付けが利用できません</h2>
            <p>テキストをここへ貼り付けてから「挿入」を押してください（Ctrl+V）。</p>
            <textarea
              autoFocus
              rows={6}
              value={manualPasteText}
              onChange={(event) => onManualPasteTextChange(event.currentTarget.value)}
              aria-label="貼り付けるテキスト"
            />
            <div className="manual-paste-actions">
              <button type="button" onClick={onSubmitManualPaste}>
                挿入
              </button>
              <button type="button" onClick={onCancelManualPaste}>キャンセル</button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
