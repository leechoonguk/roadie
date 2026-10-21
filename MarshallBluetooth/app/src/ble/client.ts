/**
 * The `marshallBle` API (`../native/marshallBle.ts`) over any JavaScript
 * Bluetooth stack. A platform supplies only a `BleTransport` — how to scan,
 * and how to open a GATT link — and this client does the rest the same way
 * everywhere: the connect sequence, the decoding, one GATT operation at a
 * time, a read-back after every write, and `applyStep` for a widget or tray
 * press. Windows/Linux (Web Bluetooth) and Android (react-native-ble-plx)
 * use it; macOS and iOS run the Swift core (`MarshallScanner.swift`) instead.
 */
import { type ControlAction, type ControlValues, stepControl } from '../controls';
import type {
  BluetoothState,
  DeviceFailure,
  DeviceUpdate,
  DiscoveredDevice,
} from '../native/marshallBle';
import { decodeCharacteristic, encodeEQ, encodeVolume, type EQSettings, UUIDS } from '../protocol';

/** One GATT connection to a speaker. Values are raw bytes; the client decodes them. */
export interface GattLink {
  /** Resolves null when the speaker has no such characteristic. */
  read(service: string, characteristic: string): Promise<Uint8Array | null>;
  write(service: string, characteristic: string, value: Uint8Array): Promise<void>;
  /** Follows notifications; a characteristic that cannot notify is left alone. */
  watch(service: string, characteristic: string, listener: (value: Uint8Array) => void): Promise<void>;
  disconnect(): Promise<void>;
}

/** What a platform's Bluetooth stack provides. */
export interface BleTransport {
  /** Reports the adapter's state now and on every change. */
  watchState(listener: (state: BluetoothState) => void): void;
  startScan(onDevice: (device: DiscoveredDevice) => void, onError: (message: string) => void): void;
  stopScan(): void;
  /** Opens a link; `onDisconnect` fires once when the speaker or the system drops it. */
  connect(identifier: string, onDisconnect: () => void): Promise<GattLink>;
}

export interface Subscription {
  remove(): void;
}

export type MarshallBle = ReturnType<typeof createMarshallBle>;

/** What a connected speaker keeps between reports. */
interface Connection {
  link: GattLink;
  values: ControlValues;
  /** The last EQ read or notified; an EQ write keeps its middle bytes. */
  eq?: EQSettings;
  /** GATT operations run one at a time: Chromium rejects a second in flight, and a read-back must follow its write. */
  queue: Promise<unknown>;
}

/** Read once on connect; the device information never changes while connected. */
const DEVICE_INFO = [UUIDS.modelNumber, UUIDS.firmwareVersion, UUIDS.serialNumber];
/** Read, then followed. The maximum first: a volume write before it is read would clamp to the fallback. */
const CONTROLS = [UUIDS.maxVolume, UUIDS.volume, UUIDS.equalizer];

export function createMarshallBle(transport: BleTransport) {
  const listeners = {
    stateChanged: new Set<(state: BluetoothState) => void>(),
    deviceDiscovered: new Set<(device: DiscoveredDevice) => void>(),
    deviceUpdated: new Set<(update: DeviceUpdate) => void>(),
    deviceFailed: new Set<(failure: DeviceFailure) => void>(),
  };
  const connections = new Map<string, Connection>();
  const state = { watchingState: false };

  function watchStateOnce(): void {
    if (!state.watchingState) {
      state.watchingState = true;
      transport.watchState(bluetooth => emit(listeners.stateChanged, bluetooth));
    }
  }

  /**
   * Connects and reads the controls; the window also wants the device
   * information and the battery, and to follow every change.
   */
  async function open(identifier: string, follow: boolean): Promise<Connection> {
    const link = await transport.connect(identifier, () => {
      connections.delete(identifier);
      emit(listeners.deviceUpdated, { identifier, isConnected: false });
    });
    const connection: Connection = {
      link,
      values: { volume: null, maxVolume: null, bass: null, treble: null },
      queue: Promise.resolve(),
    };
    connections.set(identifier, connection);
    emit(listeners.deviceUpdated, { identifier, isConnected: true });
    await enqueue(connection, async () => {
      if (follow) {
        for (const characteristic of DEVICE_INFO) {
          await readInto(identifier, connection, UUIDS.deviceInfoService, characteristic);
        }
        await readInto(identifier, connection, UUIDS.batteryService, UUIDS.batteryLevel, follow);
      }
      for (const characteristic of CONTROLS) {
        await readInto(identifier, connection, UUIDS.controlService, characteristic, follow);
      }
    });
    return connection;
  }

  /** Reads and reports one value, then follows it when asked; an absent characteristic is skipped. */
  async function readInto(
    identifier: string,
    connection: Connection,
    service: string,
    characteristic: string,
    follow = false,
  ): Promise<void> {
    const value = await connection.link.read(service, characteristic).catch(() => null);
    if (value === null) {
      return;
    }
    handleValue(identifier, connection, characteristic, value);
    if (follow) {
      await connection.link
        .watch(service, characteristic, next => handleValue(identifier, connection, characteristic, next))
        .catch(() => undefined);
    }
  }

  /** Applies one value: kept for the next write and the next step, and reported. */
  function handleValue(identifier: string, connection: Connection, characteristic: string, bytes: Uint8Array): void {
    const decoded = decodeCharacteristic(characteristic, bytes);
    if (decoded === null) {
      return;
    }
    const { eq, ...fields } = decoded;
    connection.eq = eq ?? connection.eq;
    connection.values = { ...connection.values, ...decoded.controlState };
    emit(listeners.deviceUpdated, { identifier, isConnected: true, ...fields });
  }

  /**
   * Writes, then reads back: the speaker notifies knob turns but not, as far as
   * measured, its own accepted writes, and the read-back is the value it stored.
   */
  function writeVolume(identifier: string, connection: Connection, level: number): Promise<void> {
    const bytes = encodeVolume(level, connection.values.maxVolume ?? undefined);
    return writeAndReadBack(identifier, connection, UUIDS.volume, bytes);
  }

  function writeEQ(identifier: string, connection: Connection, bass: number, treble: number): Promise<void> {
    if (connection.eq === undefined) {
      return Promise.reject(new Error('EQ is not available on this device yet'));
    }
    return writeAndReadBack(identifier, connection, UUIDS.equalizer, encodeEQ(connection.eq, bass, treble));
  }

  function writeAndReadBack(
    identifier: string,
    connection: Connection,
    characteristic: string,
    bytes: Uint8Array,
  ): Promise<void> {
    return enqueue(connection, async () => {
      await connection.link.write(UUIDS.controlService, characteristic, bytes);
      await readInto(identifier, connection, UUIDS.controlService, characteristic);
    });
  }

  function connected(identifier: string): Connection | null {
    const connection = connections.get(identifier);
    if (connection === undefined) {
      fail(identifier, 'Device is not connected');
      return null;
    }
    return connection;
  }

  function enqueue(connection: Connection, operation: () => Promise<void>): Promise<void> {
    const next = connection.queue.then(operation);
    connection.queue = next.catch(() => undefined);
    return next;
  }

  function fail(identifier: string, text: string): void {
    emit(listeners.deviceFailed, { identifier, message: text });
  }

  function report(identifier: string): (error: unknown) => void {
    return error => fail(identifier, error instanceof Error ? error.message : String(error));
  }

  return {
    startScan(): void {
      watchStateOnce();
      transport.startScan(
        device => emit(listeners.deviceDiscovered, device),
        text => fail('', text),
      );
    },
    stopScan(): void {
      transport.stopScan();
    },
    connect(identifier: string): void {
      watchStateOnce();
      open(identifier, true).catch(report(identifier));
    },
    disconnect(identifier: string): void {
      connections.get(identifier)?.link.disconnect().catch(report(identifier));
    },
    setVolume(identifier: string, level: number): void {
      const connection = connected(identifier);
      if (connection !== null) {
        writeVolume(identifier, connection, level).catch(report(identifier));
      }
    },
    setEQ(identifier: string, bass: number, treble: number): void {
      const connection = connected(identifier);
      if (connection !== null) {
        writeEQ(identifier, connection, bass, treble).catch(report(identifier));
      }
    },
    /**
     * One press from a widget or the tray: steps from the value the speaker
     * reports now, not from the one the press was drawn with — the knob may
     * have moved since. Uses the open connection, or connects for this one
     * press and disconnects again. Resolves with the values the speaker stored.
     */
    async applyStep(identifier: string, action: ControlAction): Promise<ControlValues> {
      const existing = connections.get(identifier);
      const connection = existing ?? (await open(identifier, false).catch(error => {
        report(identifier)(error);
        throw error;
      }));
      try {
        await connection.queue;
        const change = stepControl(connection.values, action);
        if (change?.kind === 'volume') {
          await writeVolume(identifier, connection, change.level);
        } else if (change?.kind === 'eq') {
          await writeEQ(identifier, connection, change.bass, change.treble);
        }
        return connection.values;
      } catch (error) {
        report(identifier)(error);
        throw error;
      } finally {
        if (existing === undefined) {
          await connection.link.disconnect().catch(() => undefined);
        }
      }
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
}

function subscribe<Value>(set: Set<(value: Value) => void>, listener: (value: Value) => void): Subscription {
  set.add(listener);
  return { remove: () => set.delete(listener) };
}

function emit<Value>(set: Set<(value: Value) => void>, value: Value): void {
  set.forEach(listener => listener(value));
}
