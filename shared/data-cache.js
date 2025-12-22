const CACHE_DB_NAME = "vitruvian.workouts.cache";
const CACHE_DB_VERSION = 1;
const STORE_WORKOUTS = "workouts";
const STORE_WORKOUT_DETAILS = "workoutDetails";
const STORE_METADATA = "metadata";

const memoryStores = {
  workouts: new Map(),
  workoutDetails: new Map(),
  metadata: new Map(),
};

let dbPromise = null;

const supportsIndexedDb = () =>
  typeof indexedDB !== "undefined" && typeof indexedDB.open === "function";

const cloneValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    if (!request) {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionToPromise = (tx) =>
  new Promise((resolve, reject) => {
    if (!tx) {
      resolve();
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });

const openCacheDb = () => {
  if (!supportsIndexedDb()) {
    return Promise.resolve(null);
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORKOUTS)) {
        const store = db.createObjectStore(STORE_WORKOUTS, { keyPath: "path" });
        store.createIndex("timeValue", "timeValue");
      }
      if (!db.objectStoreNames.contains(STORE_WORKOUT_DETAILS)) {
        db.createObjectStore(STORE_WORKOUT_DETAILS, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const withStore = async (storeName, mode, callback) => {
  const db = await openCacheDb();
  if (!db) {
    return callback(null, memoryStores[storeName]);
  }
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await callback(store, null);
  await transactionToPromise(tx);
  return result;
};

const getMetadata = async (key) =>
  withStore(STORE_METADATA, "readonly", async (store, memory) => {
    if (memory) {
      return cloneValue(memory.get(key) || null);
    }
    const result = await requestToPromise(store.get(key));
    return result ? cloneValue(result.value) : null;
  });

const setMetadata = async (key, value) =>
  withStore(STORE_METADATA, "readwrite", async (store, memory) => {
    if (memory) {
      memory.set(key, cloneValue(value));
      return true;
    }
    await requestToPromise(store.put({ key, value }));
    return true;
  });

const deleteMetadata = async (key) =>
  withStore(STORE_METADATA, "readwrite", async (store, memory) => {
    if (memory) {
      memory.delete(key);
      return true;
    }
    await requestToPromise(store.delete(key));
    return true;
  });

const getWorkoutRecordsByPaths = async (paths = []) => {
  const keys = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (keys.length === 0) return [];
  return withStore(STORE_WORKOUTS, "readonly", async (store, memory) => {
    if (memory) {
      return keys.map((path) => cloneValue(memory.get(path) || null)).filter(Boolean);
    }
    const results = [];
    for (const path of keys) {
      const record = await requestToPromise(store.get(path));
      if (record) {
        results.push(cloneValue(record));
      }
    }
    return results;
  });
};

const getAllWorkouts = async () =>
  withStore(STORE_WORKOUTS, "readonly", async (store, memory) => {
    if (memory) {
      return Array.from(memory.values()).map((value) => cloneValue(value));
    }
    if (typeof store.getAll === "function") {
      const records = await requestToPromise(store.getAll());
      return Array.isArray(records) ? records.map((value) => cloneValue(value)) : [];
    }
    const results = [];
    await new Promise((resolve, reject) => {
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cloneValue(cursor.value));
          cursor.continue();
          return;
        }
        resolve();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    return results;
  });

const getLatestWorkouts = async (limit = Infinity) => {
  const target = Number.isFinite(limit) ? Math.max(0, limit) : Infinity;
  return withStore(STORE_WORKOUTS, "readonly", async (store, memory) => {
    if (memory) {
      const records = Array.from(memory.values()).map((value) => cloneValue(value));
      records.sort((a, b) => (b.timeValue || 0) - (a.timeValue || 0));
      return target === Infinity ? records : records.slice(0, target);
    }
    if (!store.indexNames.contains("timeValue")) {
      const records = await getAllWorkouts();
      records.sort((a, b) => (b.timeValue || 0) - (a.timeValue || 0));
      return target === Infinity ? records : records.slice(0, target);
    }
    const index = store.index("timeValue");
    const results = [];
    await new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(null, "prev");
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || (target !== Infinity && results.length >= target)) {
          resolve();
          return;
        }
        results.push(cloneValue(cursor.value));
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    return results;
  });
};

const upsertWorkoutRecords = async (records = []) =>
  withStore(STORE_WORKOUTS, "readwrite", async (store, memory) => {
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (memory) {
      list.forEach((record) => {
        if (record && record.path) {
          memory.set(record.path, cloneValue(record));
        }
      });
      return true;
    }
    await Promise.all(list.map((record) => requestToPromise(store.put(record))));
    return true;
  });

const deleteWorkoutRecords = async (paths = []) =>
  withStore(STORE_WORKOUTS, "readwrite", async (store, memory) => {
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (memory) {
      list.forEach((path) => memory.delete(path));
      return true;
    }
    await Promise.all(list.map((path) => requestToPromise(store.delete(path))));
    return true;
  });

const getWorkoutDetail = async (path) =>
  withStore(STORE_WORKOUT_DETAILS, "readonly", async (store, memory) => {
    if (!path) return null;
    if (memory) {
      return cloneValue(memory.get(path) || null);
    }
    const record = await requestToPromise(store.get(path));
    return record ? cloneValue(record.detail) : null;
  });

const setWorkoutDetail = async (path, detail) =>
  withStore(STORE_WORKOUT_DETAILS, "readwrite", async (store, memory) => {
    if (!path) return false;
    if (memory) {
      memory.set(path, cloneValue(detail));
      return true;
    }
    await requestToPromise(store.put({ path, detail }));
    return true;
  });

const deleteWorkoutDetail = async (path) =>
  withStore(STORE_WORKOUT_DETAILS, "readwrite", async (store, memory) => {
    if (!path) return false;
    if (memory) {
      memory.delete(path);
      return true;
    }
    await requestToPromise(store.delete(path));
    return true;
  });

const cacheApi = {
  supportsIndexedDb,
  getMetadata,
  setMetadata,
  deleteMetadata,
  getWorkoutRecordsByPaths,
  getAllWorkouts,
  getLatestWorkouts,
  upsertWorkoutRecords,
  deleteWorkoutRecords,
  getWorkoutDetail,
  setWorkoutDetail,
  deleteWorkoutDetail,
};

if (typeof globalThis !== "undefined") {
  globalThis.VitruvianCache = {
    ...(globalThis.VitruvianCache || {}),
    ...cacheApi,
  };
}

export default cacheApi;
export {
  supportsIndexedDb,
  getMetadata,
  setMetadata,
  deleteMetadata,
  getWorkoutRecordsByPaths,
  getAllWorkouts,
  getLatestWorkouts,
  upsertWorkoutRecords,
  deleteWorkoutRecords,
  getWorkoutDetail,
  setWorkoutDetail,
  deleteWorkoutDetail,
};
