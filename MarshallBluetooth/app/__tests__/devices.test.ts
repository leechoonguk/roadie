import {
  applyDiscovered,
  applyUpdate,
  type DeviceRow,
  displayName,
  speakerRows,
  toWidgetPayload,
} from '../src/devices';

const acton: DeviceRow = {
  identifier: 'A',
  name: 'ACTON III',
  rssi: -60,
  advertisedServices: ['FCCD'],
  isMarshallCandidate: true,
  batteryPercent: 80,
  isConnected: true,
  deviceInfo: {},
  controlState: {},
};

test('a re-advertising device keeps the battery and connection its connection reported', () => {
  const rows = applyDiscovered([acton], {
    identifier: 'A',
    name: 'ACTON III',
    rssi: -40,
    advertisedServices: ['FCCD'],
    isMarshallCandidate: true,
  });

  expect(rows).toEqual([{ ...acton, rssi: -40 }]);
});

test('a new device starts disconnected with no battery reading', () => {
  const rows = applyDiscovered([], {
    identifier: 'B',
    name: null,
    rssi: -70,
    advertisedServices: [],
    isMarshallCandidate: false,
  });

  expect(rows[0]).toMatchObject({ batteryPercent: null, isConnected: false });
});

test('a disconnect keeps the last battery reading instead of erasing it', () => {
  const rows = applyUpdate([acton], { identifier: 'A', isConnected: false });

  expect(rows).toEqual([{ ...acton, isConnected: false }]);
});

test('a partial report keeps the fields earlier reports filled in', () => {
  const known: DeviceRow = {
    ...acton,
    deviceInfo: { model: 'ACTON III' },
    controlState: { volume: 14, maxVolume: 31, bass: 5, treble: 4 },
  };

  const [row] = applyUpdate([known], {
    identifier: 'A',
    isConnected: true,
    deviceInfo: { firmwareVersion: '1.2.3' },
    controlState: { volume: 20 },
  });

  expect(row.deviceInfo).toEqual({ model: 'ACTON III', firmwareVersion: '1.2.3' });
  expect(row.controlState).toEqual({ volume: 20, maxVolume: 31, bass: 5, treble: 4 });
});

test('an update for a device the list never saw changes nothing', () => {
  expect(
    applyUpdate([acton], { identifier: 'Z', batteryPercent: 5, isConnected: true }),
  ).toEqual([acton]);
});

test('only Marshall speakers are listed', () => {
  const phone = { ...acton, identifier: 'P', name: 'iPhone', isMarshallCandidate: false, rssi: -30 };

  expect(speakerRows([phone, acton]).map(row => row.identifier)).toEqual(['A']);
});

test("a speaker's two BLE identities collapse to the one carrying the control service", () => {
  // Measured: one ACTON III advertises as two identities named "ACTON III [LE]".
  const withControls = { ...acton, identifier: 'C', name: 'ACTON III [LE]', isConnected: false, rssi: -45 };
  const without = { ...withControls, identifier: 'N', advertisedServices: [], rssi: -35 };

  expect(speakerRows([without, withControls]).map(row => row.identifier)).toEqual(['C']);
});

test('the connected identity wins over a stronger one that is not', () => {
  const idle = { ...acton, identifier: 'I', isConnected: false, rssi: -30 };

  expect(speakerRows([idle, acton]).map(row => row.identifier)).toEqual(['A']);
});

test('the BLE identity suffix is not shown', () => {
  expect(displayName({ ...acton, name: 'ACTON III [LE]' })).toBe('ACTON III');
});

test('the widget payload names an unnamed device and sends unknown readings as null', () => {
  expect(toWidgetPayload({ ...acton, name: null, controlState: { volume: 14 } })).toEqual({
    name: 'Unnamed device',
    identifier: 'A',
    isConnected: true,
    model: null,
    batteryPercent: 80,
    volume: 14,
    maxVolume: null,
    bass: null,
    treble: null,
  });
});
