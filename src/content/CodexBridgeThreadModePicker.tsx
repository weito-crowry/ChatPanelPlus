import { useId } from 'react';
import type { CodexBridgeThreadListMode } from './codexbridge-request-tracker.ts';

export function CodexBridgeThreadModePicker({
  mode,
  onChange,
}: Readonly<{ mode: CodexBridgeThreadListMode; onChange: (mode: CodexBridgeThreadListMode) => void }>) {
  const descriptionId = useId();
  return (
    <fieldset className="codex-bridge-list-mode" aria-describedby={descriptionId}>
      <legend>thread取得モード</legend>
      <label><input type="radio" name={descriptionId} value="running" checked={mode === 'running'}
        onChange={() => onChange('running')} />実行中（既定）</label>
      <label><input type="radio" name={descriptionId} value="normal" checked={mode === 'normal'}
        onChange={() => onChange('normal')} />通常一覧</label>
      <small id={descriptionId}>{mode === 'running'
        ? 'Bridgeの実行中一覧APIが返したthreadを表示します。Bridgeの認識範囲に基づき、通常一覧のページ数とは別です。'
        : '通常一覧は20件ずつ取得します。未取得ページのthreadは一覧に含まれません。'}</small>
    </fieldset>
  );
}
