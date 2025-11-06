/**
 * Web Bluetooth transport abstraction.
 * - Connect/disconnect
 * - Notifications -> raw DataView frames
 * - Write queuing to TX characteristic
 *
 * FILL UUIDS per device documentation.
 */
const SERVICE_UUID = '00000000-0000-0000-0000-000000000000'; // TODO
const RX_CHAR_UUID = '00000000-0000-0000-0000-000000000001'; // notifications from device
const TX_CHAR_UUID = '00000000-0000-0000-0000-000000000002'; // writes to device

let _server, _service, _rx, _tx;
let _notifyHandlers = new Set();
let _writeQueue = Promise.resolve();

export async function connect() {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID]
  });
  device.addEventListener('gattserverdisconnected', () => console.warn('BLE disconnected'));
  _server = await device.gatt.connect();
  _service = await _server.getPrimaryService(SERVICE_UUID);
  _rx = await _service.getCharacteristic(RX_CHAR_UUID);
  _tx = await _service.getCharacteristic(TX_CHAR_UUID);

  await _rx.startNotifications();
  _rx.addEventListener('characteristicvaluechanged', (ev) => {
    const dv = ev.target.value;
    _notifyHandlers.forEach(fn => fn(dv));
  });

  return { device, server: _server };
}

export async function disconnect() {
  try { await _rx?.stopNotifications(); } catch {}
  try { _server?.disconnect(); } catch {}
  _server = _service = _rx = _tx = undefined;
}

export function onNotify(fn) { _notifyHandlers.add(fn); return () => _notifyHandlers.delete(fn); }

export function write(bytes) {
  if (!_tx) throw new Error('BLE TX not ready');
  // Queue writes to preserve order
  _writeQueue = _writeQueue.then(() => _tx.writeValue(bytes));
  return _writeQueue;
}
