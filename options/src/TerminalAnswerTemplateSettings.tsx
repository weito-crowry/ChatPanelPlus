import {
  CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN,
  DEFAULT_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE,
  isValidCodexBridgeTerminalAnswerTemplate,
  MAX_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE_LENGTH,
  renderCodexBridgeTerminalAnswerTemplate,
} from '../../src/shared/codexbridge-terminal-answer-template.ts';

type Props = Readonly<{ value: string; disabled: boolean; onChange: (value: string) => void }>;

const SAMPLE_ANSWER = 'Codexの最終回答サンプルです。';

export function TerminalAnswerTemplateSettings({ value, disabled, onChange }: Props) {
  const valid = isValidCodexBridgeTerminalAnswerTemplate(value);
  return <section className="settings-card terminal-answer-template" aria-labelledby="terminal-answer-template-title">
    <h3 id="terminal-answer-template-title">監視終了時の最終回答テンプレート</h3>
    <label className="field-label">メッセージ<textarea aria-label="監視終了時の最終回答テンプレート" rows={7}
      maxLength={MAX_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE_LENGTH} value={value} disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)} /></label>
    <p>最終回答を挿入する位置に <code>{CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN}</code> を1個以上含めてください。tokenはすべて最終回答へ置換されます。</p>
    <p>テンプレートは{MAX_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE_LENGTH.toLocaleString('ja-JP')} UTF-16文字以内です。空白・改行・Markdownは入力どおりに保持します。</p>
    <div className="terminal-answer-template-preview" aria-label="サンプルプレビュー">
      <strong>サンプルプレビュー</strong>
      <pre>{valid ? renderCodexBridgeTerminalAnswerTemplate(value, SAMPLE_ANSWER) : 'tokenを含むテンプレートを入力してください。'}</pre>
    </div>
    <button type="button" disabled={disabled || value === DEFAULT_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE}
      onClick={() => onChange(DEFAULT_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE)}>テンプレートを既定値に戻す</button>
  </section>;
}
