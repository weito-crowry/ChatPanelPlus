const REQUIRED_PERMISSIONS = ['clipboardRead', 'storage', 'offscreen', 'alarms'];
const OPTIONAL_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'];

function hasExactValues(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const values = new Set(value);
  return values.size === expected.length && expected.every((entry) => values.has(entry));
}

export function validateManifestPermissions(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('dist manifest must be an object.');
  }
  if (!hasExactValues(manifest.permissions, REQUIRED_PERMISSIONS)) {
    throw new Error(
      'dist manifest must request only clipboardRead, storage, offscreen, and alarms permissions.',
    );
  }
  if ('host_permissions' in manifest) {
    throw new Error('dist manifest must not request host_permissions.');
  }
  if ('optional_permissions' in manifest) {
    throw new Error('dist manifest must not request optional_permissions.');
  }
  if (!hasExactValues(manifest.optional_host_permissions, OPTIONAL_HOST_PERMISSIONS)) {
    throw new Error(
      'dist manifest must request only http://*/* and https://*/* as optional host permissions.',
    );
  }
}
