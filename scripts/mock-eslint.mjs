#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const targets = args.filter((arg) => !arg.startsWith('-'));
const roots = targets.length > 0 ? targets : ['.'];

let fileCount = 0;

const visit = (entryPath) => {
  const stats = statSync(entryPath);
  if (stats.isDirectory()) {
    if (path.basename(entryPath) === 'node_modules' || path.basename(entryPath) === '.git') {
      return;
    }
    for (const entry of readdirSync(entryPath)) {
      visit(path.join(entryPath, entry));
    }
  } else {
    fileCount += 1;
  }
};

for (const root of roots) {
  const resolved = path.resolve(process.cwd(), root);
  visit(resolved);
}

console.log(`mock-eslint: inspected ${fileCount} files, 0 warnings`);
