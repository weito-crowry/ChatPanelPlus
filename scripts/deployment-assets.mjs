import { posix } from 'node:path';

export function assertLocalAssetReferences(html, files) {
  const assets = [];
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const normalized = reference.replace(/^\.\//, '');
    if (reference.includes('\\') || !normalized.startsWith('assets/') || posix.normalize(normalized) !== normalized) {
      throw new Error(`Options page must reference local assets only: ${reference}`);
    }
    if (!files.has(normalized)) throw new Error(`index.html references a missing asset: ${normalized}`);
    assets.push(normalized);
  }
  if (assets.length === 0) throw new Error('index.html does not reference any local Options assets.');
  return assets;
}
