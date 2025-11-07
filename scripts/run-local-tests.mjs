import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);
const localTestsDir = join(repoRoot, 'local-tests');

if (!existsSync(localTestsDir)) {
  console.log('Skipping local tests (local-tests/ directory not found).');
  process.exit(0);
}

const testFiles = readdirSync(localTestsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => entry.name)
  .sort();

if (!testFiles.length) {
  console.log('Skipping local tests (no *.test.js files found in local-tests/).');
  process.exit(0);
}

for (const file of testFiles) {
  const relativePath = join('local-tests', file);
  console.log(`Running ${relativePath} …`);
  const result = spawnSync(process.execPath, [relativePath], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(`Failed to run ${relativePath}:`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('Local tests finished successfully.');
