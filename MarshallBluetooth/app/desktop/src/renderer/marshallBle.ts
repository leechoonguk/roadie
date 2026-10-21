/**
 * `app/src/native/marshallBle.ts` for Windows and Linux: the shared client
 * (`app/src/ble/client.ts`) over Web Bluetooth, which Chromium runs on WinRT
 * (Windows) and BlueZ (Linux). The desktop bundle swaps this file in for the
 * React Native one, so the screen does not know which it talks to.
 *
 * Web Bluetooth has no scan API: a device request opens a chooser, and the
 * main process answers it. So a scan is one pending request whose candidate
 * list main forwards here, and connecting to a candidate answers the request.
 */
import { type BleTransport, createMarshallBle, type GattLink } from '../../../src/ble/client';
import type { DiscoveredDevice } from '../../../src/native/marshallBle';
import { UUIDS } from '../../../src/protocol';
import type { ChooserDevice, RoadieBridge } from '../bridge';

declare global {
  interface Window {
    roadie: RoadieBridge;
    __roadieScan?: () => Promise<void>;
  }
}

interface Waiter {
  resolve(device: BluetoothDevice): void;
  reject(error: Error): void;
}

/** Only the identity advertising the control service is listed: the speaker's other BLE identity has no controls. */
const REQUEST: RequestDeviceOptions = {
  filters: [{ services: [UUIDS.controlService] }],
  optionalServices: [UUIDS.deviceInfoService, UUIDS.batteryService],
};

/** Speakers chosen at least once: Web Bluetooth reconnects to these without a chooser. */
const chosen = new Map<string, BluetoothDevice>();
const chooser = {
  requesting: false,
  /** The candidate to pick as soon as the pending request lists it. */
  pendingSelection: null as string | null,
  /** The candidate the pending request was answered with. */
  selected: null as string | null,
  waiter: null as Waiter | null,
  onDevice: null as ((device: DiscoveredDevice) => void) | null,
  onError: null as ((message: string) => void) | null,
  listening: false,
};

const webBluetooth: BleTransport = {
  watchState(listener) {
    if (navigator.bluetooth === undefined) {
      listener('unsupported');
      return;
    }
    const report = () =>
      navigator.bluetooth
        .getAvailability()
        .then(available => listener(available ? 'poweredOn' : 'poweredOff'))
        .catch(() => listener('unknown'));
    navigator.bluetooth.addEventListener('availabilitychanged', report);
    report();
  },
  startScan(onDevice, onError) {
    listenOnce();
    chooser.onDevice = onDevice;
    chooser.onError = onError;
    if (!chooser.requesting) {
      window.roadie.scan();
    }
  },
  stopScan() {
    if (chooser.requesting && chooser.pendingSelection === null) {
      window.roadie.cancel();
    }
  },
  async connect(identifier, onDisconnect) {
    const device = chosen.get(identifier) ?? (await choose(identifier));
    if (device.gatt === undefined) {
      throw new Error('Unknown device');
    }
    const server = await device.gatt.connect();
    const dropped = () => {
      device.removeEventListener('gattserverdisconnected', dropped);
      onDisconnect();
    };
    device.addEventListener('gattserverdisconnected', dropped);
    return link(server);
  },
};

export const marshallBle = createMarshallBle(webBluetooth);

/** A GATT session's characteristics, looked up once each. */
function link(server: BluetoothRemoteGATTServer): GattLink {
  const found = new Map<string, Promise<BluetoothRemoteGATTCharacteristic | null>>();
  const characteristic = (service: string, uuid: string) => {
    const key = `${service}/${uuid}`;
    if (!found.has(key)) {
      // A service or characteristic a model lacks rejects; that is "absent", not a failure.
      found.set(key, server.getPrimaryService(service).then(s => s.getCharacteristic(uuid)).catch(() => null));
    }
    return found.get(key)!;
  };
  const present = async (service: string, uuid: string) => {
    const value = await characteristic(service, uuid);
    if (value === null) {
      throw new Error(`No characteristic ${uuid}`);
    }
    return value;
  };
  return {
    async read(service, uuid) {
      const value = await characteristic(service, uuid);
      return value === null ? null : bytes(await value.readValue());
    },
    async write(service, uuid, value) {
      await (await present(service, uuid)).writeValueWithResponse(Uint8Array.from(value));
    },
    async watch(service, uuid, listener) {
      const value = await present(service, uuid);
      if (!value.properties.notify) {
        return;
      }
      value.addEventListener('characteristicvaluechanged', () => {
        if (value.value !== undefined) {
          listener(bytes(value.value));
        }
      });
      await value.startNotifications();
    },
    async disconnect() {
      server.disconnect();
    },
  };
}

/** Answers the pending device request with `identifier`, starting one if none is open. */
function choose(identifier: string): Promise<BluetoothDevice> {
  listenOnce();
  chooser.waiter?.reject(new Error('Another speaker was chosen'));
  const { promise, resolve, reject } = Promise.withResolvers<BluetoothDevice>();
  chooser.waiter = { resolve, reject };
  chooser.pendingSelection = identifier;
  if (chooser.requesting) {
    chooser.selected = identifier;
    window.roadie.select(identifier);
  } else {
    window.roadie.scan();
  }
  return promise;
}

/** Main runs this through `executeJavaScript(…, true)`: a device request needs a user gesture. */
async function requestDevice(): Promise<void> {
  if (chooser.requesting) {
    return;
  }
  chooser.requesting = true;
  chooser.selected = null;
  try {
    const device = await navigator.bluetooth.requestDevice(REQUEST);
    chosen.set(chooser.selected ?? device.id, device);
    chooser.waiter?.resolve(device);
  } catch (error) {
    // A cancelled request rejects with NotFoundError: that is the search ending.
    const ended = error instanceof DOMException && error.name === 'NotFoundError';
    chooser.waiter?.reject(ended ? new Error('The search ended before the speaker was found') : asError(error));
    if (!ended) {
      chooser.onError?.(asError(error).message);
    }
  } finally {
    chooser.requesting = false;
    chooser.pendingSelection = null;
    chooser.waiter = null;
  }
}

function listenOnce(): void {
  if (chooser.listening) {
    return;
  }
  chooser.listening = true;
  window.__roadieScan = requestDevice;
  window.roadie.onDevices(onCandidates);
}

function onCandidates(devices: ChooserDevice[]): void {
  for (const candidate of devices) {
    chooser.onDevice?.({
      identifier: candidate.deviceId,
      name: candidate.deviceName === '' ? null : candidate.deviceName,
      // The chooser reports no signal strength; the filter guarantees the service.
      rssi: 0,
      advertisedServices: ['FCCD'],
      isMarshallCandidate: true,
    });
    if (candidate.deviceId === chooser.pendingSelection && chooser.selected === null) {
      chooser.selected = candidate.deviceId;
      window.roadie.select(candidate.deviceId);
    }
  }
}

function bytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
