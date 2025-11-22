# Intensity Techniques FAQ

This document explains how the workout-time app handles the **Intensity Technique** field for exercise rows, what each option does, and example set-by-set expansions.

## Where to set it
- Open `workout-time/index.html`, add/expand a **Program** row, and look under **Progression** in the plan card. The dropdown labeled **Intensity Technique** controls these behaviors per exercise row.
- Options: `None`, `Dropset`, `Rest-Pause`, `Slow negatives`.

## What each option does (last set only)
- **None**: No change; each set runs as programmed.
- **Dropset**: On the final set, adds two rapid micro-sets with weight reductions and no progression.
  - Sequence: normal last set (0s rest) → micro 1 at ~80% load (0s rest) → micro 2 at ~70% load (then normal rest).
  - All micro-sets run in Just Lift mode; progression is forced to 0 for them.
- **Rest-Pause**: On the final set, repeats the weight with short pauses.
  - Sequence: normal last set (15s rest) → micro 1 same load (15s rest) → micro 2 same load (then normal rest).
  - Micro-sets run in Just Lift; progression forced to 0.
- **Slow negatives**: Same structure as Rest-Pause, but both micro-sets are eccentric-only.
  - Sequence: normal last set (15s rest) → micro 1 eccentric-only same load (15s rest) → micro 2 eccentric-only same load (then normal rest).
  - Micro-sets run in Just Lift; mode forced to eccentric-only; progression 0.

## Concrete examples (3×8 @ 20 kg/cable, 60s rest)
- **None**: Set 1 → rest 60s → Set 2 → rest 60s → Set 3 → rest 60s → done.
- **Dropset**: Set 1 → rest 60s → Set 2 → rest 60s → Set 3 (20 kg, rest 0) → Micro 1 (16 kg, rest 0) → Micro 2 (14 kg, rest 60s) → done.
- **Rest-Pause**: Set 1 → rest 60s → Set 2 → rest 60s → Set 3 (20 kg, rest 15s) → Micro 1 (20 kg, rest 15s) → Micro 2 (20 kg, rest 60s) → done.
- **Slow negatives**: Set 1 → rest 60s → Set 2 → rest 60s → Set 3 (20 kg, rest 15s) → Micro 1 (20 kg, eccentric-only, rest 15s) → Micro 2 (20 kg, eccentric-only, rest 60s) → done.

## What gets overridden during a micro-set
- `perCableKg` (dropset only), `justLift: true`, `progressionKg: 0`, and for slow negatives `mode: ProgramMode.ECCENTRIC_ONLY`.
- Rest durations between micro-sets use `restSecOverride` (0s or 15s before returning to the programmed rest).

## Notes and scope
- The intensity selector exists in both the workout-time planner and the main builder so plans stay aligned when synced through Dropbox.
- Device commands stay per-cable; intensity only affects sequencing/rest and (for dropsets) temporary per-cable load reductions on the last set.
