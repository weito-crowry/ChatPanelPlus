export function codexBridgeThreadDisplayName(
  title: string | null | undefined,
  threadId: string,
): string {
  return title?.trim() || threadId;
}
