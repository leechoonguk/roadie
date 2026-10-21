import { type BleTransport, createMarshallBle } from '../src/ble/client';
import type { DeviceUpdate } from '../src/native/marshallBle';
import { UUIDS } from '../src/protocol';

/** One fake speaker over a fake transport: characteristics hold bytes, links are counted. */
function speaker(initial: Record<string, number[]>) {
  const stored: Record<string, number[]> = { ...initial };
  const reads: string[] = [];
  const writes: Array<[string, number[]]> = [];
  const watched: Record<string, (value: Uint8Array) => void> = {};
  const links = { opened: 0, open: 0 };
  let drop: () => void = () => undefined;
  const transport: BleTransport = {
    watchState: listener => listener('poweredOn'),
    startScan: onDevice =>
      onDevice({ identifier: 'A', name: 'ACTON III', rssi: -50, advertisedServices: ['FCCD'], isMarshallCandidate: true }),
    stopScan: jest.fn(),
    connect: async (_identifier, onDisconnect) => {
      links.opened += 1;
      links.open += 1;
      drop = () => {
        links.open -= 1;
        onDisconnect();
      };
      return {
        read: async (_service, characteristic) => {
          reads.push(characteristic);
          return characteristic in stored ? Uint8Array.from(stored[characteristic]) : null;
        },
        write: async (_service, characteristic, value) => {
          writes.push([characteristic, [...value]]);
          stored[characteristic] = [...value];
        },
        watch: async (_service, characteristic, listener) => {
          watched[characteristic] = listener;
        },
        disconnect: async () => drop(),
      };
    },
  };
  /** The knob turned on the speaker itself while nothing was connected. */
  const turn = (characteristic: string, value: number[]) => {
    stored[characteristic] = value;
  };
  return { transport, reads, writes, watched, links, turn };
}

const ACTON = {
  [UUIDS.modelNumber]: [...'ACTON III'].map(character => character.charCodeAt(0)),
  [UUIDS.batteryLevel]: [80],
  [UUIDS.maxVolume]: [31],
  [UUIDS.volume]: [12],
  [UUIDS.equalizer]: [5, 0xff, 0xff, 0xff, 6],
};

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

test('connecting reports the device, follows the controls, and a write reads back what was stored', async () => {
  const fake = speaker(ACTON);
  const ble = createMarshallBle(fake.transport);
  const updates: DeviceUpdate[] = [];
  const states: string[] = [];
  ble.onDeviceUpdated(update => updates.push(update));
  ble.onStateChanged(state => states.push(state));

  ble.connect('A');
  await flush();

  expect(states).toEqual(['poweredOn']);
  expect(updates).toEqual([
    { identifier: 'A', isConnected: true },
    { identifier: 'A', isConnected: true, deviceInfo: { model: 'ACTON III' } },
    { identifier: 'A', isConnected: true, batteryPercent: 80 },
    { identifier: 'A', isConnected: true, controlState: { maxVolume: 31 } },
    { identifier: 'A', isConnected: true, controlState: { volume: 12 } },
    { identifier: 'A', isConnected: true, controlState: { bass: 5, treble: 6 } },
  ]);
  expect(Object.keys(fake.watched).sort()).toEqual([UUIDS.batteryLevel, UUIDS.equalizer, UUIDS.maxVolume, UUIDS.volume].sort());

  ble.setVolume('A', 40);
  ble.setEQ('A', 7, 6);
  await flush();

  // The volume clamps to the speaker's own maximum; the EQ keeps the middle bytes it read.
  expect(fake.writes).toEqual([
    [UUIDS.volume, [31]],
    [UUIDS.equalizer, [7, 0xff, 0xff, 0xff, 6]],
  ]);
  expect(updates.slice(-2)).toEqual([
    { identifier: 'A', isConnected: true, controlState: { volume: 31 } },
    { identifier: 'A', isConnected: true, controlState: { bass: 7, treble: 6 } },
  ]);
});

test('a knob turn the speaker notifies moves the next step', async () => {
  const fake = speaker(ACTON);
  const ble = createMarshallBle(fake.transport);
  ble.connect('A');
  await flush();

  fake.watched[UUIDS.volume](Uint8Array.from([20]));
  await ble.applyStep('A', { kind: 'volume', step: 1 });

  expect(fake.writes).toEqual([[UUIDS.volume, [21]]]);
  expect(fake.links.opened).toBe(1);
});

test('a press with nothing connected connects for itself, steps from the speaker, and disconnects', async () => {
  const fake = speaker(ACTON);
  const ble = createMarshallBle(fake.transport);
  // The widget was drawn at 12; the knob has since moved the speaker to 25.
  fake.turn(UUIDS.volume, [25]);

  const values = await ble.applyStep('A', { kind: 'volume', step: -1 });

  expect(fake.writes).toEqual([[UUIDS.volume, [24]]]);
  expect(values).toEqual({ volume: 24, maxVolume: 31, bass: 5, treble: 6 });
  expect(fake.links).toEqual({ opened: 1, open: 0 });
  // Only the controls are read for a press — not the device information or the battery.
  expect(new Set(fake.reads)).toEqual(new Set([UUIDS.maxVolume, UUIDS.volume, UUIDS.equalizer]));
  expect(fake.watched).toEqual({});
});

test('a press at the end of a scale, or on a value the speaker lacks, writes nothing', async () => {
  const fake = speaker({ ...ACTON, [UUIDS.volume]: [31] });
  const ble = createMarshallBle(fake.transport);

  await ble.applyStep('A', { kind: 'volume', step: 1 });
  const withoutEQ = speaker({ [UUIDS.volume]: [3] });
  const values = await createMarshallBle(withoutEQ.transport).applyStep('A', { kind: 'flat' });

  expect(fake.writes).toEqual([]);
  expect(withoutEQ.writes).toEqual([]);
  expect(values).toEqual({ volume: 3, maxVolume: null, bass: null, treble: null });
  expect(withoutEQ.links.open).toBe(0);
});

test('a write to a speaker that is not connected is reported, not attempted', () => {
  const fake = speaker(ACTON);
  const ble = createMarshallBle(fake.transport);
  const failures: string[] = [];
  ble.onDeviceFailed(failure => failures.push(failure.message));

  ble.setVolume('A', 3);

  expect(failures).toEqual(['Device is not connected']);
  expect(fake.writes).toEqual([]);
});
