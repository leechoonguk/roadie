/**
 * `app/src/native/marshallBle.ts` for Windows and Linux: the same API over Web
 * Bluetooth, which Chromium runs on WinRT (Windows) and BlueZ (Linux). The
 * desktop bundle swaps this file in for the React Native one, so the screen
 * does not know which it talks to.
 *
 * Web Bluetooth has no scan API: a device request opens a chooser, and the
 * main process answers it. So a scan is one pending request whose candidate
 * list main forwards here, and connecting to a candidate answers the request.
 */
import type {
  BluetoothState,
  DeviceFailure,
  DeviceUpdate,
  DiscoveredDevice,
} from '../../../src/native/marshallBle';
import type { ChooserDevice, RoadieBridge } from '../bridge';
import {
  decodeCharacteristic,
  encodeEQ,
  encodeVolume,
  type EQSettings,
  UUIDS,
} from '../../../src/protocol';

export type {
  BluetoothState,
  ControlState,
  DeviceFailure,
  DeviceInfo,
  DeviceUpdate,
  DiscoveredDevice,
} from '../../../src/native/marshallBle';

interface Subscription {
  remove(): void;
}

/** One speaker the user has chosen at least once, connected or not. */
interface Connection {
  device: BluetoothDevice;
  volume?: BluetoothRemoteGATTCharacteristic;
  equalizer?: BluetoothRemoteGATTCharacteristic;
  maxVolume?: number;
  /** The last EQ read or notified; an EQ write keeps its middle bytes. */
  eq?: EQSettings;
  /** GATT operations run one at a time: Chromium rejects a second in flight. */
  queue: Promise<unknown>;
}

declare global {
  interface Window {
    roadie: RoadieBridge;
    __roadieScan?: () => Promise<void>;
  }
}

/** Only the identity advertising the control service is listed: the speaker's other BLE identity has no controls. */
const REQUEST: RequestDeviceOptions = {
  filters: [{ services: [UUIDS.controlService] }],
  optionalServices: [UUIDS.deviceInfoService, UUIDS.batteryService],
};

const listeners = {
  stateChanged: new Set<(state: BluetoothState) => void>(),
  deviceDiscovered: new Set<(device: DiscoveredDevice) => void>(),
  deviceUpdated: new Set<(update: DeviceUpdate) => void>(),
  deviceFailed: new Set<(failure: DeviceFailure) => void>(),
};

const connections = new Map<string, Connection>();
const state = {
  requesting: false,
  /** The candidate to pick as soon as the pending request lists it. */
  pendingSelection: null as string | null,
  /** The candidate the pending request was answered with. */
  selected: null as string | null,
  listened: false,
};

export const marshallBle = {
  startScan(): void {
    listenOnce();
    reportAvailability();
    if (!state.requesting) {
      window.roadie.scan();
    }
  },
  stopScan(): void {
    if (state.requesting && state.pendingSelection === null) {
      window.roadie.cancel();
    }
  },
  connect(identifier: string): void {
    listenOnce();
    if (connections.has(identifier)) {
      connectGatt(identifier);
      return;
    }
    // A candidate from the pending request, or one from a request that has
    // since ended: either way the next list naming it answers with it.
    state.pendingSelection = identifier;
    if (state.requesting) {
      window.roadie.select(identifier);
      state.selected = identifier;
    } else {
      window.roadie.scan();
    }
  },
  disconnect(identifier: string): void {
    connections.get(identifier)?.device.gatt?.disconnect();
  },
  setEQ(identifier: string, bass: number, treble: number): void {
    const connection = connected(identifier);
    if (connection === null) {
      return;
    }
    const { equalizer, eq } = connection;
    if (equalizer === undefined || eq === undefined) {
      fail(identifier, 'EQ is not available on this device yet');
      return;
    }
    enqueue(identifier, connection, async () => {
      await equalizer.writeValueWithResponse(encodeEQ(eq, bass, treble));
      handleValue(identifier, UUIDS.equalizer, await equalizer.readValue());
    });
  },
  setVolume(identifier: string, level: number): void {
    const connection = connected(identifier);
    if (connection === null) {
      return;
    }
    const { volume } = connection;
    if (volume === undefined) {
      fail(identifier, 'Volume is not available on this device');
      return;
    }
    enqueue(identifier, connection, async () => {
      await volume.writeValueWithResponse(encodeVolume(level, connection.maxVolume));
      handleValue(identifier, UUIDS.volume, await volume.readValue());
    });
  },
  onStateChanged(listener: (state: BluetoothState) => void): Subscription {
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

/** Main runs this through `executeJavaScript(…, true)`: a device request needs a user gesture. */
async function requestDevice(): Promise<void> {
  if (state.requesting) {
    return;
  }
  state.requesting = true;
  state.selected = null;
  try {
    const device = await navigator.bluetooth.requestDevice(REQUEST);
    const identifier = state.selected ?? device.id;
    state.pendingSelection = null;
    adopt(identifier, device);
    connectGatt(identifier);
  } catch (error) {
    // A cancelled request rejects with NotFoundError: that is the search ending.
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      fail(state.pendingSelection ?? '', message(error));
    }
    state.pendingSelection = null;
  } finally {
    state.requesting = false;
  }
}

function listenOnce(): void {
  if (state.listened) {
    return;
  }
  state.listened = true;
  window.__roadieScan = requestDevice;
  window.roadie.onDevices(onCandidates);
  navigator.bluetooth?.addEventListener('availabilitychanged', reportAvailability);
}

function onCandidates(devices: ChooserDevice[]): void {
  for (const candidate of devices) {
    emit(listeners.deviceDiscovered, {
      identifier: candidate.deviceId,
      name: candidate.deviceName === '' ? null : candidate.deviceName,
      // The chooser reports no signal strength; the filter guarantees the service.
      rssi: 0,
      advertisedServices: ['FCCD'],
      isMarshallCandidate: true,
    });
    if (candidate.deviceId === state.pendingSelection && state.selected === null) {
      state.selected = candidate.deviceId;
      window.roadie.select(candidate.deviceId);
    }
  }
}

function reportAvailability(): void {
  if (navigator.bluetooth === undefined) {
    emit(listeners.stateChanged, 'unsupported');
    return;
  }
  navigator.bluetooth
    .getAvailability()
    .then(available => emit(listeners.stateChanged, available ? 'poweredOn' : 'poweredOff'))
    .catch(() => emit(listeners.stateChanged, 'unknown'));
}

function adopt(identifier: string, device: BluetoothDevice): void {
  if (connections.has(identifier)) {
    return;
  }
  connections.set(identifier, { device, queue: Promise.resolve() });
  device.addEventListener('gattserverdisconnected', () => {
    // Characteristics belong to the old GATT session; a reconnect rediscovers them.
    connections.set(identifier, { device, queue: Promise.resolve() });
    emit(listeners.deviceUpdated, { identifier, isConnected: false });
  });
}

function connectGatt(identifier: string): void {
  const connection = connections.get(identifier);
  if (connection === undefined || connection.device.gatt === undefined) {
    fail(identifier, 'Unknown device');
    return;
  }
  const gatt = connection.device.gatt;
  enqueue(identifier, connection, async () => {
    const server = await gatt.connect();
    emit(listeners.deviceUpdated, { identifier, isConnected: true });
    await readDeviceInfo(identifier, server);
    await watchBattery(identifier, server);
    await watchControls(identifier, server, connection);
  });
}

async function readDeviceInfo(identifier: string, server: BluetoothRemoteGATTServer): Promise<void> {
  const service = await optional(server.getPrimaryService(UUIDS.deviceInfoService));
  if (service === null) {
    return;
  }
  for (const uuid of [UUIDS.modelNumber, UUIDS.firmwareVersion]) {
    const characteristic = await optional(service.getCharacteristic(uuid));
    const value = characteristic && (await optional(characteristic.readValue()));
    if (value !== null) {
      handleValue(identifier, uuid, value);
    }
  }
}

async function watchBattery(identifier: string, server: BluetoothRemoteGATTServer): Promise<void> {
  const service = await optional(server.getPrimaryService(UUIDS.batteryService));
  const level = service && (await optional(service.getCharacteristic(UUIDS.batteryLevel)));
  if (level !== null) {
    await watch(identifier, level, UUIDS.batteryLevel);
  }
}

async function watchControls(
  identifier: string,
  server: BluetoothRemoteGATTServer,
  connection: Connection,
): Promise<void> {
  const service = await optional(server.getPrimaryService(UUIDS.controlService));
  if (service === null) {
    return;
  }
  // The maximum first: a volume write before it is read would clamp to the fallback.
  for (const uuid of [UUIDS.maxVolume, UUIDS.volume, UUIDS.equalizer]) {
    const characteristic = await optional(service.getCharacteristic(uuid));
    if (characteristic === null) {
      continue;
    }
    if (uuid === UUIDS.volume) {
      connection.volume = characteristic;
    } else if (uuid === UUIDS.equalizer) {
      connection.equalizer = characteristic;
    }
    await watch(identifier, characteristic, uuid);
  }
}

/** Reads a characteristic, then follows its notifications when it has them. */
async function watch(
  identifier: string,
  characteristic: BluetoothRemoteGATTCharacteristic,
  uuid: string,
): Promise<void> {
  const value = await optional(characteristic.readValue());
  if (value !== null) {
    handleValue(identifier, uuid, value);
  }
  if (characteristic.properties.notify) {
    characteristic.addEventListener('characteristicvaluechanged', () => {
      if (characteristic.value !== undefined) {
        handleValue(identifier, uuid, characteristic.value);
      }
    });
    await optional(characteristic.startNotifications());
  }
}

/** Applies one value: the EQ and maximum are kept for the next write, the rest is reported. */
function handleValue(identifier: string, uuid: string, view: DataView): void {
  const report = decodeCharacteristic(uuid, new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
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

function connected(identifier: string): Connection | null {
  const connection = connections.get(identifier);
  if (connection === undefined || connection.device.gatt?.connected !== true) {
    fail(identifier, 'Device is not connected');
    return null;
  }
  return connection;
}

function enqueue(identifier: string, connection: Connection, operation: () => Promise<void>): void {
  connection.queue = connection.queue.then(operation).catch((error: unknown) => fail(identifier, message(error)));
}

/** A service or characteristic a model lacks rejects; that is "absent", not a failure. */
function optional<Value>(promise: Promise<Value>): Promise<Value | null> {
  return promise.catch(() => null);
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
