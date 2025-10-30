Exercise Library Explorer

Static UI that loads `exercise_dump.json`, lets you explore exercises with rich filters, preview videos, and assemble a printable/exportable workout plan.

Run locally

- Keep `index.html`, `styles.css`, `app.js`, and `exercise_dump.json` together (already staged here).
- Serve the folder so the browser can fetch the JSON:
  - Python: `python -m http.server 8000`
  - Node: `npx serve .`
  - PowerShell: `Start-Process http://localhost:8000` after starting one of the above servers
- Open `http://localhost:8000`.

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
