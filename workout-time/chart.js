export function createChart({ canvasId, capacity = 120, throttleMs = 200 } = {}) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas ? canvas.getContext('2d') : null;
  const buffer = [];
  let scheduled = null;
  let lastRender = 0;

  function push(sample) {
    buffer.push({ ...sample, time: Date.now() });
    if (buffer.length > capacity) {
      buffer.shift();
    }
    scheduleRender();
  }

  function scheduleRender() {
    if (!ctx) {
      return;
    }
    const now = performance.now();
    const elapsed = now - lastRender;
    if (elapsed >= throttleMs) {
      render();
      return;
    }
    if (!scheduled) {
      scheduled = setTimeout(() => {
        scheduled = null;
        render();
      }, throttleMs - elapsed);
    }
  }

  function render() {
    if (!ctx || !canvas) {
      return;
    }
    lastRender = performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (buffer.length === 0) {
      return;
    }

    const values = buffer.map((point) => point.total);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#667eea';
    ctx.beginPath();

    buffer.forEach((point, index) => {
      const x = (index / (buffer.length - 1 || 1)) * canvas.width;
      const y = canvas.height - ((point.total - min) / range) * canvas.height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  return { push, render };
}
