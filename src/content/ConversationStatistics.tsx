import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createChromeConversationStatisticsRepository } from '../shared/conversation-statistics-repository.ts';
import {
  ConversationStatisticsController,
  type ConversationStatisticsViewState,
  type StatisticsStorageError,
} from './conversation-statistics-controller.ts';
import { findComposerForm } from './conversation-statistics-send-intent.ts';
import { AnswerCompletionSoundPlayer } from './answer-completion-sound.ts';
import { createChromeSoundAssetRepository } from '../shared/answer-completion-sound-assets.ts';
import { DEFAULT_COMPLETION_SOUND_ID } from '../shared/answer-completion-sound-definitions.ts';
import { calculateStatisticsPopoverPlacement, type StatisticsPopoverPlacement } from './conversation-statistics-popover-position.ts';

const EMPTY_STATE: ConversationStatisticsViewState = {
  conversationId: null,
  aggregate: { turns: 0, inputChars: 0, outputChars: 0, totalChars: 0, partial: true },
  loading: false,
  recounting: false,
  historyScan: { scanning: false, cancelRequested: false, direction: null, steps: 0, turnKeysSeen: 0, newlyMeasuredTurns: 0, outcome: null },
  saving: false,
  unsaved: false,
  error: null,
};

const STORAGE_ERROR_TEXT: Record<StatisticsStorageError, string> = {
  'corrupt-data': '保存データが破損しています。現在の表示範囲は再集計できますが、保存データは置き換えません。',
  'unsupported-version': '保存データの形式に対応していません。',
  'storage-failed': '統計データの保存または読み込みに失敗しました。',
  'dom-failed': '現在の会話DOMから統計を取得できませんでした。',
};

function formatCount(value: number): string { return new Intl.NumberFormat('ja-JP').format(value); }

function scanMessage(state: ConversationStatisticsViewState): string | null {
  const scan = state.historyScan;
  const count = formatCount(scan.newlyMeasuredTurns);
  if (scan.scanning) return `過去履歴を集計中... ${formatCount(state.aggregate.turns)} Turns（${formatCount(scan.turnKeysSeen)}件確認）`;
  if (scan.outcome === 'completed') return `走査を完了しました。新たに${count}ターンを計測しました。全履歴を取得できた保証はありません。`;
  if (scan.outcome === 'partial') return `部分取得で走査を終了しました。新たに${count}ターンを計測しました。`;
  if (scan.outcome === 'cancelled') return `中止しました。取得済みの統計は保持されます。新たに${count}ターンを計測しました。`;
  if (scan.outcome === 'error') return `走査中にエラーが発生しました。取得済みの統計は保持されます。`;
  return null;
}

export interface ConversationStatisticsProps {
  readonly answerCompletionSoundEnabled?: boolean;
  readonly answerCompletionSoundId?: string;
  readonly soundTogglePending?: boolean;
  readonly soundToggleError?: string;
  readonly onToggleAnswerCompletionSound?: (enabled: boolean) => Promise<void>;
}

export function ConversationStatistics({
  answerCompletionSoundEnabled = false,
  answerCompletionSoundId = DEFAULT_COMPLETION_SOUND_ID,
  soundTogglePending = false,
  soundToggleError = '',
  onToggleAnswerCompletionSound,
}: ConversationStatisticsProps) {
  const [state, setState] = useState(EMPTY_STATE);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [placement, setPlacement] = useState<StatisticsPopoverPlacement | null>(null);
  const controller = useRef<ConversationStatisticsController | null>(null);
  const soundPlayer = useRef<AnswerCompletionSoundPlayer | null>(null);
  const soundEnabled = useRef(answerCompletionSoundEnabled);
  soundEnabled.current = answerCompletionSoundEnabled;
  const soundId = useRef(answerCompletionSoundId);
  soundId.current = answerCompletionSoundId;
  const togglePending = useRef(false);
  const [localToggleError, setLocalToggleError] = useState('');
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);
  const displayedSoundEnabled = optimisticEnabled ?? answerCompletionSoundEnabled;
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const assetRepository = createChromeSoundAssetRepository();
    const player = new AnswerCompletionSoundPlayer(document, undefined, async (id) => {
      const result = await assetRepository.loadAssets();
      return result.ok ? result.assets.find((asset) => asset.id === id) : undefined;
    });
    soundPlayer.current = player;
    player.setSoundId(soundId.current);
    player.setEnabled(soundEnabled.current);
    const active = new ConversationStatisticsController({
      document,
      window,
      repository: createChromeConversationStatisticsRepository(),
      onState: setState,
      onAnswerCompleted: () => player.play(),
    });
    controller.current = active;
    active.start();
    return () => {
      active.stop();
      player.dispose();
      soundPlayer.current = null;
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    soundPlayer.current?.setEnabled(answerCompletionSoundEnabled);
  }, [answerCompletionSoundEnabled]);

  useEffect(() => {
    soundPlayer.current?.setSoundId(answerCompletionSoundId);
  }, [answerCompletionSoundId]);

  async function toggleSound() {
    if (togglePending.current || soundTogglePending || !onToggleAnswerCompletionSound) return;
    const next = !displayedSoundEnabled;
    togglePending.current = true;
    setOptimisticEnabled(next);
    setLocalToggleError('');
    try {
      await onToggleAnswerCompletionSound(next);
    } catch {
      setOptimisticEnabled(answerCompletionSoundEnabled);
      setLocalToggleError('回答完了音の設定を保存できませんでした。表示は保存済みの状態へ戻しました。');
    } finally {
      togglePending.current = false;
      setOptimisticEnabled(null);
    }
  }

  useLayoutEffect(() => {
    if (!detailsOpen) {
      setPlacement(null);
      return;
    }
    const reposition = () => {
      const triggerRect = trigger.current?.getBoundingClientRect();
      if (!triggerRect || !popover.current) return;
      const composerRect = findComposerForm(document)?.getBoundingClientRect() ?? null;
      setPlacement(calculateStatisticsPopoverPlacement(triggerRect, window.innerWidth, window.innerHeight, composerRect));
    };
    reposition();
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [detailsOpen]);

  const totalLabel = state.aggregate.partial ? '集計済み総文字数' : '総文字数';
  const tooltip = `${totalLabel}：${formatCount(state.aggregate.totalChars)}文字`;
  const defaultStatus = state.loading
    ? '統計を読み込み中です。'
    : state.recounting
      ? '再集計中です。'
      : !state.conversationId
        ? '会話を開くと統計を表示します。'
        : state.aggregate.turns === 0 && state.aggregate.partial
          ? '計測済みの統計はありません。過去の発言は再集計できます。'
          : state.aggregate.partial
            ? '部分計測です。Turnsは保存済みの計測済みTurn Key数です。未読込の履歴を含まない可能性があります。'
            : 'Turnsはこの会話で計測したユニークTurn Keyの累積です。';
  const status = scanMessage(state) ?? defaultStatus;
  const scanDisabled = !state.conversationId || state.loading || state.recounting
    || (state.historyScan.scanning && state.historyScan.cancelRequested);

  return (
    <section className="conversation-statistics" aria-label="会話統計">
      <button
        type="button"
        className="statistics-sound-toggle"
        aria-label={`回答完了音を${displayedSoundEnabled ? 'オフ' : 'オン'}にする`}
        aria-pressed={displayedSoundEnabled}
        title={`回答完了音を${displayedSoundEnabled ? 'オフ' : 'オン'}にする`}
        disabled={soundTogglePending || togglePending.current || !onToggleAnswerCompletionSound}
        onClick={() => { void toggleSound(); }}
      >
        {displayedSoundEnabled ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a8.5 8.5 0 0 1 0 11" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="m17 9 5 6m0-6-5 6" /></svg>
        )}
      </button>
      <button
        ref={trigger}
        type="button"
        className="statistics-trigger"
        aria-haspopup="dialog"
        aria-expanded={detailsOpen}
        aria-controls="chatpanel-statistics-details"
        title={tooltip}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {formatCount(state.aggregate.turns)} Turns
      </button>
      {(soundToggleError || localToggleError) && <p className="statistics-sound-error" role="alert">{soundToggleError || localToggleError}</p>}
      {detailsOpen && (
        <div
          ref={popover}
          className="statistics-popover"
          id="chatpanel-statistics-details"
          role="dialog"
          aria-label="会話統計の詳細"
          style={placement ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight } : undefined}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            event.stopPropagation();
            setDetailsOpen(false);
          }}
        >
          <div className="statistics-popover-heading">
            <strong>会話統計</strong>
            <button type="button" className="statistics-close" aria-label="統計の詳細を閉じる" onClick={() => setDetailsOpen(false)}>×</button>
          </div>
          <div className="statistics-popover-body">
            <dl className="statistics-values">
              <div><dt>Turns</dt><dd>{formatCount(state.aggregate.turns)}</dd></div>
              <div><dt>INPUT文字数</dt><dd>{formatCount(state.aggregate.inputChars)}</dd></div>
              <div><dt>OUTPUT文字数</dt><dd>{formatCount(state.aggregate.outputChars)}</dd></div>
              <div><dt>{totalLabel}</dt><dd>{formatCount(state.aggregate.totalChars)}</dd></div>
            </dl>
            <p className="statistics-status" role="status">{status}</p>
            {state.error && <p className="statistics-error" role="alert">{STORAGE_ERROR_TEXT[state.error]}</p>}
            {state.saving && <p className="statistics-status">保存中です。</p>}
            {state.unsaved && !state.saving && <p className="statistics-error">未保存の統計があります。</p>}
          </div>
          <div className="statistics-actions">
            <button
              type="button"
              className="statistics-action"
              disabled={!state.conversationId || state.loading || state.recounting || state.historyScan.scanning}
              onClick={() => { void controller.current?.recount(); }}
            >再集計</button>
            <button
              type="button"
              className="statistics-action"
              disabled={scanDisabled}
              onClick={() => {
                if (state.historyScan.scanning) controller.current?.cancelHistoryScan();
                else void controller.current?.scanAllHistory();
              }}
            >{state.historyScan.scanning ? '中止' : '全履歴を集計'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
