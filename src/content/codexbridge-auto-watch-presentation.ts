import { codexBridgeReadErrorLabel } from './codexbridge-read-error-label.ts';

export function codexBridgeAutoWatchFailureLabel(failure: string | null): string {
  if (!failure) return '';
  if (failure === 'running-only-unsupported') return 'Bridgeがrunning_onlyに未対応のため、回答完了時の照合を行えません。';
  if (failure === 'owner-conflict') return '既存watchは別会話の所有です。移管せず、このthreadの自動登録を見送ります。';
  if (failure === 'auto-owner-conflict') return '同じ会話の別タブが自動登録を所有中です。このtabは処理しません。';
  if (failure === 'ownerless-watch') return 'owner情報のない既存watchがあるため、このthreadの自動登録を見送ります。';
  if (failure === 'watch-limit') return '監視上限32件のため、一部threadを登録できませんでした。';
  if (failure === 'target-unavailable') return '対象マシンを現在確認できません。回答完了時の照合を行えません。';
  if (failure === 'owner-tab-unavailable') {
    return 'この会話の自動登録は別タブが所有中か、ownerタブを確認できません。設定と監視・通知履歴は保持されています。';
  }
  if (failure === 'owner-recovering') return 'ownerの応答を確認中です。状態を再確認します。';
  if (failure === 'connection-changed') return '接続先が変わりました。現在の接続先では登録しませんでした。';
  if (failure === 'connection-unavailable') return 'Bridge接続先を確認できません。';
  if (failure === 'permission-required') return 'Bridgeへの接続権限を確認できません。';
  if (failure === 'authentication-required' || failure === '401') return 'Bridge認証を確認できません。';
  return `回答完了時の登録に失敗しました。${codexBridgeReadErrorLabel(failure)}`;
}
