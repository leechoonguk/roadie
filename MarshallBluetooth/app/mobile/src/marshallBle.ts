/**
 * `src/native/marshallBle.ts` for Android: the shared client
 * (`src/ble/client.ts`) over react-native-ble-plx. Metro swaps this file in on
 * Android (`metro.config.js`); iOS runs the macOS Swift module instead, so
 * every Apple platform shares one Bluetooth core and Android shares the
 * Windows/Linux one.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';

import { type BleTransport, createMarshallBle, type GattLink } from '../../src/ble/client';
import type { BluetoothState } from '../../src/native/marshallBle';
import { fromBase64, isMarshallCandidate, shortServiceUUID, toBase64 } from '../../src/protocol';

const STATES: Record<State, BluetoothState> = {
  [State.PoweredOn]: 'poweredOn',
  [State.PoweredOff]: 'poweredOff',
  [State.Unauthorized]: 'unauthorized',
  [State.Unsupported]: 'unsupported',
  [State.Resetting]: 'resetting',
  [State.Unknown]: 'unknown',
};

/** Android 12+ asks for scan and connect; Android 11 and older ask for location to scan. */
const PERMISSIONS =
  Number(Platform.Version) >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

const state = { manager: null as BleManager | null };

const blePlx: BleTransport = {
  watchState(listener) {
    manager().onStateChange(next => listener(STATES[next]), true);
  },
  startScan(onDevice, onError) {
    requestPermissions()
      .then(granted => {
        if (!granted) {
          onError('Roadie may not use Bluetooth. Allow Nearby devices in the app settings.');
          return;
        }
        return manager().startDeviceScan(null, null, (error, device) => {
          if (error !== null) {
            onError(error.message);
          } else if (device !== null) {
            const name = device.localName ?? device.name;
            const services = (device.serviceUUIDs ?? []).map(shortServiceUUID);
            onDevice({
              identifier: device.id,
              name,
              rssi: device.rssi ?? -127,
              advertisedServices: services,
              isMarshallCandidate: isMarshallCandidate(name, services),
            });
          }
        });
      })
      .catch(error => onError(String(error)));
  },
  stopScan() {
    manager().stopDeviceScan().catch(() => undefined);
  },
  async connect(identifier, onDisconnect) {
    // A widget press runs headless and cannot ask; the window asked when it first searched.
    if (!(await hasPermissions())) {
      throw new Error('Open Roadie once to allow Bluetooth');
    }
    const ble = manager();
    await ble.connectToDevice(identifier);
    await ble.discoverAllServicesAndCharacteristicsForDevice(identifier);
    const watching: Array<{ remove(): void }> = [];
    const dropped = ble.onDeviceDisconnected(identifier, () => {
      dropped.remove();
      watching.forEach(subscription => subscription.remove());
      onDisconnect();
    });
    const link: GattLink = {
      async read(service, characteristic) {
        try {
          const value = await ble.readCharacteristicForDevice(identifier, service, characteristic);
          return value.value === null ? null : fromBase64(value.value);
        } catch {
          // ble-plx rejects an absent characteristic; a failed read is reported as absent too.
          return null;
        }
      },
      async write(service, characteristic, value) {
        await ble.writeCharacteristicWithResponseForDevice(identifier, service, characteristic, toBase64(value));
      },
      async watch(service, characteristic, listener) {
        watching.push(
          ble.monitorCharacteristicForDevice(identifier, service, characteristic, (error, value) => {
            if (error === null && value?.value != null) {
              listener(fromBase64(value.value));
            }
          }),
        );
      },
      async disconnect() {
        await ble.cancelDeviceConnection(identifier);
      },
    };
    return link;
  },
};

export const marshallBle = createMarshallBle(blePlx);

/** Created on first use: constructing it starts the native client, which a test may not have. */
function manager(): BleManager {
  state.manager ??= new BleManager();
  return state.manager;
}

async function requestPermissions(): Promise<boolean> {
  const results = await PermissionsAndroid.requestMultiple(PERMISSIONS);
  return PERMISSIONS.every(permission => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

async function hasPermissions(): Promise<boolean> {
  const granted = await Promise.all(PERMISSIONS.map(permission => PermissionsAndroid.check(permission)));
  return granted.every(Boolean);
}
