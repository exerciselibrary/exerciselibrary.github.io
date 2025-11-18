# AGENTS

## Purpose
This document orients automation and human collaborators to the structure, conventions, and workflows in this repository.

## Repository Map
- `index.html` — public-facing exercise library landing page.
- `styles.css` — shared styling for the public site.
- `exercise_dump.json` — exported exercise metadata referenced by the app.
- `js/` — modular ES modules that power the exercise plan builder (`builder.js`, `context.js`, `library.js`, etc.).
  - `plan-storage.js` centralises workout plan persistence. Interact with localStorage through the helpers exposed here rather than reimplementing storage access.
  - `custom-exercises.js` merges Dropbox-backed custom exercises into `state.data`, assigns fresh identifiers, and exposes helpers for creating/syncing custom workout entries. Use its helpers instead of rebuilding catalogue math.
  - `analytics-dashboard.js` powers the analytics tab, mapping Dropbox workouts + telemetry data into charts/statistics surfaced on the main site.
- `workout-time/` — standalone Vitruvian workout control UI (`index.html`, `app.js`, supporting assets).
- `shared/weight-utils.js` — single source of truth for kg/lb conversions; also attaches itself to `window.WeightUtils` so the workout-time console can reuse the same math.
- `shared/echo-telemetry.js` — telemetry-processing helpers shared between the analytics dashboard and the workout-time console.
- `tests/` — committed `node:test` specs (builder serialization, plan storage, search, workout console flows, and custom-workout creation).
- `local-tests/` — lightweight Node-based test harness (builder, search, storage-sync, progression, and plan-runner tests).

## Key Flows
- The builder UI is data-driven: `js/context.js` initializes shared state; `js/builder.js` consumes that state to serialize plans. Keep mutations centralized in `context.js` helpers.
- Dropbox custom exercises are orchestrated through `js/main.js` + `custom-exercises.js`. Always use `buildCustomExerciseEntry`, `setCustomExercises`, and `getDropboxPayloadForCustomExercises` to keep IDs/search indexes consistent when creating custom workouts.
- The workout control in `workout-time/app.js` communicates with hardware over WebSocket. Update connection logic cautiously; mirror any protocol changes in both UI and device code.
- The analytics tab relies on `analytics-dashboard.js` and the shared telemetry helpers. Update those modules in tandem if telemetry schemas change.
- Static assets are served as-is. No bundler is configured, so prefer vanilla JS modules and relative imports.
- For storage interactions in the plan builder, rely on `plan-storage.js` helpers. They normalise plan names, manage the plan index, and guard against localStorage failures. Avoid duplicating that logic elsewhere to keep UI state and persistence consistent.

## Development Tips
- Use `npx http-server .` or similar to preview pages locally. Both the root `index.html` and `workout-time/index.html` expect to run in a browser environment.
- Run `npm run test:unit` for the committed `tests/` suite and `npm run test:local` for the optional `local-tests/` harness; `npm test` runs both. Always exercise the relevant suite(s) before syncing Dropbox data or sending PRs.
- Run `npm run lint` before sending PRs so any trailing whitespace, loose equality, or rogue `var` declarations are caught early; `npm run format` will normalise whitespace/newlines when you need automatic fixes.
- Maintain accessibility: new UI components should include keyboard support and ARIA labelling consistent with existing markup.
- After touching persistence or plan-index flows, update `plan-storage.js` first and adapt consumers (currently `js/main.js`) to avoid drift between cached plan state and saved plans.
- When documentation or instructions change (including this file), summarise the rationale in the PR description so future collaborators understand why guidance shifted.

## Agent Guidance
- When adding features, reflect changes in both the documentation and the relevant UI (root site vs. workout control panel) to keep experiences in sync.
- Validate data contract changes against `exercise_dump.json` to avoid breaking the plan builder.
- When handling Dropbox custom workouts, keep all merging/ID math inside `custom-exercises.js` so builder state, search indexes, and analytics stay aligned.
- For styling adjustments, prefer editing `styles.css` or component-level `<style>` blocks; avoid inline styles unless scoped to dynamic states.
- If any UI changes are made, take screenshots of new UI changes to ensure everything is working accordingly
- Always run tests
- When updating the workout builder (`js/`) or workout-time app (`workout-time/`), use the numeric `id_new` exercise identifier for new logic and persistence, keeping the legacy `id` only for backward compatibility.

## Outstanding Opportunities
- Wire the lint/test commands into CI (GitHub Actions or similar) so regressions are blocked automatically.
- Expand the workout-time coverage to include the rest-countdown DOM updates and audio cues alongside the telemetry auto-resume logic.
- Document the new shared weight utilities inside `workout-time/index.html` for future contributors and consider sharing additional helpers (e.g., unit labels, clamp logic) through the same module.
