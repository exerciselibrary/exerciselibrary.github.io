# AGENTS

## Purpose
This document orients automation and human collaborators to the structure, conventions, and workflows in this repository.

## Repository Map
- `index.html` — public-facing exercise library landing page.
- `styles.css` — shared styling for the public site.
- `exercise_dump.json` — exported exercise metadata referenced by the app.
- `js/` — modular ES modules that power the exercise plan builder (`builder.js`, `context.js`, `library.js`, etc.).
  - `grouping.js` owns builder grouping/shuffle helpers and shared grouping labels/colors.
  - `muscles.js` provides canonical muscle metadata and alias normalization.
  - `search.js` builds the fuzzy search index/scoring used by the library filters.
  - `plan-storage.js` centralises workout plan persistence. Interact with localStorage through the helpers exposed here rather than reimplementing storage access.
  - `custom-exercises.js` merges Dropbox-backed custom exercises into `state.data`, assigns fresh identifiers, and exposes helpers for creating/syncing custom workout entries. Use its helpers instead of rebuilding catalogue math.
  - `analytics-dashboard.js` powers the analytics tab, mapping Dropbox workouts + telemetry data into charts/statistics surfaced on the main site.
- `workout-time/` — standalone Vitruvian workout control UI (`index.html`, `app.js`, supporting assets).
  - `grouping-logic.js` and `superset-executor-v2.js` coordinate grouped/superset execution order; keep these aligned with the plan runner’s navigation expectations.
  - `dropbox.js` handles OAuth sync and caches workout data via `shared/data-cache.js`.
- `shared/data-cache.js` — IndexedDB-backed cache (with in-memory fallback) for Dropbox workouts/details; attaches to `window.VitruvianCache`.
- `shared/weight-utils.js` — single source of truth for kg/lb conversions; also attaches itself to `window.WeightUtils` so the workout-time console can reuse the same math.
- `shared/echo-telemetry.js` — telemetry-processing helpers shared between the analytics dashboard and the workout-time console.
- `shared/version.js` — app version helpers + `workouttime:version-ready` event for the workout-time UI badge.
- `tests/` — committed `node:test` specs (builder serialization, plan storage, search, workout console flows, and custom-workout creation).
- `local-tests/` — lightweight Node-based test harness (builder, search, storage-sync, progression, and plan-runner tests).
- `Intensity_FAQ.md` — reference for how intensity techniques expand into micro-sets inside the workout-time app; keep it in sync with the builder dropdown and plan-runner behavior.
- `scripts/` — Node helpers for lint/format/test wrappers plus telemetry/superset simulators (`run-eslint.mjs`, `run-prettier.mjs`, `run-local-tests.mjs`, `analyze-echo-workout.mjs`, `simulate-group-transition.mjs`, etc.). Prefer these over ad hoc commands when reproducing issues.

## Key Flows
- The builder UI is data-driven: `js/context.js` initializes shared state; `js/builder.js` consumes that state to serialize plans. Keep mutations centralized in `context.js` helpers.
- Dropbox custom exercises are orchestrated through `js/main.js` + `custom-exercises.js`. Always use `buildCustomExerciseEntry`, `setCustomExercises`, and `getDropboxPayloadForCustomExercises` to keep IDs/search indexes consistent when creating custom workouts.
- The workout control in `workout-time/app.js` communicates with hardware over WebSocket. Update connection logic cautiously; mirror any protocol changes in both UI and device code.
- The analytics tab relies on `analytics-dashboard.js` and the shared telemetry helpers. Update those modules in tandem if telemetry schemas change.
- Library search builds a cached index in `js/search.js`; adjust `js/search.js`, `js/library.js`, and `js/utils.js` together when tuning scoring or tokenization.
- Static assets are served as-is. No bundler is configured, so prefer vanilla JS modules and relative imports.
- For storage interactions in the plan builder, rely on `plan-storage.js` helpers. They normalise plan names, manage the plan index, and guard against localStorage failures. Avoid duplicating that logic elsewhere to keep UI state and persistence consistent.
- Grouped/superset workouts are driven by the `groupNumber` field emitted by the builder; `workout-time/grouping-logic.js` builds the grouped timeline and `superset-executor-v2.js` drives in-workout navigation. Keep these in sync so rest timing and round-robin ordering match the builder’s intent.
- Intensity techniques (Dropset, Rest-Pause, Slow negatives) are serialized via `js/storage.js` and expanded into micro-sets inside `workout-time/plan-runner.js`. Keep the options, defaults, and FAQ aligned whenever progression or intensity math changes.
- Dropbox workout caching now uses `shared/data-cache.js` (IndexedDB). Keep cache metadata in `workout-time/dropbox.js` aligned with analytics consumption in `js/analytics-dashboard.js`.

## Development Tips
- Use `npx http-server .` or similar to preview pages locally. Both the root `index.html` and `workout-time/index.html` expect to run in a browser environment.
- `npm run dev` starts the local `http-server` on port 5173 against the repo root; prefer this for quick previews unless you need custom headers.
- Run `npm run test:unit` for the committed `tests/` suite and `npm run test:local` for the optional `local-tests/` harness; `npm test` runs both. Always exercise the relevant suite(s) before syncing Dropbox data or sending PRs.
- Run `npm run lint` before sending PRs so any trailing whitespace, loose equality, or rogue `var` declarations are caught early; `npm run format` will normalise whitespace/newlines when you need automatic fixes.
- For superset/debug flows without hardware, lean on `scripts/simulate-group-transition.mjs` or the `simulate-supertest*.mjs` helpers to iterate on grouping logic before hitting the UI.
- Maintain accessibility: new UI components should include keyboard support and ARIA labelling consistent with existing markup.
- After touching persistence or plan-index flows, update `plan-storage.js` first and adapt consumers (currently `js/main.js`) to avoid drift between cached plan state and saved plans.
- When documentation or instructions change (including this file), summarise the rationale in the PR description so future collaborators understand why guidance shifted.
- Keep `shared/version.js` in sync with `package.json` when bumping the app version for workout-time badges.

## Agent Guidance
- When adding features, reflect changes in both the documentation and the relevant UI (root site vs. workout control panel) to keep experiences in sync.
- Validate data contract changes against `exercise_dump.json` to avoid breaking the plan builder.
- When handling Dropbox custom workouts, keep all merging/ID math inside `custom-exercises.js` so builder state, search indexes, and analytics stay aligned.
- For styling adjustments, prefer editing `styles.css` or component-level `<style>` blocks; avoid inline styles unless scoped to dynamic states.
- If any UI changes are made, take screenshots of new UI changes to ensure everything is working accordingly
- Always run tests
- When updating the workout builder (`js/`) or workout-time app (`workout-time/`), use the numeric `id_new` exercise identifier for new logic and persistence, keeping the legacy `id` only for backward compatibility.
- Keep grouped-exercise handling consistent across the builder, `workout-time/grouping-logic.js`, and `SupersetExecutorV2`; adjust `tests/superset-supertest.test.js` and related plan-runner specs if the navigation rules change.
- When tweaking intensity behaviors or progression math, update both UIs plus `Intensity_FAQ.md` so the dropdown options, serialization (`js/storage.js`), and micro-set expansion (`workout-time/plan-runner.js`) stay in lockstep.

## Outstanding Opportunities
- Wire the lint/test commands into CI (GitHub Actions or similar) so regressions are blocked automatically.
- Expand the workout-time coverage to include the rest-countdown DOM updates and audio cues alongside the telemetry auto-resume logic.
- Document the new shared weight utilities inside `workout-time/index.html` for future contributors and consider sharing additional helpers (e.g., unit labels, clamp logic) through the same module.
- Backfill automated coverage for intensity micro-sets and grouped navigation inside the workout-time plan runner to lock in the current behavior.
