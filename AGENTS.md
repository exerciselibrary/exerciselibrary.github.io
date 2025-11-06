# AGENTS

## Purpose
Reference guide for automation and human contributors. Use it to understand the structure, contracts, and preferred workflows before touching code.

## Quick Start
- Serve the repo with `npm run dev` (wraps `http-server`) or any static file server. Both the root `index.html` and `workout-time/index.html` expect a browser environment.
- The site ships as native ES modules. Keep files co-located and avoid bundler-only features (no JSX, CommonJS, or TypeScript transforms).
- Run automated checks with the provided npm scripts: `npm test`, `npm run lint`, `npm run format`.

## Repository Map
- `index.html`, `styles.css` — public exercise library landing page and shared styling.
- `exercise_dump.json` — canonical exercise dataset. Schema changes must stay compatible with search, filters, storage, and workout-time consumers.
- `js/` — modular frontend for the library and builder.
  - `main.js` — bootstraps data loading, state wiring, and tab switching.
  - `context.js` — centralised state/DOM registry; route mutations through its helpers.
  - `constants.js` — shared enums and configuration (storage keys, modes, limits).
  - `library.js` — filter orchestration, search invocation, card rendering.
  - `search.js` — tokenisation, fuzzy scoring, and in-memory indices.
  - `builder.js` — workout builder UI (drag/drop, set editing, export pipelines).
  - `grouping.js` — grouping helpers reused by the builder and library views.
  - `plan-storage.js` — local plan index management. Always use these helpers for persisted plans.
  - `storage.js` — broader persistence (builder snapshot, plan metadata, share-link parsing).
  - `utils.js`, `muscles.js` — shared helpers and canonical muscle metadata.
- `tests/` — Node test runner suites (`node --test`) covering builder flows, search scoring, storage sync, and regression cases.
- `workout-time/` — Vitruvian workout control UI.
  - `app.js` — orchestrates device lifecycle, plan execution, and UI state.
  - `plan-runner.js` — timeline building, rest timers, skip/rewind logic; loaded before `app.js`.
  - `device.js`, `protocol.js`, `chart.js`, `modes.js`, `dropbox.js` — transport, telemetry, charting, and cloud sync support.
- `scripts/` — mock CLIs for lint/format/http-server to support sandboxed automation.
- Tooling: `package.json`, `eslint.config.js`, `prettier.config.js` define commands and formatting conventions.

## Key Flows
- **Data bootstrapping** — `main.js` fetches `exercise_dump.json`, normalises it through `context.js`, then requests initial renders from `library.js` and `builder.js`.
- **Builder state** — All mutations route through `context.js` helpers to keep `state.builder` and DOM references consistent. `builder.js` emits serialised payloads via `storage.js` and `plan-storage.js`.
- **Persistence** — `plan-storage.js` governs plan naming, index updates, and storage error handling. Use it instead of direct `localStorage` access.
- **Search** — `search.js` maintains token indices; `library.js` supplies filters and delegates to search for scoring. Changing tokens or weightings requires updates to both modules.
- **Workout-Time device loop** — `workout-time/app.js` manages WebSocket connections, device telemetry, and integrates `plan-runner.js` for execution. Mirror protocol changes across `protocol.js` and any firmware.

## Development Workflow
- Add or mutate state through `context.js`. Avoid duplicating DOM queries outside of its registry.
- Maintain accessibility: mirror existing ARIA usage and keyboard interactions when extending UI.
- When touching persistence or plan serialisation, update Node tests (`tests/plan-storage.test.js`, `tests/builder-load-plan.test.js`, `tests/builder-plan-items.test.js`) to capture new expectations.
- Target evergreen browsers. If introducing less supported APIs, ship polyfills inline with usage.
- Styles live in `styles.css` and component-scoped `<style>` blocks. Reserve inline styles for dynamic states only.

## Guidance for Agents
- Synchronise feature updates across the builder and workout-time surfaces; document behavioural changes in `README.md` or inline comments where appropriate.
- Validate data contract changes against `exercise_dump.json` and ensure downstream consumers still parse expected fields.
- Reuse existing utilities before introducing new helpers. Shared logic between the browser UI and workout-time app should sit in clearly named modules to prevent drift.
- Expand automated tests alongside features. Prefer Node’s built-in runner under `tests/`; use lightweight DOM stubs when browser-specific behaviour must be verified.

## Outstanding Opportunities
- Extend coverage for progression settings, equipment grouping, and workout-time plan execution edge cases.
- Wire lint and test scripts into CI to catch regressions before deploys.
- Extract shared plan serialisation helpers consumed by both the browser builder and workout-time runner.
- Improve telemetry logging in `workout-time/app.js` to surface connection failures and protocol mismatches.
