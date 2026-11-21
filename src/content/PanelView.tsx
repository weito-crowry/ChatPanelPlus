import { ConversationStatistics } from './ConversationStatistics';
import { CodexWorkModeToggle } from './CodexWorkModeToggle';
import { CodexBridgeList } from './CodexBridgeList';
import { ProjectPanelTitle } from './ProjectPanelTitle';
import type { PanelControllerState } from './usePanelController';

const MIN_ICON_SVG = (
  <svg className="panel-minimize-icon" viewBox="0 0 320 120" width="140" height="52" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M40 60 L100 60" />
      <path d="M100 60 C110 60, 110 85, 130 85 L190 85" />
      <path d="M190 85 C210 85, 210 60, 220 60 L280 60" />
      <path d="M140 64 L160 78 L180 64" />
    </g>
  </svg>
);

export function PanelView({
  model,
  currentViewState,
  activeTab,
  activeButtons,
  conversationId,
  bridgeExpanded,
  conversationMuted,
  muteLoaded,
  mutePending,
  muteRevision,
  getConversationMuteSnapshot,
  error,
  answerCompletionSoundEnabled,
  answerCompletionSoundId,
  answerCompletionSoundVolumePercent,
  soundTogglePending,
  soundToggleError,
  manualPasteOpen,
  manualPasteText,
  onButtonPointerDown,
  onButtonClick,
  onSelectTab,
  onToggleMinimized,
  onToggleBridgeExpanded,
  onToggleConversationMute,
  onOpenSettings,
  onToggleAnswerCompletionSound,
  onManualPasteTextChange,
  onSubmitManualPaste,
  onCancelManualPaste,
}: PanelControllerState) {
  return (
    <aside className={'panel' + (currentViewState.minimized ? ' is-minimized' : '')} aria-label="ChatPanelPlus パネル">
      <div className="panel-header">
        <h1 className="panel-title" hidden={currentViewState.minimized}><ProjectPanelTitle /></h1>
        <CodexWorkModeToggle minimized={currentViewState.minimized} />
      </div>
      <div className="panel-content" hidden={currentViewState.minimized}>
        <ConversationStatistics
          answerCompletionSoundEnabled={answerCompletionSoundEnabled}
          answerCompletionSoundId={answerCompletionSoundId}
          answerCompletionSoundVolumePercent={answerCompletionSoundVolumePercent}
          soundTogglePending={soundTogglePending}
          soundToggleError={soundToggleError}
          onToggleAnswerCompletionSound={onToggleAnswerCompletionSound}
          conversationId={conversationId}
          conversationMuted={conversationMuted}
          conversationMuteLoaded={muteLoaded}
          conversationMutePending={mutePending}
          conversationMuteRevision={muteRevision}
          getConversationMuteSnapshot={getConversationMuteSnapshot}
          onToggleConversationMute={onToggleConversationMute}
        />
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
        <section className="panel-bridge-summary" aria-label="CodexBridgeサマリー">
          <dl className="panel-bridge-summary-list" aria-label="CodexBridge件数">
            <div className="panel-bridge-summary-item">
              <dt>監視中</dt>
              <dd aria-label="Phase 4で接続">—</dd>
            </div>
            <div className="panel-bridge-summary-item">
              <dt>監視スレッドが終了した未確認</dt>
              <dd aria-label="Phase 4で接続">—</dd>
            </div>
          </dl>
          <p className="panel-bridge-summary-note" role="note">会話別件数はPhase 4で接続します。</p>
          <button
            type="button"
            className="codex-bridge-button panel-bridge-details-toggle"
            aria-expanded={bridgeExpanded}
            aria-controls="panel-bridge-details"
            onClick={onToggleBridgeExpanded}
          >
            CodexBridge詳細を{bridgeExpanded ? '閉じる' : '開く'}
          </button>
        </section>
        <div id="panel-bridge-details" className="panel-bridge-details" hidden={!bridgeExpanded}>
          <p className="panel-bridge-scope-note" role="note">
            この一覧は現行の共有表示です。会話別の絞り込みはPhase 4で接続します。
          </p>
          <CodexBridgeList foregroundEnabled={!currentViewState.minimized} />
        </div>
        {error && <div className="panel-error" role="status">{error}</div>}
        <div className="settings-entry">
          <button type="button" onClick={onOpenSettings}>
            設定
          </button>
        </div>
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
      <button
        type="button"
        className={'panel-minimize-toggle' + (currentViewState.minimized ? ' is-minimized' : '')}
        aria-label={currentViewState.minimized ? '復帰' : '最小化'}
        title={currentViewState.minimized ? '復帰' : '最小化'}
        aria-expanded={!currentViewState.minimized}
        onClick={onToggleMinimized}
      >
        {MIN_ICON_SVG}
      </button>
    </aside>
  );
}
