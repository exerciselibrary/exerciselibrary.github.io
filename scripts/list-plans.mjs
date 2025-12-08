import fs from 'fs';
import path from 'path';

const p = path.resolve(process.cwd(), 'plans.json');
let data;
try {
  data = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  console.error('Failed to read plans.json:', e.message);
  process.exit(1);
}

if (!data || typeof data !== 'object' || !data.plans) {
  console.error('No plans found in plans.json');
  process.exit(1);
}

const names = Object.keys(data.plans);
console.log('Plans in plans.json:', names.join('\n'));

// Print brief summary for each plan (first item names)
for (const name of names) {
  const items = data.plans[name];
  const first = Array.isArray(items) && items.length ? items[0].name || items[0].type : 'empty';
  console.log(`- ${name}: ${items.length} items (first: ${first})`);
}
