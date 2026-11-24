import type { CodexBridgeReadResponse } from '../shared/codexbridge-mcp-protocol.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isReadResponse<T>(value: unknown): value is CodexBridgeReadResponse<T> {
  return isRecord(value) && typeof value.ok === 'boolean';
}
