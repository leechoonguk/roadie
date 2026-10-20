/**
 * The Marshall GATT layout and value codecs, ported from `MarshallProtocol.swift`
 * and `MarshallScanner.swift`. Byte layouts were measured on an ACTON III
 * (firmware 8.2.2) with `make ble-probe`; the Swift tests pin the same values.
 */

/** Web Bluetooth takes full 128-bit UUIDs, lower case. */
export const UUIDS = {
  controlService: '0000fccd-0000-1000-8000-00805f9b34fb',
  deviceInfoService: '0000180a-0000-1000-8000-00805f9b34fb',
  batteryService: '0000180f-0000-1000-8000-00805f9b34fb',
  modelNumber: '00002a24-0000-1000-8000-00805f9b34fb',
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

/** DIS strings are UTF-8 and some firmwares pad them with NULs. */
export function decodeString(bytes: Uint8Array): string | null {
  // eslint-disable-next-line no-control-regex
  const text = new TextDecoder().decode(bytes).replace(/^[\u0000-\u001f\s]+|[\u0000-\u001f\s]+$/g, '');
  return text === '' ? null : text;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
