import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const distDirectory = resolve(projectDirectory, 'dist');
const packagePath = resolve(projectDirectory, 'package.json');
const noopManifest = (version) => ({
  manifest_version: 3,
  name: 'ChatPanelPlus (無機能検証版)',
  version,
  description: '会話読み込み障害の切り分け用・無機能診断版です。',
});

function assertStrictDescendant(targetPath, parentPath, label) {
  const targetRelativePath = relative(parentPath, targetPath);

  if (
    targetRelativePath === ''
    || targetRelativePath === '..'
    || targetRelativePath.startsWith(`..${sep}`)
    || isAbsolute(targetRelativePath)
  ) {
    throw new Error(`${label} must be a strict child of ${parentPath}: ${targetPath}`);
  }
}

function validateManifest(manifest, packageJson) {
  const expected = noopManifest(packageJson.version);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error('No-op manifest must match the metadata-only diagnostic manifest.');
  }
}

function clearDistDirectory() {
  assertStrictDescendant(distDirectory, projectDirectory, 'dist directory');

  if (!existsSync(distDirectory)) {
    mkdirSync(distDirectory);
    return;
  }

  const distInfo = lstatSync(distDirectory);
  if (!distInfo.isDirectory() || distInfo.isSymbolicLink()) {
    throw new Error(`Refusing to clear a non-directory or linked dist path: ${distDirectory}`);
  }

  const realDistDirectory = realpathSync(distDirectory);
  assertStrictDescendant(realDistDirectory, projectDirectory, 'resolved dist directory');
  if (relative(projectDirectory, realDistDirectory) !== 'dist') {
    throw new Error(`Resolved dist path is not the project dist directory: ${realDistDirectory}`);
  }

  for (const entry of readdirSync(distDirectory)) {
    const entryPath = resolve(distDirectory, entry);
    assertStrictDescendant(entryPath, distDirectory, 'dist entry');
    rmSync(entryPath, { force: true, recursive: true });
  }
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const manifest = noopManifest(packageJson.version);
validateManifest(manifest, packageJson);
clearDistDirectory();
writeFileSync(
  resolve(distDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`Built the no-op diagnostic extension: dist/manifest.json only (v${manifest.version}).`);
