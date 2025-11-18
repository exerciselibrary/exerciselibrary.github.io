Exercise Library Explorer

Static UI that loads `exercise_dump.json`, lets you explore exercises with rich filters, preview videos, and assemble a printable/exportable workout plan.

Run locally

- Keep `index.html`, `styles.css`, the `js/` directory, and `exercise_dump.json` together (already staged here).
- Serve the folder so the browser can fetch the JSON:
  - Python: `python -m http.server 8000`
  - Node: `npx serve .`
  - PowerShell: `Start-Process http://localhost:8000` after starting one of the above servers
- Open `http://localhost:8000`.

Code structure (new modular layout)

- `js/main.js` — entry point that wires modules together, bootstraps data, and binds global events.
- `js/constants.js` — shared constants (modes, weight limits, labels, color palette).
- `js/context.js` — single source of truth for application state and DOM references.
- `js/utils.js` — reusable helpers (naming, set logic, shuffling, spreadsheet export, weight math).
- `js/muscles.js` — canonical muscle metadata and normalization helpers.
- `js/search.js` — tokenisation and scoring logic for fuzzy exercise search.
- `js/library.js` — filter controls, search orchestration, and exercise card rendering.
- `js/builder.js` — workout builder UI, drag-and-drop ordering, export/print/share actions.
- `js/grouping.js` — grouping helpers (by equipment, muscles, or muscle groups) shared by builder.
- `js/storage.js` — localStorage persistence, deep-link encoding, and workout restoration.
- `js/custom-exercises.js` — merges Dropbox-backed custom exercises into the main catalogue, computes new identifiers, and exposes helpers for creating/syncing custom workout entries.
- `js/analytics-dashboard.js` — renders the analytics tab, syncs Vitruvian workouts from Dropbox, and maps telemetry into charts/statistics.
- `shared/weight-utils.js` — shared conversion helpers (kg/lb math) surfaced to both the Exercise Library and workout-time console.
- `shared/echo-telemetry.js` — shared telemetry parsing helpers used by the analytics dashboard and the workout-time console.

Each module is documented at the top to make it clear what part of the experience it owns. The builder and library modules also register a render callback so UI updates stay centralised in `main.js`.

Workout Time app structure

- `workout-time/app.js` — main Vitruvian console UI wiring (device lifecycle, live telemetry, logging, etc.). The heavy plan-specific logic delegates to helper modules to keep the file focused on orchestration.
- `workout-time/plan-runner.js` — mixin that owns plan execution (timeline building, rest countdowns with audio cues, skip/rewind logic, pause/auto-resume detection, and the plan elapsed timer). Methods in `app.js` call into this mixin so all business rules live in one place.
- `workout-time/dropbox.js`, `device.js`, `chart.js`, `modes.js`, `protocol.js` — unchanged supporting modules for cloud sync, Bluetooth transport, charting, and protocol constants.
- `workout-time/plan-runner.js` is loaded before `app.js`, so you can further extend the plan behaviour without reopening the main file.

Automated tests

- Run `npm run test:unit` to execute the committed Node suite in `tests/` (builder serialization, storage, search, workout console flows, and custom-workout creation coverage). Target a single file with `node tests/<file>.test.js`.
- Run `npm run test:local` to execute the optional Node harness in `local-tests/`; it auto-skips when the directory is missing.
- Run `npm test` to execute both suites; useful before syncing Dropbox plans or sharing builds.
- The optional `local-tests/` scripts stay gitignored so debugging scaffolding never lands in commits. Run any script directly with `node local-tests/<file>.test.js`.
- `node local-tests/builder.test.js` bootstraps a DOM stub, exports the builder via `buildPlanSyncPayload`, then reloads it with `loadPlanIntoBuilder` to ensure sets, videos, and progression metadata round-trip correctly.
- `node local-tests/search.test.js` covers the fuzzy search scoring pipeline (token bonuses, cached index reuse, and substring fallbacks).
- `node local-tests/storage-sync.test.js` exercises `plan-storage.js` by faking `localStorage` to verify plan indexing, persistence, and deletion flows.
- `node local-tests/progression.test.js` focuses on the progression math inside `buildPlanItems`, ensuring weight deltas convert and clamp consistently across unit toggles.
- `node local-tests/plan-runner.test.js` asserts that the workout-time plan runner builds timelines correctly, renders set descriptions, and auto-resumes from telemetry when movement is detected during a pause.
- Each script requires a Node runtime available on your PATH. Install it from https://nodejs.org/ if necessary.

Quality checks

- `npm run lint` walks every JS file with a focused rule set (no trailing whitespace, no `var`, and strict equality) so regressions get flagged in CI-friendly text output.
- `npm run format` normalises line endings, trims trailing whitespace, and ensures newline-terminated text files, giving a lightweight formatter that works offline.

What's included

- Multi-select filters for muscle groups, individual muscles, and equipment with OR/AND matching.
- Hover posters that auto-play MP4 previews plus a modal viewer for full-size playback.
- Share button on every card that copies a deep link (`?exercise=ID`) to the clipboard.
- Workout builder tab: add exercises, configure sets/reps/weight/mode (capped at 220 lbs or 100 kg per cable), and keep totals in view.
- Unit toggle (lbs/kg) that converts existing entries and updates export/print outputs.
- Filter the library down to just the exercises in your workout with one click.
- Export workout to an Excel `.xlsx` workbook or generate a print-friendly view (optional checkbox column included).
- Share the entire workout via a generated link; state also persists locally between refreshes.
- Sticky filter sidebar, searchable library, alphabetical toggle (A-Z / Z-A), and jump-to-top/bottom controls.

Notes

- `.m3u8` videos need native HLS (e.g., Safari). The page still links to the stream if playback fails.
- The builder stores one weight value per set to reflect the single cable limit (220 lbs).
- All data comes from `exercise_dump.json` (`muscleGroups`, `muscles`, `equipment`, `videos[{ thumbnail, video }]`).
- Workout selections persist automatically in `localStorage`; use the Clear button to reset locally.
