const LB_PER_KG = 2.2046226218488;
const DEFAULT_DEADBAND = 5;
const DEFAULT_MIN_RANGE = 120;

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeMovementPoints = (movementData = [], options = {}) => {
  const includeWarmup = options.includeWarmup === true;
  const warmupCutoff = includeWarmup ? null : toTimestamp(options.warmupEndTime);
  const filtered = movementData
    .map((point) => {
      const ts = toTimestamp(point?.timestamp);
      if (!ts) return null;
      if (warmupCutoff && ts < warmupCutoff) {
        return null;
      }
      const loadA = toNumber(point.loadA);
      const loadB = toNumber(point.loadB);
      const posA = toNumber(point.posA);
      const posB = toNumber(point.posB);
      const totalLoadKg = Math.max(loadA, loadB, 0);
      const avgPos = (posA + posB) / 2;
      return { ts, loadKg: totalLoadKg, avgPos };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
  return filtered;
};

const segmentMovementPoints = (points, options = {}) => {
  const deadband = Number.isFinite(options.deadband) ? Math.max(0, options.deadband) : DEFAULT_DEADBAND;
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const segments = [];
  let current = { dir: null, samples: [points[0]] };
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const delta = curr.avgPos - prev.avgPos;
    if (Math.abs(delta) <= deadband) {
      current.samples.push(curr);
      continue;
    }
    const direction = delta > 0 ? 1 : -1;
    if (current.dir === null) {
      current.dir = direction;
      current.samples.push(curr);
      continue;
    }
    if (direction === current.dir) {
      current.samples.push(curr);
      continue;
    }
    segments.push(current);
    current = { dir: direction, samples: [prev, curr] };
  }
  if (current.samples.length > 1 && current.dir !== null) {
    segments.push(current);
  }
  return segments;
};

const pairSegments = (segments) => {
  const pairs = [];
  let i = 0;
  while (i < segments.length - 1) {
    const conc = segments[i];
    const ecc = segments[i + 1];
    if (conc.dir === 1 && ecc.dir === -1) {
      pairs.push([conc, ecc]);
      i += 2;
    } else {
      i += 1;
    }
  }
  return pairs;
};

const getRangeFromSamples = (samples) => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { bottom: null, top: null };
  }
  let bottom = Infinity;
  let top = -Infinity;
  samples.forEach((sample) => {
    if (!sample) return;
    if (sample.avgPos < bottom) bottom = sample.avgPos;
    if (sample.avgPos > top) top = sample.avgPos;
  });
  if (bottom === Infinity) bottom = null;
  if (top === -Infinity) top = null;
  return { bottom, top };
};

export const isEchoWorkout = (workout) => {
  if (!workout || typeof workout !== 'object') {
    return false;
  }
  const itemType = String(workout.itemType || '').toLowerCase();
  if (itemType.includes('echo')) {
    return true;
  }
  const mode = String(workout.mode || '').toLowerCase();
  return mode.includes('echo');
};

export const analyzeEchoWorkout = (workout, options = {}) => {
  if (!workout || typeof workout !== 'object') {
    return {
      isEcho: false,
      reps: [],
      totalConcentricKg: 0,
      totalEccentricKg: 0,
      maxConcentricKg: 0,
      maxEccentricKg: 0,
      range: { bottom: null, top: null }
    };
  }

  const movementData = Array.isArray(workout.movementData) ? workout.movementData : [];
  const processed = normalizeMovementPoints(movementData, {
    warmupEndTime: options.warmupEndTime || workout.warmupEndTime,
    includeWarmup: options.includeWarmup === true
  });
  if (!processed.length) {
    return {
      isEcho: isEchoWorkout(workout),
      reps: [],
      totalConcentricKg: 0,
      totalEccentricKg: 0,
      maxConcentricKg: 0,
      maxEccentricKg: 0,
      range: { bottom: null, top: null }
    };
  }

  const segments = segmentMovementPoints(processed, { deadband: options.deadband || DEFAULT_DEADBAND });
  const pairs = pairSegments(segments);
  const minRange = Number.isFinite(options.minRange) ? options.minRange : DEFAULT_MIN_RANGE;

  const reps = [];
  let totalConcentricKg = 0;
  let totalEccentricKg = 0;
  let maxConcentricKg = 0;
  let maxEccentricKg = 0;

  pairs.forEach(([concentric, eccentric], index) => {
    if (!concentric || !eccentric) return;
    const concRange = getRangeFromSamples(concentric.samples);
    const eccRange = getRangeFromSamples(eccentric.samples);
    const amplitude = Math.abs((concRange.top ?? 0) - (concRange.bottom ?? 0));
    const reverseAmplitude = Math.abs((eccRange.top ?? 0) - (eccRange.bottom ?? 0));
    if (amplitude < minRange || reverseAmplitude < minRange) {
      return;
    }
    const concPeak = Math.max(...concentric.samples.map((sample) => sample.loadKg || 0), 0);
    const eccPeak = Math.max(...eccentric.samples.map((sample) => sample.loadKg || 0), 0);
    totalConcentricKg += concPeak;
    totalEccentricKg += eccPeak;
    if (concPeak > maxConcentricKg) maxConcentricKg = concPeak;
    if (eccPeak > maxEccentricKg) maxEccentricKg = eccPeak;

    const bottom = Math.min(
      concRange.bottom ?? Infinity,
      eccRange.bottom ?? Infinity
    );
    const top = Math.max(
      concRange.top ?? -Infinity,
      eccRange.top ?? -Infinity
    );
    reps.push({
      index: reps.length + 1,
      concentricPeakKg: concPeak,
      eccentricPeakKg: eccPeak,
      startTime: concentric.samples[0]?.ts ?? null,
      endTime: eccentric.samples[eccentric.samples.length - 1]?.ts ?? null,
      range: {
        bottom: Number.isFinite(bottom) ? bottom : null,
        top: Number.isFinite(top) ? top : null
      }
    });
  });

  const overallRange = getRangeFromSamples(processed);
  return {
    isEcho: isEchoWorkout(workout),
    hasReps: reps.length > 0,
    reps,
    totalConcentricKg,
    totalEccentricKg,
    maxConcentricKg,
    maxEccentricKg,
    range: overallRange
  };
};

export const analyzeMovementPhases = (workout, options = {}) => analyzeEchoWorkout(workout, options);

const sharedApi = {
  analyzeMovementPhases,
  analyzeEchoWorkout,
  isEchoWorkout,
  LB_PER_KG
};

if (typeof globalThis !== 'undefined') {
  globalThis.EchoTelemetry = {
    ...(globalThis.EchoTelemetry || {}),
    ...sharedApi
  };
}

export default sharedApi;
