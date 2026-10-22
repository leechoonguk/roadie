import {
  type EmitterSubscription,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';

/** Mirrors `CBManagerState` as `MarshallScanner.describe` names it. */
export type BluetoothState =
  | 'poweredOn'
  | 'poweredOff'
  | 'unauthorized'
  | 'unsupported'
  | 'resetting'
  | 'unknown';

export interface DiscoveredDevice {
  identifier: string;
  name: string | null;
  rssi: number;
  advertisedServices: string[];
  isMarshallCandidate: boolean;
}

/** Device Information Service fields; a report carries only the fields it read. */
export interface DeviceInfo {
  model?: string;
  firmwareVersion?: string;
  serialNumber?: string;
}

/**
 * Control state from the speaker's control service; a report carries only the
 * fields it decoded. Volume runs 0–`maxVolume`; bass and treble are steps 0–10
 * with 5 flat — the speaker's own units, as its knobs report them.
 */
export interface ControlState {
  volume?: number;
  maxVolume?: number;
  bass?: number;
  treble?: number;
}

/**
 * One report from a connected or disconnecting device. An absent key means
 * "not part of this report", so the last known value stays.
 */
export interface DeviceUpdate {
  identifier: string;
  isConnected: boolean;
  batteryPercent?: number;
  deviceInfo?: DeviceInfo;
  controlState?: ControlState;
}

export interface DeviceFailure {
  identifier: string;
  message: string;
}

interface MarshallBleNative {
  startScan(): void;
  stopScan(): void;
  connect(identifier: string): void;
  disconnect(identifier: string): void;
  setEQ(identifier: string, bass: number, treble: number): void;
  setVolume(identifier: string, level: number): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

function nativeModule(): MarshallBleNative {
  const module = NativeModules.MarshallBle as MarshallBleNative | undefined;
  if (module === undefined) {
    throw new Error('MarshallBle native module is not linked');
  }
  return module;
}

// Created on first subscription: constructing it needs the native module, which
// a test or a misconfigured build may not have at import time.
let emitter: NativeEventEmitter | null = null;

function events(): NativeEventEmitter {
  emitter ??= new NativeEventEmitter(nativeModule());
  return emitter;
}

export const marshallBle = {
  startScan(): void {
    nativeModule().startScan();
  },
  stopScan(): void {
    nativeModule().stopScan();
  },
  connect(identifier: string): void {
    nativeModule().connect(identifier);
  },
  disconnect(identifier: string): void {
    nativeModule().disconnect(identifier);
  },
  setEQ(identifier: string, bass: number, treble: number): void {
    nativeModule().setEQ(identifier, bass, treble);
  },
  setVolume(identifier: string, level: number): void {
    nativeModule().setVolume(identifier, level);
  },
  onStateChanged(listener: (state: BluetoothState) => void): EmitterSubscription {
    return events().addListener('stateChanged', (event: { state: BluetoothState }) =>
      listener(event.state),
    );
  },
  onDeviceDiscovered(
    listener: (device: DiscoveredDevice) => void,
  ): EmitterSubscription {
    return events().addListener('deviceDiscovered', listener);
  },
  onDeviceUpdated(listener: (update: DeviceUpdate) => void): EmitterSubscription {
    return events().addListener('deviceUpdated', listener);
  },
  onDeviceFailed(listener: (failure: DeviceFailure) => void): EmitterSubscription {
    return events().addListener('deviceFailed', listener);
  },
};
