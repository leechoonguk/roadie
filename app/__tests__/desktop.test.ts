import { setTimeout as flush } from 'node:timers/promises';

import type { ChooserDevice, RoadieBridge } from '../desktop/src/bridge';
import { marshallBle as demoBle, turnKnob } from '../desktop/src/demo/marshallBle';
import { marshallBle } from '../desktop/src/renderer/marshallBle';
import { UUIDS } from '../src/protocol';

// The Web Bluetooth transport only: the chooser standing in for a scan, and a
// GATT link over it. What the client does with a link is in bleClient.test.ts.

/** A characteristic that stores what is written and notifies nothing. */
function fakeCharacteristic(bytes: number[]) {
  let stored: Uint8Array = Uint8Array.from(bytes);
  const written: number[][] = [];
  return {
    written,
    properties: { notify: false },
    readValue: async () => new DataView(stored.slice().buffer),
    writeValueWithResponse: async (value: Uint8Array) => {
      written.push([...value]);
      stored = value;
    },
  };
}

test('a desktop search lists candidates, connecting one answers the request, and writes read back', async () => {
  const volume = fakeCharacteristic([12]);
  const maxVolume = fakeCharacteristic([31]);
  const equalizer = fakeCharacteristic([5, 0xff, 0xff, 0xff, 6]);
  const characteristics: Record<string, unknown> = {
    [UUIDS.volume]: volume,
    [UUIDS.maxVolume]: maxVolume,
    [UUIDS.equalizer]: equalizer,
  };
  const gatt = {
    connected: false,
    connect: jest.fn(async () => {
      gatt.connected = true;
      return server;
    }),
    disconnect: jest.fn(),
  };
  const server = {
    getPrimaryService: jest.fn(async (uuid: string) => {
      if (uuid !== UUIDS.controlService) {
        throw new DOMException('absent', 'NotFoundError');
      }
      return {
        getCharacteristic: async (id: string) => {
          if (!(id in characteristics)) {
            throw new DOMException('absent', 'NotFoundError');
          }
          return characteristics[id];
        },
      };
    }),
  };
  const request = Promise.withResolvers<unknown>();
  let candidates: (devices: ChooserDevice[]) => void = () => undefined;
  const bridge: RoadieBridge = {
    scan: jest.fn(() => {
      globalThis.window.__roadieScan?.();
    }),
    select: jest.fn(() => request.resolve({ id: 'opaque', gatt, addEventListener: jest.fn() })),
    cancel: jest.fn(),
    publish: jest.fn(),
    onDevices: listener => {
      candidates = listener;
    },
    onControl: jest.fn(),
    updateInfo: jest.fn(async () => ({ version: '0.0.0', canCheck: false })),
    checkForUpdates: jest.fn(),
  };
  const bluetooth = {
    requestDevice: () => request.promise,
    getAvailability: async () => true,
    addEventListener: jest.fn(),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { roadie: bridge } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth } });
  const discovered: string[] = [];
  const updates: object[] = [];
  marshallBle.onDeviceDiscovered(device => discovered.push(device.identifier));
  marshallBle.onDeviceUpdated(update => updates.push(update));

  marshallBle.startScan();
  candidates([{ deviceId: 'speaker-1', deviceName: 'ACTON III' }]);
  marshallBle.connect('speaker-1');
  await flush(0);

  expect(discovered).toEqual(['speaker-1']);
  expect(bridge.select).toHaveBeenCalledWith('speaker-1');
  expect(updates).toContainEqual({ identifier: 'speaker-1', isConnected: true, controlState: { maxVolume: 31 } });
  expect(updates).toContainEqual({ identifier: 'speaker-1', isConnected: true, controlState: { bass: 5, treble: 6 } });

  marshallBle.setVolume('speaker-1', 20);
  marshallBle.setEQ('speaker-1', 7, 6);
  await flush(0);

  expect(volume.written).toEqual([[20]]);
  expect(equalizer.written).toEqual([[7, 0xff, 0xff, 0xff, 6]]);
  expect(updates).toContainEqual({ identifier: 'speaker-1', isConnected: true, controlState: { volume: 20 } });
});

test('the demo speaker is found, answers as an ACTON III, stores writes and notifies a knob turn', async () => {
  const discovered: string[] = [];
  const updates: object[] = [];
  demoBle.onDeviceDiscovered(device => discovered.push(device.identifier));
  demoBle.onDeviceUpdated(update => updates.push(update));

  demoBle.startScan();
  await flush(1000);
  expect(discovered).toEqual(['demo-acton-iii']);

  demoBle.connect('demo-acton-iii');
  await flush(500);
  expect(updates).toContainEqual({ identifier: 'demo-acton-iii', isConnected: true, deviceInfo: { model: 'ACTON III' } });
  expect(updates).toContainEqual({ identifier: 'demo-acton-iii', isConnected: true, controlState: { volume: 12 } });

  demoBle.setVolume('demo-acton-iii', 13);
  await flush(200);
  expect(updates).toContainEqual({ identifier: 'demo-acton-iii', isConnected: true, controlState: { volume: 13 } });

  turnKnob('volume', [20]);
  expect(updates).toContainEqual({ identifier: 'demo-acton-iii', isConnected: true, controlState: { volume: 20 } });
});
