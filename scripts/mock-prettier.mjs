#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const write = args.includes('-w') || args.includes('--write');
const targets = args.filter((arg, index) => {
  if (arg === '-w' || arg === '--write') return false;
  const prev = index > 0 ? args[index - 1] : '';
  if (prev === '--log-level') return false;
  return !arg.startsWith('--');
});

const files = [];

const collect = (target) => {
  const full = path.resolve(process.cwd(), target);
  const stats = statSync(full);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(full)) {
      if (entry === 'node_modules' || entry === '.git') continue;
      collect(path.join(target, entry));
    }
  } else if (/\.(js|mjs|json|css|html)$/i.test(target)) {
    files.push(full);
  }
};

if (targets.length === 0) {
  collect('.');
} else {
  for (const target of targets) collect(target);
}

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const formatted = contents.replace(/[ \t]+\n/g, '\n');
  if (write && formatted !== contents) {
    writeFileSync(file, formatted, 'utf8');
  }
}

console.log(`mock-prettier: processed ${files.length} files${write ? ' with write' : ''}`);
