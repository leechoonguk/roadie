/**
 * `src/native/marshallBle.ts` for iOS and Android: the same API over
 * react-native-ble-plx, which runs CoreBluetooth on iOS and the Android
 * Bluetooth stack on Android. Metro swaps this file in for the macOS native
 * module on those two platforms (`metro.config.js`), so the screen does not
 * know which it talks to.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Subscription as BleSubscription } from 'react-native-ble-plx';

import type {
  BluetoothState,
  DeviceFailure,
  DeviceUpdate,
  DiscoveredDevice,
} from '../../src/native/marshallBle';
import {
  decodeCharacteristic,
  encodeEQ,
  encodeVolume,
  type EQSettings,
  fromBase64,
  isMarshallCandidate,
  shortServiceUUID,
  toBase64,
  UUIDS,
} from '../../src/protocol';

export type {
  BluetoothState,
  ControlState,
  DeviceFailure,
  DeviceInfo,
  DeviceUpdate,
  DiscoveredDevice,
} from '../../src/native/marshallBle';

interface Subscription {
  remove(): void;
}

/** What a connected speaker needs kept between reports to encode its next write. */
interface Connection {
  maxVolume?: number;
  /** The last EQ read or notified; an EQ write keeps its middle bytes. */
  eq?: EQSettings;
  subscriptions: BleSubscription[];
}

const STATES: Record<State, BluetoothState> = {
  [State.PoweredOn]: 'poweredOn',
  [State.PoweredOff]: 'poweredOff',
  [State.Unauthorized]: 'unauthorized',
  [State.Unsupported]: 'unsupported',
  [State.Resetting]: 'resetting',
  [State.Unknown]: 'unknown',
};

/** Read once on connect; the device information never changes while connected. */
const DEVICE_INFO = [UUIDS.modelNumber, UUIDS.firmwareVersion, UUIDS.serialNumber];
/** Read, then followed: the maximum first, since a volume write before it would clamp to the fallback. */
const CONTROLS = [UUIDS.maxVolume, UUIDS.volume, UUIDS.equalizer];

const listeners = {
  stateChanged: new Set<(state: BluetoothState) => void>(),
  deviceDiscovered: new Set<(device: DiscoveredDevice) => void>(),
  deviceUpdated: new Set<(update: DeviceUpdate) => void>(),
  deviceFailed: new Set<(failure: DeviceFailure) => void>(),
};

const connections = new Map<string, Connection>();
const state = { manager: null as BleManager | null };

export const marshallBle = {
  startScan(): void {
    const ble = manager();
    requestPermissions()
      .then(granted => {
        if (!granted) {
          emit(listeners.stateChanged, 'unauthorized');
          return;
        }
        return ble.startDeviceScan(null, null, (error, device) => {
          if (error !== null) {
            fail('', error.message);
            return;
          }
          if (device === null) {
            return;
          }
          const name = device.localName ?? device.name;
          const services = (device.serviceUUIDs ?? []).map(shortServiceUUID);
          emit(listeners.deviceDiscovered, {
            identifier: device.id,
            name,
            rssi: device.rssi ?? -127,
            advertisedServices: services,
            isMarshallCandidate: isMarshallCandidate(name, services),
          });
        });
      })
      .catch(error => fail('', message(error)));
  },
  stopScan(): void {
    manager().stopDeviceScan().catch(() => undefined);
  },
  connect(identifier: string): void {
    connectDevice(identifier).catch(error => fail(identifier, message(error)));
  },
  disconnect(identifier: string): void {
    manager().cancelDeviceConnection(identifier).catch(error => fail(identifier, message(error)));
  },
  setEQ(identifier: string, bass: number, treble: number): void {
    const connection = connections.get(identifier);
    if (connection === undefined) {
      fail(identifier, 'Device is not connected');
      return;
    }
    if (connection.eq === undefined) {
      fail(identifier, 'EQ is not available on this device yet');
      return;
    }
    write(identifier, UUIDS.equalizer, encodeEQ(connection.eq, bass, treble));
  },
  setVolume(identifier: string, level: number): void {
    const connection = connections.get(identifier);
    if (connection === undefined) {
      fail(identifier, 'Device is not connected');
      return;
    }
    write(identifier, UUIDS.volume, encodeVolume(level, connection.maxVolume));
  },
  onStateChanged(listener: (bluetooth: BluetoothState) => void): Subscription {
    return subscribe(listeners.stateChanged, listener);
  },
  onDeviceDiscovered(listener: (device: DiscoveredDevice) => void): Subscription {
    return subscribe(listeners.deviceDiscovered, listener);
  },
  onDeviceUpdated(listener: (update: DeviceUpdate) => void): Subscription {
    return subscribe(listeners.deviceUpdated, listener);
  },
  onDeviceFailed(listener: (failure: DeviceFailure) => void): Subscription {
    return subscribe(listeners.deviceFailed, listener);
  },
};

/** Created on first use: constructing it starts the native client, which a test may not have. */
function manager(): BleManager {
  if (state.manager === null) {
    const created = new BleManager();
    created.onStateChange(next => emit(listeners.stateChanged, STATES[next]), true);
    state.manager = created;
  }
  return state.manager;
}

/** Android asks at run time; iOS asks on first use from the Info.plist string. */
async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const results = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every(permission => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

async function connectDevice(identifier: string): Promise<void> {
  const ble = manager();
  await ble.connectToDevice(identifier);
  await ble.discoverAllServicesAndCharacteristicsForDevice(identifier);
  const connection: Connection = { subscriptions: [] };
  connections.set(identifier, connection);
  connection.subscriptions.push(
    ble.onDeviceDisconnected(identifier, () => {
      connection.subscriptions.forEach(subscription => subscription.remove());
      connections.delete(identifier);
      emit(listeners.deviceUpdated, { identifier, isConnected: false });
    }),
  );
  emit(listeners.deviceUpdated, { identifier, isConnected: true });

  for (const characteristic of DEVICE_INFO) {
    await read(identifier, UUIDS.deviceInfoService, characteristic);
  }
  if (await read(identifier, UUIDS.batteryService, UUIDS.batteryLevel)) {
    follow(identifier, connection, UUIDS.batteryService, UUIDS.batteryLevel);
  }
  for (const characteristic of CONTROLS) {
    if (await read(identifier, UUIDS.controlService, characteristic)) {
      follow(identifier, connection, UUIDS.controlService, characteristic);
    }
  }
}

/** Reads and reports one value; false when the speaker has no such characteristic. */
async function read(identifier: string, service: string, characteristic: string): Promise<boolean> {
  try {
    const value = await manager().readCharacteristicForDevice(identifier, service, characteristic);
    if (value.value !== null) {
      handleValue(identifier, characteristic, value.value);
    }
    return true;
  } catch {
    return false;
  }
}

/** Follows notifications; a characteristic that cannot notify fails once and is left alone. */
function follow(identifier: string, connection: Connection, service: string, characteristic: string): void {
  connection.subscriptions.push(
    manager().monitorCharacteristicForDevice(identifier, service, characteristic, (error, value) => {
      if (error === null && value?.value != null) {
        handleValue(identifier, characteristic, value.value);
      }
    }),
  );
}

/**
 * The speaker notifies knob turns but not, as far as measured, its own
 * accepted writes; reading back reports the value it actually stored.
 */
function write(identifier: string, characteristic: string, bytes: Uint8Array): void {
  manager()
    .writeCharacteristicWithResponseForDevice(identifier, UUIDS.controlService, characteristic, toBase64(bytes))
    .then(() => read(identifier, UUIDS.controlService, characteristic))
    .catch(error => fail(identifier, message(error)));
}

/** Applies one value: the EQ and maximum are kept for the next write, the rest is reported. */
function handleValue(identifier: string, characteristic: string, base64: string): void {
  const report = decodeCharacteristic(characteristic, fromBase64(base64));
  if (report === null) {
    return;
  }
  const { eq, maxVolume, ...fields } = report;
  const connection = connections.get(identifier);
  if (connection !== undefined) {
    connection.eq = eq ?? connection.eq;
    connection.maxVolume = maxVolume ?? connection.maxVolume;
  }
  emit(listeners.deviceUpdated, { identifier, isConnected: true, ...fields });
}

function fail(identifier: string, text: string): void {
  emit(listeners.deviceFailed, { identifier, message: text });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function subscribe<Value>(set: Set<(value: Value) => void>, listener: (value: Value) => void): Subscription {
  set.add(listener);
  return { remove: () => set.delete(listener) };
}

function emit<Value>(set: Set<(value: Value) => void>, value: Value): void {
  set.forEach(listener => listener(value));
}
