// dropbox.js - Dropbox integration for user-owned cloud storage

class DropboxManager {
  constructor() {
    // IMPORTANT: Replace this with your actual Dropbox App Key
    // Create app at: https://www.dropbox.com/developers/apps
    this.clientId = "6omcza3uejr7cok"; // TODO: Replace with your app key
    this.redirectUri = window.location.origin + window.location.pathname;
    this.dbx = null;
    this.isConnected = false;
    this.onLog = null; // Callback for logging
    this.onConnectionChange = null; // Callback when connection state changes
    this.account = null;
    this._tokenStorageKey = "vitruvian.dropbox.token";
    this._tokenInfo = null;
    this._currentAccessToken = null;
    this._workoutsCursorKey = "vitruvian.dropbox.workoutsCursor";
    this._workoutsCacheUpdatedKey = "vitruvian.dropbox.workoutsCacheUpdatedAt";
    this._workoutsCacheScopeKey = "vitruvian.dropbox.workoutsCacheScope";
    this._cacheApi = null;
    this._maxConcurrentDownloads = 4;
  }

  log(message, type = "info") {
    console.log(`[Dropbox ${type}] ${message}`);
    if (this.onLog) {
      this.onLog(message, type);
    }
  }

  // Initialize - check if we have a stored token or if we're returning from OAuth
  async init() {
    // Check if we're returning from OAuth redirect
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      // Complete OAuth flow
      await this.handleOAuthCallback(code);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    // Check for existing token
    const storedToken = this.getStoredToken();
    if (storedToken?.refreshToken && this.isTokenExpired(storedToken)) {
      try {
        const refreshed = await this.refreshAccessToken(storedToken.refreshToken);
        this.storeToken(refreshed);
      } catch (error) {
        this.log(`Stored token refresh failed: ${error.message}`, "error");
        this.clearStoredToken();
      }
    }

    const tokenInfo = this.getStoredToken();
    if (tokenInfo?.accessToken) {
      try {
        this.applyTokenToClient(tokenInfo);
        const client = await this.ensureDropboxClient();
        const account = await client.usersGetCurrentAccount();
        this.account = account?.result || null;
        this.isConnected = true;
        this.log("Restored Dropbox connection from stored token", "success");
        this.notifyConnectionChange();
      } catch (error) {
        this.log("Stored token is invalid, clearing", "error");
        this.clearStoredToken();
        this.isConnected = false;
        this.notifyConnectionChange();
      }
    }
  }

  // Start OAuth flow with PKCE
  async connect() {
    if (this.clientId === "YOUR_DROPBOX_APP_KEY") {
      alert(
        "Dropbox integration not configured. Please set your Dropbox App Key in dropbox.js\n\n" +
        "Steps:\n" +
        "1. Create app at https://www.dropbox.com/developers/apps\n" +
        "2. Choose 'Scoped access' and 'App folder' access\n" +
        "3. Copy App key and replace YOUR_DROPBOX_APP_KEY in dropbox.js"
      );
      return;
    }

    this.log("Starting Dropbox OAuth flow...", "info");

    // Generate PKCE code verifier and challenge
    const verifier = this.generateCodeVerifier();
    const challenge = await this.generateCodeChallenge(verifier);

    // Store verifier for later
    sessionStorage.setItem("pkce_verifier", verifier);

    // Build authorization URL
    const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
    authUrl.searchParams.append("client_id", this.clientId);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("code_challenge", challenge);
    authUrl.searchParams.append("code_challenge_method", "S256");
    authUrl.searchParams.append("redirect_uri", this.redirectUri);
    authUrl.searchParams.append("token_access_type", "offline"); // Get refresh token

    // Redirect to Dropbox
    window.location.href = authUrl.toString();
  }

  // Handle OAuth callback with authorization code
  async handleOAuthCallback(code) {
    this.log("Handling OAuth callback...", "info");

    const verifier = sessionStorage.getItem("pkce_verifier");
    if (!verifier) {
      this.log("Missing PKCE verifier in session", "error");
      return;
    }

    try {
      // Exchange authorization code for access token
      const response = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code: code,
          grant_type: "authorization_code",
          code_verifier: verifier,
          client_id: this.clientId,
          redirect_uri: this.redirectUri,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      const data = await response.json();
      const tokenInfo = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      };

      // Store token
      this.storeToken(tokenInfo);

      // Initialize Dropbox SDK
      this.applyTokenToClient(tokenInfo);
      this.isConnected = true;

      // Get user info
      const client = await this.ensureDropboxClient();
      const account = await client.usersGetCurrentAccount();
      this.account = account?.result || null;
      this.log(`Connected to Dropbox as ${account.result.name.display_name}`, "success");

      // Create app folder structure
      await this.initializeFolderStructure();

      this.notifyConnectionChange();

      // Clean up session storage
      sessionStorage.removeItem("pkce_verifier");
    } catch (error) {
      this.log(`OAuth callback failed: ${error.message}`, "error");
      throw error;
    }
  }

  // Disconnect from Dropbox
  disconnect() {
    this.clearStoredToken();
    this.dbx = null;
    this.isConnected = false;
    this.account = null;
    this._currentAccessToken = null;
    this.log("Disconnected from Dropbox", "info");
    this.notifyConnectionChange();
  }

  // Initialize folder structure in user's Dropbox
  async initializeFolderStructure() {
    const client = await this.ensureDropboxClient();
    try {
      // Create /workouts folder if it doesn't exist
      await client.filesCreateFolderV2({ path: "/workouts" });
      this.log("Created /workouts folder", "success");
    } catch (error) {
      if (error.error?.error[".tag"] === "path" && error.error.error.path[".tag"] === "conflict") {
        // Folder already exists, that's fine
        this.log("Workouts folder already exists", "info");
      } else {
        this.log(`Failed to create folder: ${error.message}`, "error");
      }
    }

    try {
      await client.filesCreateFolderV2({ path: "/workouts/detail" });
      this.log("Created /workouts/detail folder", "success");
    } catch (error) {
      if (error.error?.error[".tag"] === "path" && error.error.error.path[".tag"] === "conflict") {
        this.log("Workouts detail folder already exists", "info");
      } else {
        this.log(`Failed to create workouts detail folder: ${error.message}`, "error");
      }
    }

    try {
      await client.filesCreateFolderV2({ path: "/plans" });
      this.log("Created /plans folder", "success");
    } catch (error) {
      if (error.error?.error[".tag"] === "path" && error.error.error.path[".tag"] === "conflict") {
        this.log("Plans folder already exists", "info");
      } else {
        this.log(`Failed to create plans folder: ${error.message}`, "error");
      }
    }

    try {
      await client.filesCreateFolderV2({ path: "/custom_exercises" });
      this.log("Created /custom_exercises folder", "success");
    } catch (error) {
      if (error.error?.error[".tag"] === "path" && error.error.error.path[".tag"] === "conflict") {
        this.log("Custom exercises folder already exists", "info");
      } else {
        this.log(`Failed to create custom exercises folder: ${error.message}`, "error");
      }
    }
  }

  getCacheApi() {
    if (this._cacheApi !== null) {
      return this._cacheApi;
    }
    const cache = typeof globalThis !== "undefined" ? globalThis.VitruvianCache : null;
    this._cacheApi = cache && typeof cache.getMetadata === "function" ? cache : null;
    return this._cacheApi;
  }

  async getCachedValue(key) {
    const cache = this.getCacheApi();
    if (cache && typeof cache.getMetadata === "function") {
      try {
        const value = await cache.getMetadata(key);
        if (value !== null && value !== undefined) {
          return value;
        }
      } catch {
        /* fall through to localStorage */
      }
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch {
      return null;
    }
  }

  async setCachedValue(key, value) {
    const cache = this.getCacheApi();
    if (cache && typeof cache.setMetadata === "function") {
      try {
        await cache.setMetadata(key, value);
      } catch {
        /* ignore cache write errors */
      }
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore storage write errors */
    }
  }

  async deleteCachedValue(key) {
    const cache = this.getCacheApi();
    if (cache && typeof cache.deleteMetadata === "function") {
      try {
        await cache.deleteMetadata(key);
      } catch {
        /* ignore cache delete errors */
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore storage delete errors */
    }
  }

  workoutsIndexPath() {
    return "/workouts/index.json";
  }

  workoutsDetailDir() {
    return "/workouts/detail";
  }

  resolveWorkoutTimestamp(workout) {
    const candidates = [
      workout?.timestamp,
      workout?.endTime,
      workout?.startTime,
    ];
    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate;
      }
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    return new Date();
  }

  buildWorkoutFilename(timestamp) {
    const value = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
    return `workout_${value.toISOString().replace(/[:.]/g, "-")}.json`;
  }

  buildMovementDataFilename(timestamp) {
    const value = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
    return `workout_${value.toISOString().replace(/[:.]/g, "-")}_movement.json`;
  }

  buildMovementDataPath(workout) {
    const timestamp = this.resolveWorkoutTimestamp(workout);
    return `${this.workoutsDetailDir()}/${this.buildMovementDataFilename(timestamp)}`;
  }

  normalizeWorkoutDates(workout) {
    if (!workout || typeof workout !== "object") {
      return workout;
    }
    const toDate = (value) => {
      if (!value) return null;
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    if (workout.timestamp) workout.timestamp = toDate(workout.timestamp);
    if (workout.startTime) workout.startTime = toDate(workout.startTime);
    if (workout.warmupEndTime) workout.warmupEndTime = toDate(workout.warmupEndTime);
    if (workout.endTime) workout.endTime = toDate(workout.endTime);
    return workout;
  }

  normalizeMovementDataPoints(points = []) {
    if (!Array.isArray(points)) {
      return [];
    }
    const toDate = (value) => {
      if (!value) return null;
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const toNumber = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };
    return points
      .map((point) => {
        if (!point || typeof point !== "object") return null;
        const ts = toDate(point.timestamp);
        if (!ts) return null;
        return {
          timestamp: ts,
          loadA: toNumber(point.loadA),
          loadB: toNumber(point.loadB),
          posA: toNumber(point.posA),
          posB: toNumber(point.posB),
        };
      })
      .filter(Boolean);
  }

  getWorkoutTimeValue(workout) {
    const timestamp = this.resolveWorkoutTimestamp(workout);
    return timestamp instanceof Date ? timestamp.getTime() : 0;
  }

  async listWorkoutsDelta(options = {}) {
    const client = await this.ensureDropboxClient();
    const ignoreCursor = options.ignoreCursor === true;
    let cursor = ignoreCursor ? null : await this.getCachedValue(this._workoutsCursorKey);
    let response = null;
    let usedCursor = false;

    if (cursor) {
      try {
        response = await client.filesListFolderContinue({ cursor });
        usedCursor = true;
      } catch (error) {
        const summary = error?.error?.error_summary || "";
        if (summary.includes("reset") || summary.includes("not_found")) {
          this.log("Dropbox delta cursor reset; running full listing", "warning");
          await this.deleteCachedValue(this._workoutsCursorKey);
          cursor = null;
        } else {
          throw error;
        }
      }
    }

    if (!response) {
      response = await client.filesListFolder({
        path: "/workouts",
        recursive: false,
        include_deleted: true,
      });
    }

    const entries = [...(response.result.entries || [])];
    let nextCursor = response.result.cursor;

    while (response.result.has_more) {
      response = await client.filesListFolderContinue({ cursor: nextCursor });
      nextCursor = response.result.cursor;
      entries.push(...(response.result.entries || []));
    }

    if (nextCursor) {
      await this.setCachedValue(this._workoutsCursorKey, nextCursor);
    }

    return { entries, usedCursor };
  }

  isWorkoutSummaryEntry(entry) {
    if (!entry || entry[".tag"] !== "file") return false;
    if (!entry.name || !entry.name.endsWith(".json")) return false;
    if (entry.name === "index.json") return false;
    if (!entry.name.startsWith("workout_")) return false;
    if (entry.name.includes("_movement")) return false;
    return true;
  }

  isWorkoutPath(path) {
    if (typeof path !== "string") return false;
    if (!path.includes("/workouts/")) return false;
    if (!path.endsWith(".json")) return false;
    if (path.endsWith("/index.json")) return false;
    if (path.includes("_movement")) return false;
    return true;
  }

  async runWithConcurrency(items, limit, handler) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];
    const max = Number.isFinite(limit) ? Math.max(1, limit) : this._maxConcurrentDownloads;
    const count = Math.min(max, list.length);
    const results = new Array(list.length);
    let index = 0;

    const workers = Array.from({ length: count }, async () => {
      while (index < list.length) {
        const currentIndex = index;
        const item = list[currentIndex];
        index += 1;
        results[currentIndex] = await handler(item, currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }

  buildWorkoutPayload(workout) {
    const summary = { ...(workout || {}) };
    const movementData = Array.isArray(workout?.movementData)
      ? workout.movementData
      : [];
    const existingPath =
      typeof workout?.movementDataPath === "string"
        ? workout.movementDataPath
        : null;
    const movementDataCount =
      movementData.length > 0
        ? movementData.length
        : Number.isFinite(Number(workout?.movementDataCount))
          ? Number(workout.movementDataCount)
          : 0;
    const detailPath = movementData.length > 0
      ? existingPath || this.buildMovementDataPath(workout)
      : existingPath;

    summary.movementData = [];
    summary.movementDataPath = detailPath || null;
    summary.movementDataCount = movementDataCount;

    const detailPayload = movementData.length > 0
      ? {
          path: detailPath,
          contents: JSON.stringify({ movementData }),
          mode: existingPath ? "overwrite" : "add",
        }
      : null;

    return { summary, detailPayload };
  }

  async loadWorkoutsIndex() {
    const client = await this.ensureDropboxClient();
    try {
      const response = await client.filesDownload({ path: this.workoutsIndexPath() });
      const fileBlob = response.result.fileBlob;
      const text = await fileBlob.text();
      const data = JSON.parse(text);
      const workouts = Array.isArray(data?.workouts)
        ? data.workouts
        : Array.isArray(data)
          ? data
          : [];
      return {
        version: data?.version ?? 1,
        updatedAt: data?.updatedAt ?? null,
        workouts,
        exists: true,
      };
    } catch (error) {
      const summary = error?.error?.error_summary || "";
      if (summary.includes("path/not_found/")) {
        return { version: 1, updatedAt: null, workouts: [], exists: false };
      }
      throw error;
    }
  }

  async saveWorkoutsIndex(indexPayload) {
    const payload = {
      version: indexPayload?.version ?? 1,
      updatedAt: indexPayload?.updatedAt ?? new Date().toISOString(),
      workouts: Array.isArray(indexPayload?.workouts) ? indexPayload.workouts : [],
    };
    const client = await this.ensureDropboxClient();
    await client.filesUpload({
      path: this.workoutsIndexPath(),
      contents: JSON.stringify(payload, null, 2),
      mode: { ".tag": "overwrite" },
    });
    return true;
  }

  buildWorkoutsIndexEntry(workout, metadata = {}) {
    return {
      path: metadata.path || metadata.path_lower || null,
      name: metadata.name || null,
      id: metadata.id || null,
      rev: metadata.rev || null,
      serverModified: metadata.server_modified || metadata.serverModified || null,
      clientModified: metadata.client_modified || metadata.clientModified || null,
      workout: workout || null,
    };
  }

  buildCacheRecord(metadata = {}, workout) {
    return {
      path: metadata.path || metadata.path_lower || null,
      name: metadata.name || null,
      id: metadata.id || null,
      rev: metadata.rev || null,
      serverModified: metadata.server_modified || metadata.serverModified || null,
      clientModified: metadata.client_modified || metadata.clientModified || null,
      timeValue: this.getWorkoutTimeValue(workout),
      workout: workout || null,
    };
  }

  async updateWorkoutsIndexEntry(workout, metadata = {}) {
    try {
      const index = await this.loadWorkoutsIndex();
      const workouts = Array.isArray(index.workouts) ? index.workouts : [];
      const entry = this.buildWorkoutsIndexEntry(workout, metadata);
      const entryPath = entry.path;
      if (entryPath) {
        const existingIndex = workouts.findIndex((item) => {
          const path = item?.path || item?.path_lower;
          return path === entryPath;
        });
        if (existingIndex >= 0) {
          workouts[existingIndex] = entry;
        } else {
          workouts.push(entry);
        }
      } else {
        workouts.push(entry);
      }
      index.workouts = workouts;
      index.updatedAt = new Date().toISOString();
      await this.saveWorkoutsIndex(index);
    } catch (error) {
      this.log(`Failed to update workouts index: ${error.message}`, "warning");
    }
  }

  async removeWorkoutsIndexEntry(path) {
    if (!path) return;
    try {
      const index = await this.loadWorkoutsIndex();
      if (!index.exists) return;
      const workouts = Array.isArray(index.workouts) ? index.workouts : [];
      const next = workouts.filter((entry) => {
        const entryPath = entry?.path || entry?.path_lower;
        return entryPath !== path;
      });
      index.workouts = next;
      index.updatedAt = new Date().toISOString();
      await this.saveWorkoutsIndex(index);
    } catch (error) {
      this.log(`Failed to remove workout from index: ${error.message}`, "warning");
    }
  }

  async cacheWorkoutRecords(records = []) {
    const cache = this.getCacheApi();
    if (!cache || typeof cache.upsertWorkoutRecords !== "function") {
      return;
    }
    try {
      const list = Array.isArray(records)
        ? records.filter((record) => record && record.path)
        : [];
      if (list.length === 0) {
        return;
      }
      await cache.upsertWorkoutRecords(list);
      await this.setCachedValue(this._workoutsCacheUpdatedKey, new Date().toISOString());
    } catch {
      /* ignore cache errors */
    }
  }

  async deleteCachedWorkoutRecords(paths = []) {
    const cache = this.getCacheApi();
    if (!cache || typeof cache.deleteWorkoutRecords !== "function") {
      return;
    }
    try {
      await cache.deleteWorkoutRecords(paths);
    } catch {
      /* ignore cache errors */
    }
  }

  async getCachedWorkouts(options = {}) {
    const cache = this.getCacheApi();
    if (!cache || typeof cache.getLatestWorkouts !== "function") {
      return [];
    }
    const limit = Number.isFinite(options.maxEntries)
      ? options.maxEntries
      : options.maxEntries === Infinity
        ? Infinity
        : Infinity;
    try {
      const records = await cache.getLatestWorkouts(limit);
      return records
        .map((record) => {
          if (!record || !record.workout) return null;
          const workout = record.workout;
          this.normalizeWorkoutDates(workout);
          this.attachDropboxMetadata(workout, {
            path: record.path,
            name: record.name,
            id: record.id,
            rev: record.rev,
          });
          return workout;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async getCachedWorkoutsUpdatedAt() {
    const cached = await this.getCachedValue(this._workoutsCacheUpdatedKey);
    if (!cached) return null;
    const parsed = new Date(cached);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  async loadWorkoutMovementData(path) {
    if (!path) {
      return [];
    }
    const cache = this.getCacheApi();
    if (cache && typeof cache.getWorkoutDetail === "function") {
      try {
        const cached = await cache.getWorkoutDetail(path);
        if (Array.isArray(cached) && cached.length > 0) {
          return this.normalizeMovementDataPoints(cached);
        }
      } catch {
        /* fall through to Dropbox */
      }
    }
    const client = await this.ensureDropboxClient();
    const response = await client.filesDownload({ path });
    const fileBlob = response.result.fileBlob;
    const text = await fileBlob.text();
    const data = JSON.parse(text);
    const movementData = Array.isArray(data?.movementData)
      ? data.movementData
      : Array.isArray(data)
        ? data
        : [];
    const normalized = this.normalizeMovementDataPoints(movementData);
    if (cache && typeof cache.setWorkoutDetail === "function") {
      try {
        await cache.setWorkoutDetail(path, normalized);
      } catch {
        /* ignore cache errors */
      }
    }
    return normalized;
  }

  // Save workout to Dropbox
  async saveWorkout(workout) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      // Generate filename with timestamp
      const timestamp = this.resolveWorkoutTimestamp(workout);
      const filename = this.buildWorkoutFilename(timestamp);
      const path = `/workouts/${filename}`;

      const result = await this.persistWorkoutPayload({
        workout,
        path,
        mode: "add",
        autorename: true,
      });

      const savedName = result?.metadata?.name || filename;
      this.log(`Saved workout: ${savedName}`, "success");
      return true;
    } catch (error) {
      this.log(`Failed to save workout: ${error.message}`, "error");
      throw error;
    }
  }

  async overwriteWorkout(workout) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      // Get the original path from metadata
      const originalPath = workout?._dropboxMetadata?.path;
      if (!originalPath) {
        throw new Error("No Dropbox path metadata found. Cannot overwrite.");
      }

      const result = await this.persistWorkoutPayload({
        workout,
        path: originalPath,
        mode: "overwrite",
      });
      const name = result?.metadata?.name || workout?._dropboxMetadata?.name || originalPath;
      this.log(`Overwritten workout: ${name}`, "success");
      return true;
    } catch (error) {
      this.log(`Failed to overwrite workout: ${error.message}`, "error");
      throw error;
    }
  }

  async persistWorkoutPayload({ workout, path, mode, autorename = false }) {
    const client = await this.ensureDropboxClient();
    const payload = this.buildWorkoutPayload(workout);
    const summary = payload.summary || {};
    const normalized = this.normalizeWorkoutDates({ ...summary });
    let metadata = {};
    let resolvedPath = path;
    let detailPath = payload.detailPayload?.path || null;
    let detailCount = Number.isFinite(Number(normalized.movementDataCount))
      ? Number(normalized.movementDataCount)
      : Array.isArray(workout?.movementData)
        ? workout.movementData.length
        : 0;

    if (payload.detailPayload && payload.detailPayload.path) {
      const detailResponse = await client.filesUpload({
        path: payload.detailPayload.path,
        contents: payload.detailPayload.contents,
        mode: { ".tag": payload.detailPayload.mode || "overwrite" },
        autorename: payload.detailPayload.mode !== "overwrite",
      });
      const detailMetadata =
        detailResponse?.result?.metadata || detailResponse?.result || {};
      detailPath = detailMetadata.path_lower || detailMetadata.path || payload.detailPayload.path;
      detailCount = Number.isFinite(Number(normalized.movementDataCount))
        ? Number(normalized.movementDataCount)
        : Array.isArray(workout?.movementData)
          ? workout.movementData.length
          : 0;
      summary.movementDataPath = detailPath;
      summary.movementDataCount = detailCount;
      normalized.movementDataPath = detailPath;
      normalized.movementDataCount = detailCount;

      const cache = this.getCacheApi();
      if (cache && typeof cache.setWorkoutDetail === "function") {
        try {
          const detailPoints = Array.isArray(workout?.movementData)
            ? workout.movementData
            : [];
          if (detailPoints.length > 0) {
            await cache.setWorkoutDetail(detailPath, detailPoints);
          }
        } catch {
          /* ignore cache errors */
        }
      }
    }

    const contents = JSON.stringify(summary, null, 2);
    const response = await client.filesUpload({
      path,
      contents,
      mode: { ".tag": mode || "overwrite" },
      autorename: Boolean(autorename),
    });
    metadata = response?.result?.metadata || response?.result || metadata;
    resolvedPath = metadata.path_lower || metadata.path || path;
    this.attachDropboxMetadata(normalized, {
      path: resolvedPath,
      name: metadata.name || null,
      id: metadata.id || null,
      rev: metadata.rev || null,
    });

    const cacheRecord = this.buildCacheRecord(
      {
        path: resolvedPath,
        name: metadata.name || null,
        id: metadata.id || null,
        rev: metadata.rev || null,
        server_modified: metadata.server_modified || metadata.serverModified || null,
        client_modified: metadata.client_modified || metadata.clientModified || null,
      },
      normalized,
    );
    await this.cacheWorkoutRecords([cacheRecord]);
    await this.updateWorkoutsIndexEntry(normalized, {
      path: resolvedPath,
      name: metadata.name || null,
      id: metadata.id || null,
      rev: metadata.rev || null,
      server_modified: metadata.server_modified || metadata.serverModified || null,
      client_modified: metadata.client_modified || metadata.clientModified || null,
    });
    return { summary: normalized, metadata };
  }

  // Load workouts from Dropbox. By default returns latest 25, but maxEntries can override.
  async loadWorkouts(options = {}) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      this.log("Loading workouts from Dropbox...", "info");

      const requestedMax =
        typeof options.maxEntries === "number"
          ? options.maxEntries
          : options.maxEntries === Infinity
            ? Infinity
            : 25;
      const enforceLimit = Number.isFinite(requestedMax);
      const maxWorkoutsToSync = enforceLimit ? requestedMax : Infinity;
      const useCache = options.useCache !== false;
      const useIndex = options.useIndex !== false;
      const useIncremental = options.useIncremental !== false;
      const includeMovementData = options.includeMovementData === true;
      const preferCache = options.preferCache !== false;
      const downloadConcurrency = Number.isFinite(options.downloadConcurrency)
        ? options.downloadConcurrency
        : this._maxConcurrentDownloads;

      const cache = this.getCacheApi();
      const cacheAvailable = Boolean(
        useCache &&
        cache &&
        typeof cache.getLatestWorkouts === "function" &&
        typeof cache.getWorkoutRecordsByPaths === "function",
      );
      const cacheScope = cacheAvailable
        ? await this.getCachedValue(this._workoutsCacheScopeKey)
        : null;
      const cacheComplete = cacheScope?.complete === true;
      const limitDownloads = enforceLimit && options.limitDownloads !== false;
      const needsFullCache = !enforceLimit && cacheAvailable && !cacheComplete;

      if (!cacheAvailable) {
        if (useIndex) {
          try {
            const index = await this.loadWorkoutsIndex();
            if (Array.isArray(index?.workouts) && index.workouts.length > 0) {
              let workouts = index.workouts
                .map((entry) => {
                  const workoutPayload = entry?.workout || entry?.summary || null;
                  if (!workoutPayload) return null;
                  const workout = this.normalizeWorkoutDates({ ...workoutPayload });
                  if (!Number.isFinite(Number(workout.movementDataCount))) {
                    workout.movementDataCount = Array.isArray(workout.movementData)
                      ? workout.movementData.length
                      : 0;
                  }
                  this.attachDropboxMetadata(workout, {
                    path: entry?.path || entry?.path_lower || null,
                    name: entry?.name || null,
                    id: entry?.id || null,
                    rev: entry?.rev || null,
                  });
                  return workout;
                })
                .filter(Boolean);

              workouts.sort((a, b) => {
                const timeA = (a.timestamp || a.endTime || new Date(0)).getTime();
                const timeB = (b.timestamp || b.endTime || new Date(0)).getTime();
                return timeB - timeA;
              });

              if (enforceLimit && workouts.length > maxWorkoutsToSync) {
                workouts = workouts.slice(0, maxWorkoutsToSync);
              }

              if (includeMovementData) {
                const detailConcurrency = Number.isFinite(options.detailConcurrency)
                  ? options.detailConcurrency
                  : 2;
                const pending = workouts.filter((workout) => {
                  const hasMovement = Array.isArray(workout?.movementData) && workout.movementData.length > 0;
                  return !hasMovement && typeof workout?.movementDataPath === "string";
                });
                await this.runWithConcurrency(pending, detailConcurrency, async (workout) => {
                  try {
                    const movementData = await this.loadWorkoutMovementData(workout.movementDataPath);
                    workout.movementData = movementData;
                    workout.movementDataCount = movementData.length;
                  } catch (error) {
                    this.log(`Failed to load movement data: ${error.message}`, "warning");
                  }
                  return workout;
                });
              }

              this.log(`Loaded ${workouts.length} workouts`, "success");
              return workouts;
            }
          } catch (error) {
            this.log(`Failed to read workouts index: ${error.message}`, "warning");
          }
        }
        return await this.loadWorkoutsLegacy(options);
      }

      const ignoreCursor = !useIncremental || needsFullCache;
      const delta = await this.listWorkoutsDelta({ ignoreCursor });
      const deltaEntries = Array.isArray(delta?.entries) ? delta.entries : [];
      const usedCursor = !ignoreCursor && Boolean(delta?.usedCursor);

      const deletedPaths = [];
      const fileEntries = [];
      deltaEntries.forEach((entry) => {
        if (!entry) return;
        if (entry[".tag"] === "deleted") {
          if (this.isWorkoutPath(entry.path_lower)) {
            deletedPaths.push(entry.path_lower);
          }
          return;
        }
        if (this.isWorkoutSummaryEntry(entry)) {
          fileEntries.push(entry);
        }
      });

      const shouldLimitDownloads = limitDownloads && !usedCursor && maxWorkoutsToSync !== Infinity;
      let scopedEntries = fileEntries;
      if (shouldLimitDownloads && fileEntries.length > maxWorkoutsToSync) {
        scopedEntries = [...fileEntries].sort((a, b) => {
          const aTime = new Date(a.server_modified || a.client_modified || 0).getTime();
          const bTime = new Date(b.server_modified || b.client_modified || 0).getTime();
          return bTime - aTime;
        });
        scopedEntries = scopedEntries.slice(0, maxWorkoutsToSync);
      }

      let indexMap = null;
      if (useIndex && !usedCursor) {
        try {
          const index = await this.loadWorkoutsIndex();
          if (Array.isArray(index?.workouts)) {
            indexMap = new Map();
            index.workouts.forEach((entry) => {
              const path = entry?.path || entry?.path_lower;
              if (path) {
                indexMap.set(path, entry);
              }
            });
          }
        } catch (error) {
          this.log(`Failed to load workouts index: ${error.message}`, "warning");
        }
      }

      let cachedRecords = [];
      if (cacheAvailable && scopedEntries.length > 0) {
        try {
          cachedRecords = await cache.getWorkoutRecordsByPaths(
            scopedEntries.map((entry) => entry.path_lower).filter(Boolean),
          );
        } catch {
          cachedRecords = [];
        }
      }

      const cachedByPath = new Map(
        cachedRecords
          .filter((record) => record && record.path)
          .map((record) => [record.path, record]),
      );

      const recordsToUpsert = [];
      const downloads = [];

      for (const entry of scopedEntries) {
        const path = entry.path_lower;
        const cached = cachedByPath.get(path);
        if (cached && cached.rev && entry.rev && cached.rev === entry.rev) {
          continue;
        }

        if (indexMap && indexMap.has(path)) {
          const indexEntry = indexMap.get(path);
          const workoutPayload = indexEntry?.workout || indexEntry?.summary || null;
          if (workoutPayload && indexEntry?.rev === entry.rev) {
            const workout = this.normalizeWorkoutDates({ ...workoutPayload });
            if (!Number.isFinite(Number(workout.movementDataCount))) {
              workout.movementDataCount = Array.isArray(workout.movementData)
                ? workout.movementData.length
                : 0;
            }
            this.attachDropboxMetadata(workout, {
              path,
              name: entry.name || indexEntry?.name || null,
              id: entry.id || indexEntry?.id || null,
              rev: entry.rev || indexEntry?.rev || null,
            });
            recordsToUpsert.push(
              this.buildCacheRecord(
                {
                  path,
                  name: entry.name || indexEntry?.name || null,
                  id: entry.id || indexEntry?.id || null,
                  rev: entry.rev || indexEntry?.rev || null,
                  server_modified: entry.server_modified || indexEntry?.serverModified || null,
                  client_modified: entry.client_modified || indexEntry?.clientModified || null,
                },
                workout,
              ),
            );
            continue;
          }
        }

        downloads.push(entry);
      }

      if (downloads.length > 0) {
        const client = await this.ensureDropboxClient();
        const downloadResults = await this.runWithConcurrency(
          downloads,
          downloadConcurrency,
          async (file) => {
            try {
              const downloadResponse = await client.filesDownload({ path: file.path_lower });
              const fileBlob = downloadResponse.result.fileBlob;
              const text = await fileBlob.text();
              const workout = JSON.parse(text);
              this.normalizeWorkoutDates(workout);
              if (!Number.isFinite(Number(workout.movementDataCount))) {
                workout.movementDataCount = Array.isArray(workout.movementData)
                  ? workout.movementData.length
                  : 0;
              }
              this.attachDropboxMetadata(workout, {
                path: file.path_lower,
                name: file.name,
                id: file.id,
                rev: downloadResponse?.result?.rev || downloadResponse?.result?.metadata?.rev || file.rev || null,
              });
              return this.buildCacheRecord(
                {
                  path: file.path_lower,
                  name: file.name,
                  id: file.id,
                  rev: downloadResponse?.result?.rev || downloadResponse?.result?.metadata?.rev || file.rev || null,
                  server_modified: file.server_modified || null,
                  client_modified: file.client_modified || null,
                },
                workout,
              );
            } catch (error) {
              this.log(`Failed to load ${file.name}: ${error.message}`, "error");
              return null;
            }
          },
        );
        downloadResults.forEach((record) => {
          if (record) {
            recordsToUpsert.push(record);
          }
        });
      }

      if (recordsToUpsert.length > 0) {
        await this.cacheWorkoutRecords(recordsToUpsert);
      }

      if (deletedPaths.length > 0) {
        await this.deleteCachedWorkoutRecords(deletedPaths);
        for (const path of deletedPaths) {
          await this.removeWorkoutsIndexEntry(path);
        }
      }

      let workouts = [];
      if (cacheAvailable && preferCache) {
        workouts = await this.getCachedWorkouts({ maxEntries: maxWorkoutsToSync });
      } else {
        workouts = recordsToUpsert
          .map((record) => record?.workout)
          .filter(Boolean);
      }

      if (includeMovementData) {
        const detailConcurrency = Number.isFinite(options.detailConcurrency)
          ? options.detailConcurrency
          : 2;
        const pending = workouts.filter((workout) => {
          const hasMovement = Array.isArray(workout?.movementData) && workout.movementData.length > 0;
          return !hasMovement && typeof workout?.movementDataPath === "string";
        });
        await this.runWithConcurrency(pending, detailConcurrency, async (workout) => {
          try {
            const movementData = await this.loadWorkoutMovementData(workout.movementDataPath);
            workout.movementData = movementData;
            workout.movementDataCount = movementData.length;
          } catch (error) {
            this.log(`Failed to load movement data: ${error.message}`, "warning");
          }
          return workout;
        });
      }

      if (enforceLimit && workouts.length > maxWorkoutsToSync) {
        workouts = workouts.slice(0, maxWorkoutsToSync);
      }

      if (cacheAvailable) {
        const cacheStamp = new Date().toISOString();
        const nextCacheComplete = shouldLimitDownloads
          ? false
          : cacheComplete || !usedCursor;
        await this.setCachedValue(this._workoutsCacheUpdatedKey, cacheStamp);
        await this.setCachedValue(this._workoutsCacheScopeKey, {
          complete: nextCacheComplete,
          maxEntries: shouldLimitDownloads ? maxWorkoutsToSync : null,
          updatedAt: cacheStamp,
        });
      }

      this.log(`Loaded ${workouts.length} workouts`, "success");
      return workouts;
    } catch (error) {
      this.log(`Failed to load workouts: ${error.message}`, "error");
      throw error;
    }
  }

  async loadWorkoutsLegacy(options = {}) {
    const client = await this.ensureDropboxClient();
    const requestedMax =
      typeof options.maxEntries === "number"
        ? options.maxEntries
        : options.maxEntries === Infinity
          ? Infinity
          : 25;
    const enforceLimit = Number.isFinite(requestedMax);
    const maxWorkoutsToSync = enforceLimit ? requestedMax : Infinity;
    const topFiles = [];
    let totalFileCount = 0;

    const considerEntries = (entries) => {
      for (const entry of entries) {
        if (this.isWorkoutSummaryEntry(entry)) {
          totalFileCount += 1;
          topFiles.push(entry);
        }
      }

      topFiles.sort((a, b) => {
        const aTime = new Date(a.server_modified || a.client_modified || 0).getTime();
        const bTime = new Date(b.server_modified || b.client_modified || 0).getTime();
        return bTime - aTime;
      });

      if (enforceLimit && topFiles.length > maxWorkoutsToSync) {
        topFiles.length = maxWorkoutsToSync;
      }
    };

    let response = await client.filesListFolder({ path: "/workouts" });
    considerEntries(response.result.entries || []);
    let cursor = response.result.cursor;

    while (response.result.has_more) {
      response = await client.filesListFolderContinue({ cursor });
      cursor = response.result.cursor;
      considerEntries(response.result.entries || []);
    }

    this.log(`Found ${totalFileCount} workout files`, "info");

    if (enforceLimit && totalFileCount > maxWorkoutsToSync) {
      this.log(
        `Limiting sync to the latest ${maxWorkoutsToSync} workouts`,
        "info",
      );
    }

    const workouts = [];
    const downloadResults = await this.runWithConcurrency(
      topFiles,
      this._maxConcurrentDownloads,
      async (file) => {
        try {
          const downloadResponse = await client.filesDownload({ path: file.path_lower });
          const fileBlob = downloadResponse.result.fileBlob;
          const text = await fileBlob.text();
          const workout = JSON.parse(text);
          this.normalizeWorkoutDates(workout);
          if (!Number.isFinite(Number(workout.movementDataCount))) {
            workout.movementDataCount = Array.isArray(workout.movementData)
              ? workout.movementData.length
              : 0;
          }
          this.attachDropboxMetadata(workout, {
            path: file.path_lower,
            name: file.name,
            id: file.id,
            rev: downloadResponse?.result?.rev || downloadResponse?.result?.metadata?.rev || file.rev || null,
          });
          return workout;
        } catch (error) {
          this.log(`Failed to load ${file.name}: ${error.message}`, "error");
          return null;
        }
      },
    );

    downloadResults.forEach((workout) => {
      if (workout) {
        workouts.push(workout);
      }
    });

    workouts.sort((a, b) => {
      const timeA = (a.timestamp || a.endTime || new Date(0)).getTime();
      const timeB = (b.timestamp || b.endTime || new Date(0)).getTime();
      return timeB - timeA;
    });

    this.log(`Loaded ${workouts.length} workouts`, "success");
    return workouts;
  }

  attachDropboxMetadata(workout, metadata = {}) {
    if (!workout || typeof workout !== "object") {
      return;
    }
    const descriptor = {
      path: metadata.path || null,
      name: metadata.name || null,
      id: metadata.id || null,
      rev: metadata.rev || null,
    };
    Object.defineProperty(workout, "_dropboxMetadata", {
      value: descriptor,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  async overwriteWorkoutFile(path, workout) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }
    const normalizedPath = typeof path === "string" ? path.trim() : "";
    if (!normalizedPath) {
      throw new Error("Invalid Dropbox workout path");
    }
    const result = await this.persistWorkoutPayload({
      workout,
      path: normalizedPath,
      mode: "overwrite",
    });
    if (workout && typeof workout === "object" && workout._dropboxMetadata) {
      workout._dropboxMetadata.rev =
        result?.metadata?.rev || workout._dropboxMetadata.rev || null;
      workout._dropboxMetadata.path =
        result?.metadata?.path_lower || result?.metadata?.path || normalizedPath;
    }
    this.log(`Updated workout: ${normalizedPath}`, "success");
    return result;
  }

  plansIndexPath() {
    return "/plans/plans.json";
  }

  personalRecordsPath() {
    return "/personal-records.json";
  }

  customExercisesPath() {
    return "/custom_exercises/custom_exercises.json";
  }

  async loadPlansIndex() {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      const response = await client.filesDownload({ path: this.plansIndexPath() });
      const fileBlob = response.result.fileBlob;
      const text = await fileBlob.text();
      const data = JSON.parse(text);

      const plans = data && typeof data.plans === "object" ? data.plans : {};
      return {
        version: data?.version ?? 1,
        updatedAt: data?.updatedAt ?? null,
        plans,
      };
    } catch (error) {
      const summary = error?.error?.error_summary || "";
      if (summary.includes("path/not_found/")) {
        this.log("Plans index not found in Dropbox; starting with an empty set", "info");
        return { version: 1, updatedAt: null, plans: {} };
      }

      this.log(`Failed to load plans index: ${error.message}`, "error");
      throw error;
    }
  }

  async savePlansIndex(plansMap) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      plans: plansMap || {},
    };

    const client = await this.ensureDropboxClient();
    await client.filesUpload({
      path: this.plansIndexPath(),
      contents: JSON.stringify(payload, null, 2),
      mode: { ".tag": "overwrite" },
    });

    return true;
  }

  async loadPersonalRecords() {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      const response = await client.filesDownload({ path: this.personalRecordsPath() });
      const fileBlob = response.result.fileBlob;
      const text = await fileBlob.text();
      const data = JSON.parse(text);

      const records = Array.isArray(data?.records) ? data.records : [];
      return {
        version: data?.version ?? 1,
        updatedAt: data?.updatedAt ?? null,
        records,
        exists: true,
      };
    } catch (error) {
      const summary = error?.error?.error_summary || "";
      if (summary.includes("path/not_found/")) {
        this.log("Personal records file not found in Dropbox; starting fresh", "info");
        return { version: 1, updatedAt: null, records: [], exists: false };
      }

      this.log(`Failed to load personal records: ${error.message}`, "error");
      throw error;
    }
  }

  async savePersonalRecords(recordsPayload = {}) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: Array.isArray(recordsPayload.records)
        ? recordsPayload.records
        : Array.isArray(recordsPayload)
          ? recordsPayload
          : [],
    };

    const client = await this.ensureDropboxClient();
    await client.filesUpload({
      path: this.personalRecordsPath(),
      contents: JSON.stringify(payload, null, 2),
      mode: { ".tag": "overwrite" },
    });

    this.log(`Saved ${payload.records.length} personal record(s)`, "success");
    return true;
  }

  async loadCustomExercises() {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      const response = await client.filesDownload({ path: this.customExercisesPath() });
      const fileBlob = response.result.fileBlob;
      const text = await fileBlob.text();
      const data = JSON.parse(text);

      if (Array.isArray(data?.exercises)) {
        return data.exercises;
      }
      return Array.isArray(data) ? data : [];
    } catch (error) {
      const summary = error?.error?.error_summary || "";
      if (summary.includes("path/not_found/")) {
        this.log("Custom exercises file not found; starting with an empty set", "info");
        return [];
      }

      this.log(`Failed to load custom exercises: ${error.message}`, "error");
      throw error;
    }
  }

  async saveCustomExercises(exercises = []) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }
    const payload = Array.isArray(exercises) ? exercises : [];
    const client = await this.ensureDropboxClient();
    await client.filesUpload({
      path: this.customExercisesPath(),
      contents: JSON.stringify(payload, null, 2),
      mode: { ".tag": "overwrite" },
    });
    this.log(`Saved ${payload.length} custom exercise(s)`, "success");
    return true;
  }

  async savePlan(name, planItems) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    const index = await this.loadPlansIndex();
    const plans = index.plans || {};
    plans[name] = JSON.parse(JSON.stringify(planItems || []));
    await this.savePlansIndex(plans);
    this.log(`Saved plan "${name}" to Dropbox`, "success");
    return true;
  }

  async deletePlan(name) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    const index = await this.loadPlansIndex();
    const plans = index.plans || {};

    if (!Object.prototype.hasOwnProperty.call(plans, name)) {
      this.log(`Plan "${name}" not found in Dropbox`, "warning");
      return false;
    }

    delete plans[name];
    await this.savePlansIndex(plans);
    this.log(`Deleted plan "${name}" from Dropbox`, "info");
    return true;
  }

  // Delete a workout from Dropbox (by timestamp match)
  async deleteWorkout(workout) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      const timestampValue = workout.timestamp || workout.endTime;
      const timestamp =
        timestampValue instanceof Date
          ? timestampValue
          : timestampValue
            ? new Date(timestampValue)
            : null;

      if (!timestamp || Number.isNaN(timestamp.getTime())) {
        this.log("Workout timestamp not available for Dropbox deletion", "error");
        return false;
      }

      let filePath = workout?._dropboxMetadata?.path || null;
      let fileName = workout?._dropboxMetadata?.name || null;

      if (!filePath) {
        const response = await client.filesListFolder({ path: "/workouts" });
        const timestampStr = timestamp.toISOString().replace(/[:.]/g, "-");

        const file = response.result.entries.find(
          (entry) => entry.name.includes(timestampStr),
        );
        filePath = file?.path_lower || null;
        fileName = file?.name || null;
      }

      if (!filePath) {
        this.log("Workout file not found in Dropbox", "error");
        return false;
      }

      await client.filesDeleteV2({ path: filePath });
      await this.deleteCachedWorkoutRecords([filePath]);
      await this.removeWorkoutsIndexEntry(filePath);

      const detailPath = typeof workout?.movementDataPath === "string"
        ? workout.movementDataPath
        : null;
      if (detailPath) {
        try {
          await client.filesDeleteV2({ path: detailPath });
          const cache = this.getCacheApi();
          if (cache && typeof cache.deleteWorkoutDetail === "function") {
            await cache.deleteWorkoutDetail(detailPath);
          }
        } catch {
          /* ignore detail cleanup errors */
        }
      }

      this.log(`Deleted workout: ${fileName || filePath}`, "success");
      return true;
    } catch (error) {
      this.log(`Failed to delete workout: ${error.message}`, "error");
      throw error;
    }
  }

  async exportExcelWorkbook(filename, contents) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      await client.filesUpload({
        path: `/${filename}`,
        contents,
        mode: { ".tag": "overwrite" },
      });

      this.log(`Exported Excel workbook: ${filename}`, "success");
      return true;
    } catch (error) {
      this.log(`Failed to export Excel workbook: ${error.message}`, "error");
      throw error;
    }
  }

  // Export individual workout with detailed movement data as CSV
  async exportWorkoutDetailedCSV(workout, unitLabel = "kg", toDisplayFn = (v) => v) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      // Check if workout has movement data
      if (!workout.movementData || workout.movementData.length === 0) {
        if (typeof workout?.movementDataPath === "string") {
          const movementData = await this.loadWorkoutMovementData(workout.movementDataPath);
          workout.movementData = movementData;
          workout.movementDataCount = movementData.length;
        }
      }
      if (!workout.movementData || workout.movementData.length === 0) {
        this.log("Workout does not have detailed movement data", "error");
        return false;
      }

      // Build CSV content with detailed movement data
      let csv = `Timestamp,Total Load (${unitLabel}),Right Load (${unitLabel}),Left Load (${unitLabel}),Right Position,Left Position\n`;

      const csvDecimals = unitLabel === "lb" ? 2 : 1;
      for (const point of workout.movementData) {
        const timestamp = point.timestamp;
        const totalKg = point.loadA + point.loadB;
        const totalLoad = toDisplayFn(totalKg).toFixed(csvDecimals);
        const loadA = toDisplayFn(point.loadA).toFixed(csvDecimals);
        const loadB = toDisplayFn(point.loadB).toFixed(csvDecimals);
        const posA = point.posA;
        const posB = point.posB;
        csv += `${timestamp},${totalLoad},${loadA},${loadB},${posA},${posB}\n`;
      }

      // Generate filename
      const timestamp = workout.timestamp || workout.endTime || new Date();
      const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
      const mode = (workout.mode || "workout").replace(/\s+/g, "_");
      const setName = workout.setName ? `_${workout.setName.replace(/\s+/g, "_")}` : "";
      const filename = `workout_detailed_${mode}${setName}_${dateStr}.csv`;

      // Upload to Dropbox in /workouts folder
      const client = await this.ensureDropboxClient();
      await client.filesUpload({
        path: `/workouts/${filename}`,
        contents: csv,
        mode: { ".tag": "add" },
        autorename: true,
      });

      this.log(`Exported detailed workout CSV: ${filename} (${workout.movementData.length} data points)`, "success");
      return true;
    } catch (error) {
      this.log(`Failed to export detailed workout CSV: ${error.message}`, "error");
      throw error;
    }
  }

  // PKCE helper: Generate code verifier
  generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

  // PKCE helper: Generate code challenge from verifier
  async generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  // PKCE helper: Base64 URL encode
  base64URLEncode(buffer) {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // Token storage helpers
  normalizeTokenPayload(token) {
    if (!token) {
      return null;
    }
    if (typeof token === "string") {
      return { accessToken: token, refreshToken: null, expiresAt: null };
    }
    if (typeof token === "object") {
      const payload = {
        accessToken: token.accessToken || token.access_token || null,
        refreshToken: token.refreshToken || token.refresh_token || null,
        expiresAt: Number.isFinite(token.expiresAt) ? token.expiresAt : null,
      };
      return payload.accessToken ? payload : null;
    }
    return null;
  }

  storeToken(token) {
    const payload = this.normalizeTokenPayload(token);
    if (!payload) {
      return null;
    }
    this._tokenInfo = payload;
    try {
      localStorage.setItem(this._tokenStorageKey, JSON.stringify(payload));
    } catch (error) {
      this.log("Unable to persist Dropbox token; continuing with in-memory token", "warning");
    }
    return payload;
  }

  getStoredToken() {
    if (this._tokenInfo) {
      return this._tokenInfo;
    }
    try {
      const raw = localStorage.getItem(this._tokenStorageKey);
      if (!raw) {
        return null;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      const payload = this.normalizeTokenPayload(parsed);
      this._tokenInfo = payload;
      return payload;
    } catch (error) {
      this.log("Unable to read Dropbox token from storage", "warning");
      return this._tokenInfo;
    }
  }

  clearStoredToken() {
    this._tokenInfo = null;
    this._currentAccessToken = null;
    try {
      localStorage.removeItem(this._tokenStorageKey);
    } catch {
      /* ignore storage cleanup errors */
    }
  }

  isTokenExpired(info) {
    if (!info || !info.expiresAt) {
      return false;
    }
    const safetyWindowMs = 60 * 1000;
    return Date.now() >= info.expiresAt - safetyWindowMs;
  }

  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new Error("Missing refresh token");
    }
    const response = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        client_id: this.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Refresh failed: ${response.statusText}`);
    }

    const data = await response.json();
    const payload = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
    this.log("Refreshed Dropbox access token", "info");
    return payload;
  }

  applyTokenToClient(tokenInfo) {
    if (!tokenInfo || !tokenInfo.accessToken) {
      return;
    }
    this.dbx = new Dropbox.Dropbox({
      accessToken: tokenInfo.accessToken,
      fetch: window.fetch.bind(window),
    });
    this._currentAccessToken = tokenInfo.accessToken;
  }

  async ensureDropboxClient() {
    let tokenInfo = this.getStoredToken();
    if (!tokenInfo || !tokenInfo.accessToken) {
      throw new Error("Dropbox authentication required");
    }
    if (this.isTokenExpired(tokenInfo) && tokenInfo.refreshToken) {
      tokenInfo = await this.refreshAccessToken(tokenInfo.refreshToken);
      this.storeToken(tokenInfo);
    }
    if (!this.dbx || this._currentAccessToken !== tokenInfo.accessToken) {
      this.applyTokenToClient(tokenInfo);
    }
    return this.dbx;
  }

  // Notify listeners of connection state change
  notifyConnectionChange() {
    if (this.onConnectionChange) {
      this.onConnectionChange(this.isConnected);
    }
  }

  // Get connection status
  getConnectionStatus() {
    const token = this.getStoredToken();
    return {
      isConnected: this.isConnected,
      hasToken: !!(token && token.accessToken),
    };
  }
}
