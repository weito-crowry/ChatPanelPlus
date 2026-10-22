import { execFileSync } from 'node:child_process';

export const LIMITS = Object.freeze({ maxLines: 500, maxBytes: 32 * 1024 });

export const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json',
]);

export const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', 'docs',
]);

export const EXCLUDED_FILE_NAMES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json',
  'yarn.lock', 'bun.lock', 'bun.lockb',
]);

export function isIncludedSourcePath(filePath) {
  const parts = filePath.replaceAll('\\', '/').split('/');
  const fileName = parts.at(-1).toLowerCase();
  const extension = fileName.slice(fileName.lastIndexOf('.'));

  return !parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part.toLowerCase()))
    && !EXCLUDED_FILE_NAMES.has(fileName)
    && SOURCE_EXTENSIONS.has(extension);
}

export function measureSourceContent(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  let lines = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      lines += 1;
    } else if (bytes[index] === 0x0d) {
      lines += 1;
      if (bytes[index + 1] === 0x0a) index += 1;
    }
  }

  if (bytes.length > 0 && bytes.at(-1) !== 0x0a && bytes.at(-1) !== 0x0d) {
    lines += 1;
  }

  return { lines, bytes: bytes.length };
}

export function findSourceSizeViolations(filePath, content) {
  const measured = measureSourceContent(content);
  const violations = [];

  if (measured.lines > LIMITS.maxLines) {
    violations.push({ path: filePath, metric: 'lines', value: measured.lines, limit: LIMITS.maxLines });
  }
  if (measured.bytes > LIMITS.maxBytes) {
    violations.push({ path: filePath, metric: 'bytes', value: measured.bytes, limit: LIMITS.maxBytes });
  }

  return violations;
}

export function formatSourceSizeViolations(violations) {
  const byPath = new Map();
  for (const { path, metric, value, limit } of violations) {
    const details = byPath.get(path) ?? [];
    details.push(`${value} ${metric} (max ${limit})`);
    byPath.set(path, details);
  }
  return [...byPath].map(([path, details]) => `${path}: ${details.join('; ')}`).join('\n');
}

export function listSourceFiles(rootDirectory) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: rootDirectory },
  );

  return output.toString('utf8').split('\0').filter(isIncludedSourcePath).sort();
}
