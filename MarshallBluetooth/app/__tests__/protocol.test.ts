import {
  decodeBattery,
  decodeCharacteristic,
  decodeEQ,
  decodeString,
  decodeVolume,
  encodeEQ,
  encodeVolume,
  fromBase64,
  isMarshallCandidate,
  shortServiceUUID,
  toBase64,
  UUIDS,
} from '../src/protocol';

// Byte values match `MarshallProtocolTests.swift`, measured on an ACTON III.

test('EQ decodes bass from the first byte and treble from the last', () => {
  expect(decodeEQ(Uint8Array.from([0x05, 0xff, 0xff, 0xff, 0x04]))).toEqual({
    bass: 5,
    treble: 4,
    middle: [0xff, 0xff, 0xff],
  });
});

test('an EQ write keeps the middle bytes it was read with and clamps the bands', () => {
  const read = decodeEQ(Uint8Array.from([0x05, 0x12, 0x34, 0x56, 0x04]))!;
  expect([...encodeEQ(read, 7, 3)]).toEqual([0x07, 0x12, 0x34, 0x56, 0x03]);
  expect([...encodeEQ(read, -3, 14)]).toEqual([0x00, 0x12, 0x34, 0x56, 0x0a]);
});

test.each([
  [[0x05, 0xff, 0xff, 0xff]],
  [[0x05, 0xff, 0xff, 0xff, 0x04, 0x00]],
  [[0x0b, 0xff, 0xff, 0xff, 0x04]],
  [[0x05, 0xff, 0xff, 0xff, 0x0b]],
])('EQ values outside the measured layout are rejected: %j', bytes => {
  expect(decodeEQ(Uint8Array.from(bytes))).toBeNull();
});

test('volume is one byte clamped to the device maximum', () => {
  expect(decodeVolume(Uint8Array.from([0x0f]))).toBe(15);
  expect(decodeVolume(Uint8Array.from([0x0f, 0x00]))).toBeNull();
  expect([...encodeVolume(40, 31)]).toEqual([31]);
  expect([...encodeVolume(40, undefined)]).toEqual([31]);
  expect([...encodeVolume(-2, 31)]).toEqual([0]);
});

test('battery above 100 is malformed, and device strings lose their NUL padding', () => {
  expect(decodeBattery(Uint8Array.from([100]))).toBe(100);
  expect(decodeBattery(Uint8Array.from([101]))).toBeNull();
  expect(decodeString(Uint8Array.from('ACTON III\0\0', character => character.charCodeAt(0)))).toBe('ACTON III');
  expect(decodeString(Uint8Array.from([0, 0]))).toBeNull();
});


test('base64 round-trips every length, as ble-plx carries values', () => {
  for (const bytes of [[], [31], [5, 0xff], [5, 0xff, 0xff, 0xff, 4], [0, 1, 2, 3, 4, 5]]) {
    const encoded = toBase64(Uint8Array.from(bytes));
    expect([...fromBase64(encoded)]).toEqual(bytes);
  }
  // Fixed points from a reference encoder: padding for one and two trailing bytes.
  expect(toBase64(Uint8Array.from([31]))).toBe('Hw==');
  expect(toBase64(Uint8Array.from([5, 0xff]))).toBe('Bf8=');
  expect(toBase64(Uint8Array.from([5, 0xff, 0xff, 0xff, 4]))).toBe('Bf///wQ=');
});

test('advertised services read as CoreBluetooth spells them, and candidates match the Swift rule', () => {
  expect(shortServiceUUID(UUIDS.controlService)).toBe('FCCD');
  expect(shortServiceUUID(UUIDS.volume)).toBe(UUIDS.volume.toUpperCase());
  expect(isMarshallCandidate(null, ['FCCD'])).toBe(true);
  expect(isMarshallCandidate('Acton III [LE]', [])).toBe(true);
  expect(isMarshallCandidate('AirPods Pro', ['180F'])).toBe(false);
});

test('one characteristic value decodes to the fields its report carries', () => {
  expect(decodeCharacteristic(UUIDS.serialNumber, Uint8Array.from([0x41, 0x31, 0]))).toEqual({
    deviceInfo: { serialNumber: 'A1' },
  });
  expect(decodeCharacteristic(UUIDS.maxVolume.toUpperCase(), Uint8Array.from([31]))).toEqual({
    controlState: { maxVolume: 31 },
  });
  expect(decodeCharacteristic(UUIDS.batteryLevel, Uint8Array.from([101]))).toBeNull();
});
