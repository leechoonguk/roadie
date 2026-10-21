import { PermissionsAndroid } from 'react-native';

import { marshallBle } from '../mobile/src/marshallBle';
import { fromBase64, toBase64, UUIDS } from '../src/protocol';

// The react-native-ble-plx transport only: advertisements mapped to the
// shared shape, and a GATT link over base64 values. What the client does with
// a link is in bleClient.test.ts.

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

  const granted = Object.fromEntries(
    Object.values(PermissionsAndroid.PERMISSIONS).map(name => [name, PermissionsAndroid.RESULTS.GRANTED]),
  ) as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>;
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue(granted);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);

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
