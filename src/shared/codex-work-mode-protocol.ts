export const CODEX_WORK_MODE_GET = 'GET_CODEX_WORK_MODE';
export const CODEX_WORK_MODE_SET = 'SET_CODEX_WORK_MODE';
export const CODEX_WORK_MODE_UPDATED = 'CODEX_WORK_MODE_UPDATED';

export type CodexWorkModeGetMessage = Readonly<{
  type: typeof CODEX_WORK_MODE_GET;
  conversationId: string;
}>;

export type CodexWorkModeSetMessage = Readonly<{
  type: typeof CODEX_WORK_MODE_SET;
  conversationId: string;
  enabled: boolean;
}>;

export type CodexWorkModeRequest = CodexWorkModeGetMessage | CodexWorkModeSetMessage;

export function codexWorkModeRequestType(message: unknown): typeof CODEX_WORK_MODE_GET | typeof CODEX_WORK_MODE_SET | null {
  if (typeof message !== 'object' || message === null || !('type' in message)) return null;
  return message.type === CODEX_WORK_MODE_GET || message.type === CODEX_WORK_MODE_SET ? message.type : null;
}
