/**
 * The Marshall GATT layout and value codecs for the JavaScript Bluetooth
 * layers — Web Bluetooth on Windows/Linux (`desktop/`) and react-native-ble-plx
 * on iOS/Android (`mobile/`). Ported from `MarshallProtocol.swift` and
 * `MarshallScanner.swift`, which the macOS app runs instead. Byte layouts were
 * measured on an ACTON III (firmware 8.2.2) with `make ble-probe`; the Swift
 * tests pin the same values.
 */
import type { ControlState, DeviceInfo } from './native/marshallBle';

/** Full 128-bit UUIDs, lower case: the form both JavaScript stacks report. */
export const UUIDS = {
  controlService: '0000fccd-0000-1000-8000-00805f9b34fb',
  deviceInfoService: '0000180a-0000-1000-8000-00805f9b34fb',
  batteryService: '0000180f-0000-1000-8000-00805f9b34fb',
  modelNumber: '00002a24-0000-1000-8000-00805f9b34fb',
  serialNumber: '00002a25-0000-1000-8000-00805f9b34fb',
  firmwareVersion: '00002a26-0000-1000-8000-00805f9b34fb',
  batteryLevel: '00002a19-0000-1000-8000-00805f9b34fb',
  volume: '00000007-1337-1dea-feed-c0ffee70c0de',
  maxVolume: '00000008-1337-1dea-feed-c0ffee70c0de',
  equalizer: '0000000f-1337-1dea-feed-c0ffee70c0de',
};

/** The knob range, 5 flat — `EQScale` in Swift. */
export const EQ_STEPS = { min: 0, max: 10, flat: 5 };
/** An ACTON III's measured maximum, used until the speaker reports its own. */
export const FALLBACK_MAX_VOLUME = 31;

/** Advertised-name fragments of Marshall products — `productNameTokens` in Swift. */
const PRODUCT_NAME_TOKENS = [
  'MARSHALL', 'ACTON', 'STANMORE', 'WOBURN', 'EMBERTON', 'MIDDLETON', 'WILLEN',
  'OZZY', 'TYLER', 'GAHAN', 'PLANT', 'IGGY', 'WEMBLEY', 'SMITH', 'NINA', 'WATERS', 'LYKK',
];

const BLUETOOTH_BASE = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Bass and treble as the speaker stores them: `[bass, b1, b2, b3, treble]`.
 * The middle three bytes are kept as read and written back untouched — what
 * they mean on other models is unknown.
 */
export interface EQSettings {
  bass: number;
  treble: number;
  middle: number[];
}

/**
 * What one characteristic value reports: the fields of a `DeviceUpdate`, plus
 * the EQ's raw layout, which the next EQ write needs.
 */
export interface CharacteristicReport {
  batteryPercent?: number;
  deviceInfo?: DeviceInfo;
  controlState?: ControlState;
  eq?: EQSettings;
}

/** The control service in an advertisement makes a candidate; so does a Marshall product name. */
export function isMarshallCandidate(name: string | null, services: readonly string[]): boolean {
  if (services.some(service => shortServiceUUID(service) === 'FCCD')) {
    return true;
  }
  const upper = name?.toUpperCase();
  return upper !== undefined && PRODUCT_NAME_TOKENS.some(token => upper.includes(token));
}

/** `0000fccd-0000-1000-…` → `FCCD`, the spelling CoreBluetooth and the screens use. */
export function shortServiceUUID(uuid: string): string {
  return (BLUETOOTH_BASE.exec(uuid)?.[1] ?? uuid).toUpperCase();
}

/** Decodes one value; a malformed one reports nothing, as the Swift core drops it. */
export function decodeCharacteristic(uuid: string, bytes: Uint8Array): CharacteristicReport | null {
  const id = uuid.toLowerCase();
  switch (id) {
    case UUIDS.batteryLevel: {
      const percent = decodeBattery(bytes);
      return percent === null ? null : { batteryPercent: percent };
    }
    case UUIDS.modelNumber:
    case UUIDS.serialNumber:
    case UUIDS.firmwareVersion: {
      const text = decodeString(bytes);
      if (text === null) {
        return null;
      }
      const key = id === UUIDS.modelNumber ? 'model' : id === UUIDS.serialNumber ? 'serialNumber' : 'firmwareVersion';
      return { deviceInfo: { [key]: text } };
    }
    case UUIDS.volume: {
      const level = decodeVolume(bytes);
      return level === null ? null : { controlState: { volume: level } };
    }
    case UUIDS.maxVolume: {
      const maximum = decodeVolume(bytes);
      return maximum === null ? null : { controlState: { maxVolume: maximum } };
    }
    case UUIDS.equalizer: {
      const eq = decodeEQ(bytes);
      return eq === null ? null : { controlState: { bass: eq.bass, treble: eq.treble }, eq };
    }
    default:
      return null;
  }
}

export function decodeEQ(bytes: Uint8Array): EQSettings | null {
  // A byte is never below 0, so only the top of the knob range can be exceeded.
  if (bytes.length !== 5 || bytes[0] > EQ_STEPS.max || bytes[4] > EQ_STEPS.max) {
    return null;
  }
  return { bass: bytes[0], treble: bytes[4], middle: [bytes[1], bytes[2], bytes[3]] };
}

/** Clamps rather than rejects: a step past the end is a UI edge, not a bad request. */
export function encodeEQ(current: EQSettings, bass: number, treble: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([clamp(bass, EQ_STEPS.min, EQ_STEPS.max), ...current.middle, clamp(treble, EQ_STEPS.min, EQ_STEPS.max)]);
}

/** Volume is one byte, 0 to the device maximum. */
export function decodeVolume(bytes: Uint8Array): number | null {
  return bytes.length === 1 ? bytes[0] : null;
}

export function encodeVolume(level: number, maximum: number | undefined): Uint8Array<ArrayBuffer> {
  return new Uint8Array([clamp(level, 0, maximum ?? FALLBACK_MAX_VOLUME)]);
}

/** Battery Level is one byte, 0–100; anything above is malformed. */
export function decodeBattery(bytes: Uint8Array): number | null {
  return bytes.length > 0 && bytes[0] <= 100 ? bytes[0] : null;
}

/**
 * DIS strings are UTF-8 and some firmwares pad them with NULs. Decoded through
 * percent-escapes, not `TextDecoder`, which Hermes does not provide everywhere.
 */
export function decodeString(bytes: Uint8Array): string | null {
  const escaped = Array.from(bytes, byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
  let text: string;
  try {
    text = decodeURIComponent(escaped);
  } catch {
    text = String.fromCharCode(...bytes);
  }
  // eslint-disable-next-line no-control-regex
  const trimmed = text.replace(/^[\u0000-\u001f\s]+|[\u0000-\u001f\s]+$/g, '');
  return trimmed === '' ? null : trimmed;
}

/* eslint-disable no-bitwise -- base64 is bit packing: three bytes to four 6-bit digits. */

/** react-native-ble-plx carries values as base64. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const chars = [18, 12, 6, 0].map(shift => BASE64[(chunk >> shift) & 63]);
    const kept = Math.min(bytes.length - index, 3) + 1;
    out += chars.slice(0, kept).join('') + '='.repeat(4 - kept);
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const values = [0, 1, 2, 3].map(offset => BASE64.indexOf(clean[index + offset] ?? 'A'));
    const chunk = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    const count = Math.min(clean.length - index, 4) - 1;
    bytes.push(...[(chunk >> 16) & 255, (chunk >> 8) & 255, chunk & 255].slice(0, count));
  }
  return Uint8Array.from(bytes);
}

/* eslint-enable no-bitwise */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
