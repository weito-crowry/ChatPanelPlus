import type { ClipboardContentKind } from './clipboard-metrics.ts';

export function classifyClipboardContent(
  types: readonly string[],
  itemKinds: readonly string[] = [],
  fileCount = 0,
  hasText = false,
): ClipboardContentKind {
  const normalizedTypes = types.map((type) => type.toLowerCase());
  if (fileCount > 0 || itemKinds.some((kind) => kind === 'file')
    || normalizedTypes.some((type) => type === 'files' || type.startsWith('image/') || type.startsWith('application/'))) {
    return 'files';
  }
  if (normalizedTypes.some((type) => type.startsWith('text/') && type !== 'text/plain')) return 'rich-text';
  if (normalizedTypes.some((type) => type !== 'text/plain')) return 'other';
  if (normalizedTypes.includes('text/plain') || hasText) return 'plain-text';
  return 'unknown';
}

export async function readClipboardContentKind(
  clipboard: Partial<Pick<Clipboard, 'read'>> | undefined,
): Promise<ClipboardContentKind> {
  if (!clipboard?.read) return 'unknown';
  try {
    const items = await clipboard.read();
    const types = items.flatMap((item) => [...item.types]);
    return classifyClipboardContent(types);
  } catch {
    return 'unknown';
  }
}
