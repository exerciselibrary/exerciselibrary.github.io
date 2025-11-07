#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import eslintConfig from '../eslint.config.js';

const ROOT = process.cwd();
const INCLUDE_EXTENSIONS = new Set(eslintConfig.includeExtensions || ['.js', '.mjs']);
const IGNORE_DIRS = new Set(
  (eslintConfig.ignore && eslintConfig.ignore.length
    ? eslintConfig.ignore
    : ['node_modules', '.git', '.vscode', '.idea'])
);

const errors = [];

const recordError = (filePath, line, message) => {
  errors.push({ filePath, line, message });
};

const isNullCheck = (token) => token === 'null' || token === 'undefined';

const lintFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (!INCLUDE_EXTENSIONS.has(ext)) return;
  if (filePath.endsWith(`${path.sep}scripts${path.sep}run-eslint.mjs`)) return;
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/[ \t]+$/.test(line)) {
      recordError(filePath, lineNumber, 'Trailing whitespace detected.');
    }
    if (/\bvar\s+[A-Za-z0-9_$]/.test(line)) {
      recordError(filePath, lineNumber, 'Avoid using `var`; prefer `let` or `const`.');
    }
    const looksLikeRegex = line.includes('/==') || line.includes('/!=');
    if (!looksLikeRegex) {
      const looseEqRegex = /(^|[^=!<>])==([^=]|$)/g;
      let matchEq;
      while ((matchEq = looseEqRegex.exec(line)) !== null) {
        const after = line.slice(matchEq.index + matchEq[0].length).trimStart();
        const before = line.slice(0, matchEq.index).trimEnd();
        const rightToken = after.split(/[\s);,]+/)[0];
        const leftToken = before.split(/[\s(]+/).pop();
        if (isNullCheck(rightToken) || isNullCheck(leftToken)) {
          continue;
        }
        recordError(filePath, lineNumber, 'Use strict equality (`===`).');
      }
      const looseNeqRegex = /(^|[^!<>])!=([^=]|$)/g;
      let matchNeq;
      while ((matchNeq = looseNeqRegex.exec(line)) !== null) {
        const after = line.slice(matchNeq.index + matchNeq[0].length).trimStart();
        const before = line.slice(0, matchNeq.index).trimEnd();
        const rightToken = after.split(/[\s);,]+/)[0];
        const leftToken = before.split(/[\s(]+/).pop();
        if (isNullCheck(rightToken) || isNullCheck(leftToken)) {
          continue;
        }
        recordError(filePath, lineNumber, 'Use strict inequality (`!==`).');
      }
    }
  });
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
  lintFile(target);
};

walk(ROOT);

if (errors.length) {
  console.error('Lint failed with the following issues:');
  errors.forEach(({ filePath, line, message }) => {
    console.error(` - ${filePath}:${line} — ${message}`);
  });
  process.exit(1);
}

console.log('Lint passed — no issues detected.');
