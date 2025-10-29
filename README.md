Exercise Library Explorer

Quick static UI to browse exercises from `exercise_dump.json`, explore by muscle group, filter by equipment, and preview videos on hover (MP4 sources only).

How to run

- Place `index.html`, `styles.css`, `app.js`, and `exercise_dump.json` in the same folder (already done here).
- Start a simple local server from this folder (to allow the page to `fetch` the JSON file):
  - Python: `python -m http.server 8000`
  - Node (serve): `npx serve .` (if installed)
  - PowerShell: `Start-Process http://localhost:8000` after starting the python server
- Open `http://localhost:8000` in your browser.

Features

- Colored muscle-group tiles with counts and quick filtering.
- Dropdown filters for Muscle Group and Equipment.
- Exercise grid with thumbnails, muscle/equipment tags, and hover-to-play preview for MP4 sources.

Notes

- Some exercises reference `.m3u8` (HLS) URLs which don’t play natively in all browsers without a helper library. The hover preview currently plays only `.mp4` URLs. If you want HLS hover previews too, I can add a local copy of `hls.js` and wire it in.
- The dataset expects fields like `muscleGroups`, `equipment`, and `videos[{ thumbnail, video }]` as present in the included `exercise_dump.json`.

