import { send } from './device.js';
import { WEIGHT_LIMITS } from './modes.js';

const encoder = new TextEncoder();

export async function startProgram(options = {}) {
  const payload = {
    type: 'program',
    mode: options.mode,
    weightKg: clampKg(toKg(options.weight, options.unit)),
    progressionKg: Number(options.progressionKg || 0),
    reps: Number(options.reps || 0),
    tempo: options.tempo || 'default',
  };

  await transmit('start-program', payload);
}

export async function startEcho(options = {}) {
  const payload = {
    type: 'echo',
    level: options.level,
    weightKg: clampKg(toKg(options.weight, options.unit)),
    durationSec: Number(options.durationSec || 0),
  };

  await transmit('start-echo', payload);
}

export async function stopAll() {
  await transmit('stop-all', {});
}

async function transmit(command, payload) {
  const message = encoder.encode(
    JSON.stringify({ command, timestamp: Date.now(), payload }),
  );
  await send(message);
}

function toKg(value, unit = 'kg') {
  const numeric = Number(value || 0);
  if (unit === 'lb') {
    return numeric / 2.2046226218;
  }
  return numeric;
}

function clampKg(kg) {
  const { minKg, maxKg } = WEIGHT_LIMITS;
  return Math.min(maxKg, Math.max(minKg, kg));
}
