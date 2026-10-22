import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  EXCLUDED_DIRECTORY_NAMES,
  EXCLUDED_FILE_NAMES,
  LIMITS,
  findSourceSizeViolations,
  formatSourceSizeViolations,
  isIncludedSourcePath,
  listSourceFiles,
  measureSourceContent,
} from '../scripts/source-size-checker.mjs';

test('measures LF, CRLF, and a final line without an extra trailing line', () => {
  assert.deepEqual(measureSourceContent(Buffer.from('one\ntwo')), { lines: 2, bytes: 7 });
  assert.deepEqual(measureSourceContent(Buffer.from('one\r\ntwo\r\n')), { lines: 2, bytes: 10 });
  assert.deepEqual(measureSourceContent(Buffer.from('one\n\n')), { lines: 2, bytes: 5 });
  assert.deepEqual(measureSourceContent(Buffer.from('日本語')), { lines: 1, bytes: 9 });
  assert.deepEqual(measureSourceContent(Buffer.from('')), { lines: 0, bytes: 0 });
});

test('accepts files exactly at both configured limits', () => {
  const lineBoundary = Buffer.from('x\n'.repeat(LIMITS.maxLines - 1) + 'x');
  const byteBoundary = Buffer.from('x'.repeat(LIMITS.maxBytes));

  assert.deepEqual(measureSourceContent(lineBoundary), { lines: LIMITS.maxLines, bytes: 999 });
  assert.deepEqual(findSourceSizeViolations('src/lines.ts', lineBoundary), []);
  assert.deepEqual(measureSourceContent(byteBoundary), { lines: 1, bytes: LIMITS.maxBytes });
  assert.deepEqual(findSourceSizeViolations('src/bytes.ts', byteBoundary), []);
});

test('reports line and UTF-8 byte limits with readable values', () => {
  const tooManyLines = Buffer.from('x\n'.repeat(LIMITS.maxLines) + 'x');
  const tooManyBytes = Buffer.from('x'.repeat(LIMITS.maxBytes + 1));
  const lineViolations = findSourceSizeViolations('src/日本語.ts', tooManyLines);
  const byteViolations = findSourceSizeViolations('src/bytes.ts', tooManyBytes);

  assert.deepEqual(lineViolations, [
    { path: 'src/日本語.ts', metric: 'lines', value: 501, limit: LIMITS.maxLines },
  ]);
  assert.deepEqual(byteViolations, [
    { path: 'src/bytes.ts', metric: 'bytes', value: LIMITS.maxBytes + 1, limit: LIMITS.maxBytes },
  ]);
  assert.match(formatSourceSizeViolations([...lineViolations, ...byteViolations]), /src\/日本語\.ts: 501 lines \(max 500\)/);
  assert.match(formatSourceSizeViolations(byteViolations), /src\/bytes\.ts: 32769 bytes \(max 32768\)/);
});

test('reports both limits when a file exceeds both', () => {
  const content = Buffer.from('x\n'.repeat(LIMITS.maxLines) + 'x'.repeat(LIMITS.maxBytes + 1));
  const violations = findSourceSizeViolations('src/both.ts', content);

  assert.deepEqual(violations.map(({ metric }) => metric), ['lines', 'bytes']);
  assert.match(formatSourceSizeViolations(violations), /src\/both\.ts: 501 lines \(max 500\); 33769 bytes \(max 32768\)/);
});

test('includes supported source and configuration files while excluding generated and static files', () => {
  assert.equal(isIncludedSourcePath('src/日本語.ts'), true);
  assert.equal(isIncludedSourcePath('D:\\repo\\options\\Settings.TSX'), true);
  assert.equal(isIncludedSourcePath('scripts/check.mjs'), true);
  assert.equal(isIncludedSourcePath('public/manifest.json'), true);
  assert.equal(isIncludedSourcePath('docs/design.json'), false);
  assert.equal(isIncludedSourcePath('dist/generated.js'), false);
  assert.equal(isIncludedSourcePath('node_modules/pkg/index.js'), false);
  assert.equal(isIncludedSourcePath('.git/config.json'), false);
  assert.equal(isIncludedSourcePath('package-lock.json'), false);
  assert.equal(isIncludedSourcePath('src/image.png'), false);
  assert.ok(EXCLUDED_DIRECTORY_NAMES.has('dist'));
  assert.ok(EXCLUDED_FILE_NAMES.has('package-lock.json'));
});

test('finds untracked source files and excludes ignored files in a Windows Git checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'chatpanel-size-'));

  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'ignored.ts\n');
    writeFileSync(join(root, 'src', '日本語.ts'), 'export {};');
    writeFileSync(join(root, 'src', 'ignored.ts'), 'export {};');
    writeFileSync(join(root, 'docs', 'example.ts'), 'export {};');
    writeFileSync(join(root, 'dist', 'generated.js'), '');

    assert.deepEqual(listSourceFiles(root), ['src/日本語.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI exits with code 1 and reports the offending file and limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'chatpanel-size-cli-'));
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    copyFileSync(resolve(repositoryRoot, 'scripts/check-source-size.mjs'), join(root, 'scripts/check-source-size.mjs'));
    copyFileSync(resolve(repositoryRoot, 'scripts/source-size-checker.mjs'), join(root, 'scripts/source-size-checker.mjs'));
    writeFileSync(join(root, 'src', 'too-large.ts'), 'x'.repeat(LIMITS.maxBytes + 1));

    const result = spawnSync(process.execPath, [join(root, 'scripts/check-source-size.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /src\/too-large\.ts: 32769 bytes \(max 32768\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
