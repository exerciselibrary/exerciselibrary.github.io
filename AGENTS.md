# AGENTS

## Purpose
This document orients automation and human collaborators to the structure, conventions, and workflows in this repository.

## Repository Map
- `index.html` — public-facing exercise library landing page.
- `styles.css` — shared styling for the public site.
- `exercise_dump.json` — exported exercise metadata referenced by the app.
- `js/` — modular ES modules that power the exercise plan builder (`builder.js`, `context.js`, `library.js`, etc.).
  - `plan-storage.js` centralises workout plan persistence. Interact with localStorage through the helpers exposed here rather than reimplementing storage access.
- `workout-time/` — standalone Vitruvian workout control UI (`index.html`, `app.js`, supporting assets).
- `shared/weight-utils.js` — single source of truth for kg/lb conversions; also attaches itself to `window.WeightUtils` so the workout-time console can reuse the same math.
- `local-tests/` — lightweight Node-based test harness (builder, search, storage-sync, progression, and plan-runner tests).

## Key Flows
- The builder UI is data-driven: `js/context.js` initializes shared state; `js/builder.js` consumes that state to serialize plans. Keep mutations centralized in `context.js` helpers.
- The workout control in `workout-time/app.js` communicates with hardware over WebSocket. Update connection logic cautiously; mirror any protocol changes in both UI and device code.
- Static assets are served as-is. No bundler is configured, so prefer vanilla JS modules and relative imports.
- For storage interactions in the plan builder, rely on `plan-storage.js` helpers. They normalise plan names, manage the plan index, and guard against localStorage failures. Avoid duplicating that logic elsewhere to keep UI state and persistence consistent.

## Development Tips
- Use `npx http-server .` or similar to preview pages locally. Both the root `index.html` and `workout-time/index.html` expect to run in a browser environment.
- Run `npm test` (or `npm run test:local`) to sanity-check plan serialization/build flows alongside the browser search + storage helpers after modifying builder modules.
- Run `npm run lint` before sending PRs so any trailing whitespace, loose equality, or rogue `var` declarations are caught early; `npm run format` will normalise whitespace/newlines when you need automatic fixes.
- Maintain accessibility: new UI components should include keyboard support and ARIA labelling consistent with existing markup.
- After touching persistence or plan-index flows, update `plan-storage.js` first and adapt consumers (currently `js/main.js`) to avoid drift between cached plan state and saved plans.

## Agent Guidance
- When adding features, reflect changes in both the documentation and the relevant UI (root site vs. workout control panel) to keep experiences in sync.
- Validate data contract changes against `exercise_dump.json` to avoid breaking the plan builder.
- For styling adjustments, prefer editing `styles.css` or component-level `<style>` blocks; avoid inline styles unless scoped to dynamic states.
- If any UI changes are made, take screenshots of new UI changes to ensure everything is working accordingly
- Always run tests

## Outstanding Opportunities
- Wire the lint/test commands into CI (GitHub Actions or similar) so regressions are blocked automatically.
- Expand the workout-time coverage to include the rest-countdown DOM updates and audio cues alongside the telemetry auto-resume logic.
- Document the new shared weight utilities inside `workout-time/index.html` for future contributors and consider sharing additional helpers (e.g., unit labels, clamp logic) through the same module.
