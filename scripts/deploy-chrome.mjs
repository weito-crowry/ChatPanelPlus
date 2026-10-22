import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalAssetReferences, assertLocalOffscreenReferences } from './deployment-assets.mjs';

const projectDirectory = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const parentDirectory = realpathSync(resolve(projectDirectory, '..'));
const destinationDirectory = resolve(parentDirectory, 'ChatPanelPlus-Content-Probe-20261021');
const distDirectory = resolve(projectDirectory, 'dist');
const manifestPath = resolve(distDirectory, 'manifest.json');
const packageJson = JSON.parse(readFileSync(resolve(projectDirectory, 'package.json'), 'utf8'));

function assertStrictChild(targetPath, parentPath, label) {
  const childPath = relative(parentPath, targetPath);
  if (childPath === '' || childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
    throw new Error(`${label} must be a strict child of ${parentPath}: ${targetPath}`);
  }
}

function assertPlainDirectory(path, expectedPath, label) {
  assertStrictChild(path, parentDirectory, label);
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing non-directory or linked ${label}: ${path}`);
  }
  if (realpathSync(path) !== expectedPath) {
    throw new Error(`Resolved ${label} differs from its fixed path: ${path}`);
  }
}

function listRegularFiles(directory, root = directory) {
  const files = new Map();
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    assertStrictChild(path, root, 'deployment entry');
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing linked deployment entry: ${path}`);
    }
    if (info.isDirectory()) {
      for (const [childPath, childHash] of listRegularFiles(path, root)) {
        files.set(childPath, childHash);
      }
    } else if (info.isFile()) {
      const relativePath = relative(root, path).split(sep).join('/');
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      files.set(relativePath, hash);
    } else {
      throw new Error(`Refusing non-regular deployment entry: ${path}`);
    }
  }
  return files;
}

function validateBuild(files) {
  if (!files.has('manifest.json') || !files.has('content.js') || !files.has('background.js')
    || !files.has('index.html') || !files.has('offscreen.html') || !files.has('offscreen.js')) {
    throw new Error('dist is incomplete; run pnpm build before deployment.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packageManifest = JSON.parse(readFileSync(resolve(projectDirectory, 'public', 'manifest.json'), 'utf8'));
  if (JSON.stringify(manifest) !== JSON.stringify(packageManifest) || manifest.version !== packageJson.version) {
    throw new Error('dist manifest does not match public/manifest.json and package.json.');
  }
  if (manifest.manifest_version !== 3
    || manifest.content_scripts?.length !== 1
    || JSON.stringify(manifest.content_scripts[0].matches) !== JSON.stringify(['https://chatgpt.com/*'])
    || JSON.stringify(manifest.content_scripts[0].js) !== JSON.stringify(['content.js'])
    || manifest.background?.service_worker !== 'background.js'
    || manifest.options_ui?.page !== 'index.html') {
    throw new Error('dist manifest does not reference the expected extension components.');
  }
  const allowedPermissions = new Set(['clipboardRead', 'storage', 'offscreen']);
  if (!Array.isArray(manifest.permissions)
    || manifest.permissions.length !== allowedPermissions.size
    || [...allowedPermissions].some((permission) => !manifest.permissions.includes(permission))
    || manifest.permissions.some((permission) => !allowedPermissions.has(permission))) {
    throw new Error('dist manifest must request only clipboardRead, storage, and offscreen permissions.');
  }
  for (const field of ['host_permissions', 'optional_host_permissions']) {
    if (field in manifest) throw new Error(`dist manifest must not request ${field}.`);
  }

  const html = readFileSync(resolve(distDirectory, 'index.html'), 'utf8');
  assertLocalAssetReferences(html, files);
  const offscreenHtml = readFileSync(resolve(distDirectory, 'offscreen.html'), 'utf8');
  assertLocalOffscreenReferences(offscreenHtml, files);
}

function clearDirectory(directory) {
  for (const entry of readdirSync(directory)) {
    rmSync(resolve(directory, entry), { recursive: true, force: true });
  }
}

function reportFiles(label, files) {
  console.log(`${label}: ${files.size} files`);
  for (const path of [...files.keys()].sort()) console.log(`  ${path}  sha256:${files.get(path)}`);
}

if (!existsSync(destinationDirectory)) {
  throw new Error(`The registered Chrome extension folder is missing: ${destinationDirectory}`);
}
if (!existsSync(distDirectory)) throw new Error(`Build output is missing: ${distDirectory}`);
assertPlainDirectory(destinationDirectory, destinationDirectory, 'fixed Chrome extension folder');
assertPlainDirectory(distDirectory, distDirectory, 'dist directory');
const sourceFiles = listRegularFiles(distDirectory);
const existingFiles = listRegularFiles(destinationDirectory);
validateBuild(sourceFiles);

const backupStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupDirectory = resolve(parentDirectory, `ChatPanelPlus-Content-Probe-Backup-${backupStamp}`);
assertStrictChild(backupDirectory, parentDirectory, 'backup directory');
if (existsSync(backupDirectory)) throw new Error(`Backup path already exists: ${backupDirectory}`);

console.log(`Source: ${distDirectory}`);
console.log(`Destination: ${destinationDirectory}`);
reportFiles('dist', sourceFiles);
reportFiles('current extension', existingFiles);
console.log(`Backup: ${backupDirectory}`);

cpSync(destinationDirectory, backupDirectory, { recursive: true, errorOnExist: true, force: false });
try {
  clearDirectory(destinationDirectory);
  cpSync(distDirectory, destinationDirectory, { recursive: true, errorOnExist: true, force: false });
  const deployedFiles = listRegularFiles(destinationDirectory);
  if (JSON.stringify([...deployedFiles].sort()) !== JSON.stringify([...sourceFiles].sort())) {
    throw new Error('Deployed file hashes do not match dist.');
  }
  console.log('Deployment completed. Chrome was not reloaded.');
} catch (error) {
  clearDirectory(destinationDirectory);
  cpSync(backupDirectory, destinationDirectory, { recursive: true, errorOnExist: true, force: false });
  console.error(`Deployment failed; the previous folder was restored from ${backupDirectory}.`);
  throw error;
}
