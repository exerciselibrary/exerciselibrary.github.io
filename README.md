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

Each module is documented at the top to make it clear what part of the experience it owns. The builder and library modules also register a render callback so UI updates stay centralised in `main.js`.

Workout Time app structure

- `workout-time/app.js` — main Vitruvian console UI wiring (device lifecycle, live telemetry, logging, etc.). The heavy plan-specific logic delegates to helper modules to keep the file focused on orchestration.
- `workout-time/plan-runner.js` — mixin that owns plan execution (timeline building, rest countdowns with audio cues, skip/rewind logic, pause/auto-resume detection, and the plan elapsed timer). Methods in `app.js` call into this mixin so all business rules live in one place.
- `workout-time/dropbox.js`, `device.js`, `chart.js`, `modes.js`, `protocol.js` — unchanged supporting modules for cloud sync, Bluetooth transport, charting, and protocol constants.
- `workout-time/plan-runner.js` is loaded before `app.js`, so you can further extend the plan behaviour without reopening the main file.

Local tests

- Tests live in `local-tests/` and are ignored by git so they never end up in commits.
- `local-tests/builder.test.js` bootstraps a minimal DOM stub, exercises the builder metadata pipeline (`buildPlanSyncPayload` ➜ `loadPlanIntoBuilder`), and asserts that videos and set groupings survive a round trip. Run it with `node local-tests/builder.test.js`.
- The script requires a Node runtime available on your PATH. If you are on Windows without Node, install it from https://nodejs.org/ and rerun the command.

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
