#!/usr/bin/env node

/**
 * Analyze Echo-mode workout JSON files and annotate them with concentric / eccentric metrics.
 *
 * Usage:
 *   node scripts/analyze-echo-workout.mjs path/to/workout.json [...]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { analyzeMovementPhases } from '../shared/echo-telemetry.js';

const formatKg = (kg) => (Number.isFinite(kg) ? kg.toFixed(2) : '0.00');

async function analyzeFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, 'utf8');
  const workout = JSON.parse(raw);
  const analysis = analyzeMovementPhases(workout);
  if (!analysis?.reps?.length) {
    console.log(`[${filePath}] skipped (no reps detected)`);
    return;
  }
  const annotated = {
    ...analysis,
    updatedAt: new Date().toISOString()
  };
  workout.phaseAnalysis = annotated;
  workout.phaseRange = analysis.range;
  if (analysis.isEcho) {
    workout.echoAnalysis = annotated;
    workout.echoRange = analysis.range;
  }

  await fs.writeFile(resolved, `${JSON.stringify(workout, null, 2)}\n`, 'utf8');

  console.log(
    `[${filePath}] reps=${analysis.reps.length} ` +
      `totalConcentric=${formatKg(analysis.totalConcentricKg)}kg ` +
      `maxConcentric=${formatKg(analysis.maxConcentricKg)}kg ` +
      `maxEccentric=${formatKg(analysis.maxEccentricKg)}kg`
  );
}

async function main() {
  const [, , ...files] = process.argv;
  if (!files.length) {
    console.error('Usage: node scripts/analyze-echo-workout.mjs <workout.json> [...]');
    process.exit(1);
  }
  for (const file of files) {
    try {
      await analyzeFile(file);
    } catch (error) {
      console.error(`[${file}] failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

main();
