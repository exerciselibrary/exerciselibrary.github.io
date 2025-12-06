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

  // Save workout to Dropbox
  async saveWorkout(workout) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      // Generate filename with timestamp
      const timestamp = workout.timestamp || new Date();
      const filename = `workout_${timestamp.toISOString().replace(/[:.]/g, "-")}.json`;
      const path = `/workouts/${filename}`;

      // Convert workout to JSON
      const contents = JSON.stringify(workout, null, 2);

      // Upload to Dropbox
      await client.filesUpload({
        path: path,
        contents: contents,
        mode: { ".tag": "add" },
        autorename: true,
      });

      this.log(`Saved workout: ${filename}`, "success");
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
      const client = await this.ensureDropboxClient();

      // Get the original path from metadata
      const originalPath = workout?._dropboxMetadata?.path;
      if (!originalPath) {
        throw new Error("No Dropbox path metadata found. Cannot overwrite.");
      }

      // Convert workout to JSON (exclude metadata from the JSON)
      const contents = JSON.stringify(workout, null, 2);

      // Overwrite existing file
      await client.filesUpload({
        path: originalPath,
        contents: contents,
        mode: { ".tag": "overwrite" },
      });

      this.log(`Overwritten workout: ${workout?._dropboxMetadata?.name || originalPath}`, "success");
      return true;
    } catch (error) {
      this.log(`Failed to overwrite workout: ${error.message}`, "error");
      throw error;
    }
  }

  // Load workouts from Dropbox. By default returns latest 25, but maxEntries can override.
  async loadWorkouts(options = {}) {
    if (!this.isConnected) {
      throw new Error("Not connected to Dropbox");
    }

    try {
      const client = await this.ensureDropboxClient();
      this.log("Loading workouts from Dropbox...", "info");

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
          if (entry[".tag"] === "file" && entry.name.endsWith(".json")) {
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

      topFiles.sort((a, b) => {
        const aTime = new Date(a.server_modified || a.client_modified || 0).getTime();
        const bTime = new Date(b.server_modified || b.client_modified || 0).getTime();
        return bTime - aTime;
      });

      const workouts = [];
      for (const file of topFiles) {
        try {
          const downloadResponse = await client.filesDownload({ path: file.path_lower });
          const fileBlob = downloadResponse.result.fileBlob;
          const text = await fileBlob.text();
          const workout = JSON.parse(text);

          // Convert timestamp strings back to Date objects
          if (workout.timestamp) {
            workout.timestamp = new Date(workout.timestamp);
          }
          if (workout.startTime) {
            workout.startTime = new Date(workout.startTime);
          }
          if (workout.warmupEndTime) {
            workout.warmupEndTime = new Date(workout.warmupEndTime);
          }
          if (workout.endTime) {
            workout.endTime = new Date(workout.endTime);
          }

          this.attachDropboxMetadata(workout, {
            path: file.path_lower,
            name: file.name,
            id: file.id,
            rev: downloadResponse?.result?.rev || downloadResponse?.result?.metadata?.rev || file.rev || null,
          });
          workouts.push(workout);
        } catch (error) {
          this.log(`Failed to load ${file.name}: ${error.message}`, "error");
        }
      }

      // Sort by timestamp, newest first
      workouts.sort((a, b) => {
        const timeA = (a.timestamp || a.endTime || new Date(0)).getTime();
        const timeB = (b.timestamp || b.endTime || new Date(0)).getTime();
        return timeB - timeA;
      });

      this.log(`Loaded ${workouts.length} workouts`, "success");
      return workouts;
    } catch (error) {
      this.log(`Failed to load workouts: ${error.message}`, "error");
      throw error;
    }
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
    const contents = JSON.stringify(workout, null, 2);
    const client = await this.ensureDropboxClient();
    const response = await client.filesUpload({
      path: normalizedPath,
      contents,
      mode: { ".tag": "overwrite" },
    });
    if (workout && typeof workout === "object" && workout._dropboxMetadata) {
      workout._dropboxMetadata.rev =
        response?.result?.rev || response?.result?.metadata?.rev || workout._dropboxMetadata.rev || null;
    }
    this.log(`Updated workout: ${normalizedPath}`, "success");
    return response;
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
      };
    } catch (error) {
      const summary = error?.error?.error_summary || "";
      if (summary.includes("path/not_found/")) {
        this.log("Personal records file not found in Dropbox; starting fresh", "info");
        return { version: 1, updatedAt: null, records: [] };
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
      // Find the file with matching timestamp
      const response = await client.filesListFolder({ path: "/workouts" });
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

      const timestampStr = timestamp.toISOString().replace(/[:.]/g, "-");

      const file = response.result.entries.find(
        (entry) => entry.name.includes(timestampStr)
      );

      if (file) {
        await client.filesDeleteV2({ path: file.path_lower });
        this.log(`Deleted workout: ${file.name}`, "success");
        return true;
      } else {
        this.log("Workout file not found in Dropbox", "error");
        return false;
      }
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
