export type McpHostPermissionRequest = (permissions: Readonly<{ origins: string[] }>) => Promise<boolean>;

export async function requestMcpHostPermission(
  originPattern: string,
  request: McpHostPermissionRequest,
): Promise<boolean> {
  try {
    return await request({ origins: [originPattern] });
  } catch {
    return false;
  }
}
