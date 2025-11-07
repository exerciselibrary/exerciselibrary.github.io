#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FORMAT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.html',
  '.md',
  '.txt',
  '.yml',
  '.yaml'
]);
const IGNORE_DIRS = new Set(['node_modules', '.git', '.vscode', '.idea']);

let filesFormatted = 0;

const normalizeText = (text) => {
  let normalized = text.replace(/\r\n/g, '\n');
  normalized = normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n');
  if (!normalized.endsWith('\n')) {
    normalized += '\n';
  }
  return normalized;
};

const formatFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (!FORMAT_EXTENSIONS.has(ext)) return;
  const original = readFileSync(filePath, 'utf8');
  const formatted = normalizeText(original);
  if (original !== formatted) {
    writeFileSync(filePath, formatted, 'utf8');
    filesFormatted += 1;
  }
};

const walk = (target) => {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    const dirName = path.basename(target);
    if (IGNORE_DIRS.has(dirName)) {
      return;
    }
    for (const entry of readdirSync(target)) {
      walk(path.join(target, entry));
    }
    return;
  }
  formatFile(target);
};

walk(ROOT);

if (filesFormatted) {
  console.log(`Formatted ${filesFormatted} file${filesFormatted === 1 ? '' : 's'}.`);
} else {
  console.log('All tracked files already satisfy the formatting rules.');
}
