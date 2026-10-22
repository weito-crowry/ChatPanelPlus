import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIMITS,
  findSourceSizeViolations,
  formatSourceSizeViolations,
  listSourceFiles,
} from './source-size-checker.mjs';

const rootDirectory = fileURLToPath(new URL('../', import.meta.url));

try {
  const files = listSourceFiles(rootDirectory);
  const violations = files.flatMap((filePath) => findSourceSizeViolations(
    filePath,
    readFileSync(resolve(rootDirectory, filePath)),
  ));

  if (violations.length > 0) {
    console.error(formatSourceSizeViolations(violations));
    process.exitCode = 1;
  } else {
    console.log(`Source size check passed: ${files.length} files (max ${LIMITS.maxLines} lines, ${LIMITS.maxBytes} bytes each).`);
  }
} catch (error) {
  console.error(`Source size check failed: ${error.message}`);
  process.exitCode = 1;
}
