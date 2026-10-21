import { marshallBle } from '../mobile/src/marshallBle';
import {
  decodeCharacteristic,
  fromBase64,
  isMarshallCandidate,
  shortServiceUUID,
  toBase64,
  UUIDS,
} from '../src/protocol';

/** One fake speaker's characteristics, keyed by UUID, holding base64 as ble-plx does. */
const mockStored: Record<string, string> = {};
const mockWritten: Array<[string, string]> = [];
const mockDisconnected: Array<() => void> = [];
const mockScanned: Array<(error: null, device: object) => void> = [];

jest.mock('react-native-ble-plx', () => ({
  State: {
    PoweredOn: 'PoweredOn',
    PoweredOff: 'PoweredOff',
    Unauthorized: 'Unauthorized',
    Unsupported: 'Unsupported',
    Resetting: 'Resetting',
    Unknown: 'Unknown',
  },
  BleManager: jest.fn().mockImplementation(() => ({
    onStateChange: (listener: (state: string) => void) => listener('PoweredOn'),
    startDeviceScan: async (_uuids: null, _options: null, listener: (error: null, device: object) => void) => {
      mockScanned.push(listener);
    },
    stopDeviceScan: async () => undefined,
    connectToDevice: async () => ({}),
    discoverAllServicesAndCharacteristicsForDevice: async () => ({}),
    onDeviceDisconnected: (_id: string, listener: () => void) => {
      mockDisconnected.push(listener);
      return { remove: jest.fn() };
    },
    readCharacteristicForDevice: async (_id: string, _service: string, characteristic: string) => {
      if (!(characteristic in mockStored)) {
        throw new Error('no such characteristic');
      }
      return { value: mockStored[characteristic] };
    },
    writeCharacteristicWithResponseForDevice: async (_id: string, _service: string, characteristic: string, value: string) => {
      mockWritten.push([characteristic, value]);
      mockStored[characteristic] = value;
    },
    monitorCharacteristicForDevice: () => ({ remove: jest.fn() }),
  })),
}));

test('base64 round-trips every length, as ble-plx carries values', () => {
  for (const bytes of [[], [31], [5, 0xff], [5, 0xff, 0xff, 0xff, 4], [0, 1, 2, 3, 4, 5]]) {
    const encoded = toBase64(Uint8Array.from(bytes));
    expect([...fromBase64(encoded)]).toEqual(bytes);
  }
  // Fixed points from a reference encoder: padding for one and two trailing bytes.
  expect(toBase64(Uint8Array.from([31]))).toBe('Hw==');
  expect(toBase64(Uint8Array.from([5, 0xff]))).toBe('Bf8=');
  expect(toBase64(Uint8Array.from([5, 0xff, 0xff, 0xff, 4]))).toBe('Bf///wQ=');
});

test('advertised services read as CoreBluetooth spells them, and candidates match the Swift rule', () => {
  expect(shortServiceUUID(UUIDS.controlService)).toBe('FCCD');
  expect(shortServiceUUID(UUIDS.volume)).toBe(UUIDS.volume.toUpperCase());
  expect(isMarshallCandidate(null, ['FCCD'])).toBe(true);
  expect(isMarshallCandidate('Acton III [LE]', [])).toBe(true);
  expect(isMarshallCandidate('AirPods Pro', ['180F'])).toBe(false);
});

test('one characteristic value decodes to the fields its report carries', () => {
  expect(decodeCharacteristic(UUIDS.serialNumber, Uint8Array.from([0x41, 0x31, 0]))).toEqual({
    deviceInfo: { serialNumber: 'A1' },
  });
  expect(decodeCharacteristic(UUIDS.maxVolume.toUpperCase(), Uint8Array.from([31]))).toEqual({
    controlState: { maxVolume: 31 },
    maxVolume: 31,
  });
  expect(decodeCharacteristic(UUIDS.batteryLevel, Uint8Array.from([101]))).toBeNull();
});

test('a phone search reports speakers, connecting reads them, and a write reads back', async () => {
  Object.assign(mockStored, {
    [UUIDS.modelNumber]: toBase64(Uint8Array.from('ACTON III', character => character.charCodeAt(0))),
    [UUIDS.maxVolume]: toBase64(Uint8Array.from([31])),
    [UUIDS.volume]: toBase64(Uint8Array.from([12])),
    [UUIDS.equalizer]: toBase64(Uint8Array.from([5, 0xff, 0xff, 0xff, 6])),
  });
  const discovered: object[] = [];
  const updates: object[] = [];
  const states: string[] = [];
  marshallBle.onStateChanged(state => states.push(state));
  marshallBle.onDeviceDiscovered(device => discovered.push(device));
  marshallBle.onDeviceUpdated(update => updates.push(update));

  marshallBle.startScan();
  await flush();
  mockScanned[0](null, {
    id: 'phone-id',
    name: null,
    localName: 'ACTON III',
    rssi: -48,
    serviceUUIDs: [UUIDS.controlService],
  });
  marshallBle.connect('phone-id');
  await flush();

  expect(states).toEqual(['poweredOn']);
  expect(discovered).toEqual([
    { identifier: 'phone-id', name: 'ACTON III', rssi: -48, advertisedServices: ['FCCD'], isMarshallCandidate: true },
  ]);
  expect(updates).toContainEqual({ identifier: 'phone-id', isConnected: true, deviceInfo: { model: 'ACTON III' } });
  expect(updates).toContainEqual({ identifier: 'phone-id', isConnected: true, controlState: { bass: 5, treble: 6 } });

  marshallBle.setVolume('phone-id', 40);
  marshallBle.setEQ('phone-id', 7, 6);
  await flush();

  expect(mockWritten.map(([uuid, value]) => [uuid, [...fromBase64(value)]])).toEqual([
    [UUIDS.volume, [31]],
    [UUIDS.equalizer, [7, 0xff, 0xff, 0xff, 6]],
  ]);
  expect(updates).toContainEqual({ identifier: 'phone-id', isConnected: true, controlState: { volume: 31 } });

  mockDisconnected[0]();
  expect(updates[updates.length - 1]).toEqual({ identifier: 'phone-id', isConnected: false });
});

/** Lets the connect sequence run to the end: each step awaits a promise of its own. */
function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
