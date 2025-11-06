const telemetryHandlers = new Set();
let activeConnection = null;
let processingQueue = false;
const writeQueue = [];

export async function connect() {
  if (activeConnection) {
    return activeConnection;
  }

  if (!navigator.bluetooth) {
    activeConnection = createMockConnection('Mock Vitruvian');
    return activeConnection;
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['device_information'] }],
    optionalServices: ['battery_service'],
  });

  activeConnection = {
    device,
    async disconnect() {
      if (device && device.gatt && device.gatt.connected) {
        await device.gatt.disconnect();
      }
      activeConnection = null;
    },
    get name() {
      return device.name || 'Vitruvian';
    },
  };

  return activeConnection;
}

export function disconnect() {
  if (activeConnection && typeof activeConnection.disconnect === 'function') {
    activeConnection.disconnect();
  }
  activeConnection = null;
}

export function onTelemetry(handler) {
  telemetryHandlers.add(handler);
  return () => telemetryHandlers.delete(handler);
}

export function emitTelemetry(sample) {
  for (const handler of telemetryHandlers) {
    handler(sample.left, sample.right, sample.total);
  }
}

export async function send(bytes) {
  if (!activeConnection) {
    throw new Error('No active device connection');
  }
  writeQueue.push(bytes.slice());
  if (!processingQueue) {
    await flushQueue();
  }
}

async function flushQueue() {
  processingQueue = true;
  try {
    while (writeQueue.length > 0) {
      const payload = writeQueue.shift();
      await writePayload(payload);
    }
  } finally {
    processingQueue = false;
  }
}

async function writePayload(bytes) {
  if (activeConnection && activeConnection.isMock) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return;
  }
  console.debug('Write payload', bytes);
}

function createMockConnection(name) {
  const connection = {
    isMock: true,
    name,
    disconnect() {
      activeConnection = null;
    },
  };

  // emit steady telemetry so the UI has something to render
  let counter = 0;
  const interval = setInterval(() => {
    if (activeConnection !== connection) {
      clearInterval(interval);
      return;
    }
    counter += 1;
    emitTelemetry({
      left: 5 + Math.sin(counter / 4) * 2,
      right: 5 + Math.cos(counter / 4) * 2,
      total: 10 + Math.sin(counter / 3),
    });
  }, 500);

  return connection;
}
