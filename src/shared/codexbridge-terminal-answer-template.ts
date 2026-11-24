export const CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN = '##Codex最終回答##';
export const DEFAULT_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE = CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN;
export const MAX_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE_LENGTH = 8_192;

export function isValidCodexBridgeTerminalAnswerTemplate(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_CODEX_BRIDGE_TERMINAL_ANSWER_TEMPLATE_LENGTH
    && value.includes(CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN);
}

export function renderCodexBridgeTerminalAnswerTemplate(template: string, answer: string): string {
  return template.split(CODEX_BRIDGE_TERMINAL_ANSWER_TOKEN).join(answer);
}
