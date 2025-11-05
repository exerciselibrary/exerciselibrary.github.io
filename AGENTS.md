# AGENTS

## Purpose
This document orients automation and human collaborators to the structure, conventions, and workflows in this repository.

## Repository Map
- `index.html` — public-facing exercise library landing page.
- `styles.css` — shared styling for the public site.
- `exercise_dump.json` — exported exercise metadata referenced by the app.
- `js/` — modular ES modules that power the exercise plan builder (`builder.js`, `context.js`, `library.js`, etc.).
- `workout-time/` — standalone Vitruvian workout control UI (`index.html`, `app.js`, supporting assets).
- `local-tests/` — lightweight Node-based test harness (currently `builder.test.js`).

## Key Flows
- The builder UI is data-driven: `js/context.js` initializes shared state; `js/builder.js` consumes that state to serialize plans. Keep mutations centralized in `context.js` helpers.
- The workout control in `workout-time/app.js` communicates with hardware over WebSocket. Update connection logic cautiously; mirror any protocol changes in both UI and device code.
- Static assets are served as-is. No bundler is configured, so prefer vanilla JS modules and relative imports.

## Development Tips
- Use `npx http-server .` or similar to preview pages locally. Both the root `index.html` and `workout-time/index.html` expect to run in a browser environment.
- Run `node local-tests/builder.test.js` to sanity-check plan serialization and rebuilding logic after modifying builder modules.
- Maintain accessibility: new UI components should include keyboard support and ARIA labelling consistent with existing markup.

## Agent Guidance
- When adding features, reflect changes in both the documentation and the relevant UI (root site vs. workout control panel) to keep experiences in sync.
- Validate data contract changes against `exercise_dump.json` to avoid breaking the plan builder.
- For styling adjustments, prefer editing `styles.css` or component-level `<style>` blocks; avoid inline styles unless scoped to dynamic states.

## Outstanding Opportunities
- Add automated linting (ESLint) and formatting to catch regressions early.
- Expand the `local-tests` suite to cover additional modules (search, storage sync, progression calculations).
- Consider extracting shared utilities between the root UI and `workout-time` into a common module to reduce duplication.
