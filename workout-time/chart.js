// Ring buffer + canvas drawing + throttled redraw

export function createRingBuffer(capacity = 2 * 60 * 60 * 10) { // default 2h @ 10 Hz
  let buf = new Array(capacity);
  let head = 0, size = 0;
  function push(sample) { buf[head] = sample; head = (head + 1) % capacity; size = Math.min(size + 1, capacity); }
  function toArray() {
    const out = new Array(size);
    for (let i=0; i<size; i++) out[i] = buf[(head - size + i + capacity) % capacity];
    return out;
  }
  function sliceSince(msAgo, now = performance.now()) {
    const minT = now - msAgo;
    return toArray().filter(s => s.t >= minT);
  }
  return { push, toArray, sliceSince };
}

export function throttle(fn, minMs=120) {
  let last = 0, pending = false;
  return (...args) => {
    const now = performance.now();
    if (now - last >= minMs) { last = now; fn(...args); }
    else if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; if (performance.now() - last >= minMs) { last = performance.now(); fn(...args); } }); }
  };
}

export function drawLine(canvas, samples, pick = s => s.value) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);
  if (!samples.length) return;

  const xs = samples.map(s => s.t);
  const ys = samples.map(pick);
  const tMin = Math.min(...xs), tMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const x = (t) => (t - tMin) / (tMax - tMin || 1) * (w - 20) + 10;
  const y = (v) => h - ((v - yMin) / (yMax - yMin || 1) * (h - 20) + 10);

  ctx.beginPath();
  ctx.moveTo(x(xs[0]), y(ys[0]));
  for (let i=1;i<samples.length;i++) ctx.lineTo(x(xs[i]), y(ys[i]));
  ctx.stroke();
}
