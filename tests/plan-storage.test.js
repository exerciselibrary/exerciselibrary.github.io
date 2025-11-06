import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_INDEX_KEY,
  PLAN_STORAGE_PREFIX,
  persistPlanLocally,
  loadLocalPlanEntries,
  removePlanLocally,
  readLocalPlanIndex,
  writeLocalPlanIndex,
} from '../js/plan-storage.js';

class MemoryStorage {
  constructor(initialEntries = {}) {
    this.store = new Map();
    this.getItemCalls = new Map();
    Object.entries(initialEntries).forEach(([key, value]) => {
      this.setItem(key, value);
    });
  }

  get length() {
    return this.store.size;
  }

  key(index) {
    if (index < 0 || index >= this.length) return null;
    return Array.from(this.store.keys())[index] ?? null;
  }

  getItem(key) {
    const normalisedKey = String(key);
    const existing = this.getItemCalls.get(normalisedKey) ?? 0;
    this.getItemCalls.set(normalisedKey, existing + 1);
    return this.store.has(normalisedKey) ? this.store.get(normalisedKey) : null;
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }

  removeItem(key) {
    this.store.delete(String(key));
  }

  getItemCount(key) {
    return this.getItemCalls.get(String(key)) ?? 0;
  }
}

test('persistPlanLocally trims names, stores payload, and returns alphabetised index', () => {
  const storage = new MemoryStorage({
    [PLAN_INDEX_KEY]: JSON.stringify(['Leg Day', 'Upper Body', 'Upper Body']),
  });
  const payload = [
    { id: 'push-up', sets: 3 },
    { id: 'row', sets: 4 },
  ];

  const result = persistPlanLocally('  Upper Body  ', payload, storage);

  assert.equal(result.name, 'Upper Body');
  assert.deepEqual(result.index, ['Leg Day', 'Upper Body']);

  const storedPayload = storage.getItem(`${PLAN_STORAGE_PREFIX}Upper Body`);
  assert.ok(storedPayload, 'payload should be stored under the trimmed key');
  assert.deepEqual(JSON.parse(storedPayload), payload);

  const persistedIndex = JSON.parse(storage.getItem(PLAN_INDEX_KEY));
  assert.deepEqual(persistedIndex, result.index);
});


test('loadLocalPlanEntries deduplicates plans from the index and raw keys', () => {
  const storage = new MemoryStorage({
    [PLAN_INDEX_KEY]: JSON.stringify(['Plan A', 'Plan B', 'Plan A', '  Plan C  ']),
    [`${PLAN_STORAGE_PREFIX}Plan A`]: JSON.stringify([{ id: 'a' }]),
    [`${PLAN_STORAGE_PREFIX}Plan B`]: JSON.stringify([{ id: 'b' }]),
  });

  storage.setItem(`${PLAN_STORAGE_PREFIX}Plan C`, JSON.stringify([{ id: 'c' }]));
  storage.setItem(`${PLAN_STORAGE_PREFIX}Plan D`, JSON.stringify([{ id: 'd' }]));

  const entries = loadLocalPlanEntries(storage);

  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['Plan A', 'Plan B', 'Plan C', 'Plan D']
  );
  assert.deepEqual(entries[0].items, [{ id: 'a' }]);
  assert.deepEqual(entries[1].items, [{ id: 'b' }]);
  assert.deepEqual(entries[2].items, [{ id: 'c' }]);
  assert.deepEqual(entries[3].items, [{ id: 'd' }]);

  assert.equal(storage.getItemCount(`${PLAN_STORAGE_PREFIX}Plan B`), 1);
  assert.equal(storage.getItemCount(`${PLAN_STORAGE_PREFIX}Plan C`), 1);
  assert.equal(storage.getItemCount(`${PLAN_STORAGE_PREFIX}Plan D`), 1);
});


test('removePlanLocally removes payload and prunes the index', () => {
  const storage = new MemoryStorage();
  writeLocalPlanIndex(['Plan A', 'Plan B'], storage);
  persistPlanLocally('Plan A', [{ id: 'a' }], storage);
  persistPlanLocally('Plan B', [{ id: 'b' }], storage);

  removePlanLocally('  Plan B  ', storage);

  assert.equal(storage.getItem(`${PLAN_STORAGE_PREFIX}Plan B`), null);
  const remainingIndex = readLocalPlanIndex(storage);
  assert.deepEqual(remainingIndex, ['Plan A']);
});
