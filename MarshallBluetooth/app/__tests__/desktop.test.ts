import { setTimeout as flush } from 'node:timers/promises';

import type { ChooserDevice, RoadieBridge } from '../desktop/src/bridge';
import {
  decodeBattery,
  decodeEQ,
  decodeString,
  decodeVolume,
  encodeEQ,
  encodeVolume,
  UUIDS,
} from '../src/protocol';
import { marshallBle } from '../desktop/src/renderer/marshallBle';
import { offsetFromFlat, trayStep } from '../desktop/src/tray';
import type { WidgetPayload } from '../src/native/widgetBridge';

// Byte values match `MarshallProtocolTests.swift`, measured on an ACTON III.

test('EQ decodes bass from the first byte and treble from the last', () => {
  expect(decodeEQ(Uint8Array.from([0x05, 0xff, 0xff, 0xff, 0x04]))).toEqual({
    bass: 5,
    treble: 4,
    middle: [0xff, 0xff, 0xff],
  });
});

test('an EQ write keeps the middle bytes it was read with and clamps the bands', () => {
  const read = decodeEQ(Uint8Array.from([0x05, 0x12, 0x34, 0x56, 0x04]))!;
  expect([...encodeEQ(read, 7, 3)]).toEqual([0x07, 0x12, 0x34, 0x56, 0x03]);
  expect([...encodeEQ(read, -3, 14)]).toEqual([0x00, 0x12, 0x34, 0x56, 0x0a]);
});

test.each([
  [[0x05, 0xff, 0xff, 0xff]],
  [[0x05, 0xff, 0xff, 0xff, 0x04, 0x00]],
  [[0x0b, 0xff, 0xff, 0xff, 0x04]],
  [[0x05, 0xff, 0xff, 0xff, 0x0b]],
])('EQ values outside the measured layout are rejected: %j', bytes => {
  expect(decodeEQ(Uint8Array.from(bytes))).toBeNull();
});

test('volume is one byte clamped to the device maximum', () => {
  expect(decodeVolume(Uint8Array.from([0x0f]))).toBe(15);
  expect(decodeVolume(Uint8Array.from([0x0f, 0x00]))).toBeNull();
  expect([...encodeVolume(40, 31)]).toEqual([31]);
  expect([...encodeVolume(40, undefined)]).toEqual([31]);
  expect([...encodeVolume(-2, 31)]).toEqual([0]);
});

test('battery above 100 is malformed, and device strings lose their NUL padding', () => {
  expect(decodeBattery(Uint8Array.from([100]))).toBe(100);
  expect(decodeBattery(Uint8Array.from([101]))).toBeNull();
  expect(decodeString(new TextEncoder().encode('ACTON III\0\0'))).toBe('ACTON III');
  expect(decodeString(Uint8Array.from([0, 0]))).toBeNull();
});

const payload: WidgetPayload = {
  name: 'ACTON III',
  identifier: 'A',
  isConnected: true,
  model: 'ACTON III',
  batteryPercent: null,
  volume: 30,
  maxVolume: 31,
  bass: 5,
  treble: 9,
};

test('a tray step moves from the last reading and stops at the ends', () => {
  expect(trayStep(payload, { kind: 'volume', step: 1 })?.request).toEqual({ kind: 'volume', identifier: 'A', level: 31 });
  expect(trayStep({ ...payload, volume: 31 }, { kind: 'volume', step: 1 })?.request).toEqual({
    kind: 'volume',
    identifier: 'A',
    level: 31,
  });
  expect(trayStep(payload, { kind: 'treble', step: 1 })?.request).toEqual({ kind: 'eq', identifier: 'A', bass: 5, treble: 10 });
  expect(trayStep(payload, { kind: 'flat' })?.payload).toMatchObject({ bass: 5, treble: 5 });
});

test('the tray does nothing on an unread value or a disconnected speaker', () => {
  expect(trayStep({ ...payload, volume: null }, { kind: 'volume', step: -1 })).toBeNull();
  expect(trayStep({ ...payload, bass: null }, { kind: 'treble', step: 1 })).toBeNull();
  expect(trayStep({ ...payload, bass: null }, { kind: 'flat' })).toBeNull();
  expect(trayStep({ ...payload, isConnected: false }, { kind: 'volume', step: 1 })).toBeNull();
  expect(trayStep(null, { kind: 'volume', step: 1 })).toBeNull();
});

test('EQ offsets read from flat', () => {
  expect([0, 5, 8].map(offsetFromFlat)).toEqual(['-5', '0', '+3']);
});

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
  await flush();

  expect(discovered).toEqual(['speaker-1']);
  expect(bridge.select).toHaveBeenCalledWith('speaker-1');
  expect(updates).toContainEqual({ identifier: 'speaker-1', isConnected: true, controlState: { maxVolume: 31 } });
  expect(updates).toContainEqual({ identifier: 'speaker-1', isConnected: true, controlState: { bass: 5, treble: 6 } });

  marshallBle.setVolume('speaker-1', 20);
  marshallBle.setEQ('speaker-1', 7, 6);
  await flush();

  expect(volume.written).toEqual([[20]]);
  expect(equalizer.written).toEqual([[7, 0xff, 0xff, 0xff, 6]]);
  expect(updates).toContainEqual({ identifier: 'speaker-1', isConnected: true, controlState: { volume: 20 } });
});
