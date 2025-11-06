/**
 * Protocol layer:
 * - Translate UI intents -> Uint8Array commands
 * - Parse notifications -> structured telemetry
 * NOTE: Byte layout must be filled per device spec.
 */

import * as Device from './device.js';

const listeners = new Set();
let _unsub = null;

export function start() {
  stop();
  _unsub = Device.onNotify(handleNotify);
}
export function stop() {
  if (_unsub) { _unsub(); _unsub = null; }
}

export function onTelemetry(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function startProgram({ mode, loadKg, progKgPerRep, reps, justLift }) {
  const cmd = encodeProgram({ mode, loadKg, progKgPerRep, reps, justLift });
  await Device.write(cmd);
}
export async function startEcho({ level, eccPct, reps, justLift }) {
  const cmd = encodeEcho({ level, eccPct, reps, justLift });
  await Device.write(cmd);
}
export async function stopAll() {
  await Device.write(encodeStop());
}

/** ===== ENCODERS (PLACEHOLDERS) ===== */
function encodeProgram(opts) { return encodeCommand(0x10, opts); }
function encodeEcho(opts)    { return encodeCommand(0x20, opts); }
function encodeStop()        { return new Uint8Array([0xff]); }

/** Example: turn an object into bytes. Replace with real mapping. */
function encodeCommand(opcode, obj) {
  const json = JSON.stringify({ opcode, ...obj });
  const bytes = new TextEncoder().encode(json);
  return bytes;
}

/** ===== NOTIFICATION PARSER (PLACEHOLDER) =====
 * Expect: parse to { left: number, right: number, total: number, atTop?: boolean }
 */
function handleNotify(dv /** DataView */) {
  // TODO: Replace with real binary parsing.
  const str = new TextDecoder().decode(new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)));
  let left=0, right=0, total=0, atTop=false;
  try {
    const obj = JSON.parse(str);
    left = +obj.left || 0;
    right = +obj.right || 0;
    total = +obj.total || (left + right);
    atTop = !!obj.atTop;
  } catch { /* ignore */ }

  const payload = { left, right, total, atTop };
  listeners.forEach(fn => fn(payload));
}
