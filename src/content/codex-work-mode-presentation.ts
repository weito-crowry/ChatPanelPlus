import type { CodexWorkModeControllerState } from './codex-work-mode-controller.ts';

export interface CodexWorkModePresentation {
  readonly label: string;
  readonly ariaLabel: string;
  readonly ariaPressed?: boolean;
  readonly ariaBusy: boolean;
  readonly disabled: boolean;
  readonly retryOnToggle: boolean;
  readonly className: string;
  readonly message?: Readonly<{ role: 'status' | 'alert'; text: string }>;
  readonly showInitialize: boolean;
}

const MANUAL_DESCRIPTION = '手動表示です。Codexの実稼働状態とは連動しません。';

export function getCodexWorkModePresentation(
  state: CodexWorkModeControllerState,
  minimized: boolean,
): CodexWorkModePresentation {
  if (state.status === 'loading') {
    return {
      label: minimized ? '…' : 'Codex作業中: 確認中',
      ariaLabel: 'Codex作業中の手動表示を確認中',
      ariaBusy: true,
      disabled: true,
      retryOnToggle: false,
      className: '',
      message: { role: 'status', text: '保存状態を確認しています。' },
      showInitialize: false,
    };
  }

  if (state.status === 'unavailable') {
    return {
      label: minimized ? '—' : 'Codex作業中: 利用不可',
      ariaLabel: 'Codex作業中の手動表示は会話IDが確定するまで利用できません。',
      ariaBusy: false,
      disabled: true,
      retryOnToggle: false,
      className: 'is-unavailable',
      message: { role: 'status', text: '会話IDが確定すると利用できます。' },
      showInitialize: false,
    };
  }

  if (state.status === 'unknown') {
    const message = state.saving
      ? 'OFFに初期化中…'
      : state.actionFailed
        ? 'OFFでの初期化に失敗しました。再試行してください。'
      : state.reason === 'invalid-data'
        ? '保存値を確認できません。再試行するか、OFFで初期化してください。'
        : '保存状態を読み込めません。再試行するか、OFFで初期化してください。';
    return {
      label: minimized ? '!' : 'Codex作業中: 状態不明',
      ariaLabel: state.saving
        ? 'Codex作業中の手動表示。保存状態を確認できません。OFFへ初期化中です。'
        : 'Codex作業中の手動表示。保存状態を確認できません。押して再試行できます。',
      ariaBusy: state.saving,
      disabled: state.saving,
      retryOnToggle: !state.saving,
      className: 'is-unknown',
      message: { role: state.saving ? 'status' : 'alert', text: message },
      showInitialize: !state.saving && !minimized,
    };
  }

  const label = state.enabled ? 'ON' : 'OFF';
  return {
    label: minimized ? `${label}${state.notice === 'write-failed' ? '!' : ''}` : `Codex作業中: ${label}`,
    ariaLabel: `Codex作業中の手動表示: ${label}。${MANUAL_DESCRIPTION}${state.notice === 'write-failed' ? ' 直前の保存に失敗しました。' : ''}`,
    ariaPressed: state.enabled,
    ariaBusy: state.saving,
    disabled: state.saving,
    retryOnToggle: false,
    className: [state.enabled && 'is-enabled', state.notice === 'write-failed' && 'has-error'].filter(Boolean).join(' '),
    ...(state.saving
      ? { message: { role: 'status' as const, text: '保存中…' } }
      : state.notice === 'write-failed'
        ? { message: { role: 'alert' as const, text: '保存できませんでした。もう一度切り替えてください。' } }
        : {}),
    showInitialize: false,
  };
}
