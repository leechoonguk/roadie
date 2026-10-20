import Foundation
import Testing

@testable import MarshallCore

// Byte values below were read from an ACTON III (firmware 8.2.2) with
// `make ble-probe`; they pin the codec to what the speaker actually sends.

@Test func eqDecodesBassFromTheFirstByteAndTrebleFromTheLast() {
  let eq = EQSettings(Data([0x05, 0xFF, 0xFF, 0xFF, 0x04]))
  #expect(eq?.bass == 5)
  #expect(eq?.treble == 4)
}

@Test func eqWriteKeepsTheMiddleBytesItWasReadWith() {
  let read = EQSettings(Data([0x05, 0x12, 0x34, 0x56, 0x04]))!
  #expect([UInt8](read.with(bass: 7, treble: 3).data) == [0x07, 0x12, 0x34, 0x56, 0x03])
}

@Test func eqStepsPastTheEndsAreClamped() {
  let read = EQSettings(Data([0x05, 0xFF, 0xFF, 0xFF, 0x05]))!
  let written = read.with(bass: -3, treble: 14)
  #expect(written.bass == 0)
  #expect(written.treble == 10)
}

@Test(arguments: [
  [0x05, 0xFF, 0xFF, 0xFF],  // four bytes: not the EQ layout
  [0x05, 0xFF, 0xFF, 0xFF, 0x04, 0x00],  // six bytes
  [0x0B, 0xFF, 0xFF, 0xFF, 0x04],  // bass above the knob's range
  [0x05, 0xFF, 0xFF, 0xFF, 0x0B],  // treble above the knob's range
] as [[UInt8]])
func eqValuesOutsideTheMeasuredLayoutAreRejected(bytes: [UInt8]) {
  #expect(EQSettings(Data(bytes)) == nil)
}

@Test func volumeIsOneByteClampedToTheDeviceMaximum() {
  #expect(VolumeLevel.decode(Data([0x0F])) == 15)
  #expect(VolumeLevel.decode(Data([0x0F, 0x00])) == nil)
  #expect(VolumeLevel.encode(40, maximum: 31) == Data([31]))
  #expect(VolumeLevel.encode(-2, maximum: 31) == Data([0]))
}

@Test func volumeBeforeTheMaximumIsReadUsesTheMeasuredMaximum() {
  #expect(VolumeLevel.encode(99, maximum: nil) == Data([UInt8(VolumeLevel.fallbackMaximum)]))
}

@Test func decodingASliceUsesItsOwnIndices() {
  #expect(VolumeLevel.decode(Data([0xAA, 0x0A]).dropFirst()) == 10)
  #expect(EQSettings(Data([0xAA, 0x02, 0xFF, 0xFF, 0xFF, 0x08]).dropFirst())?.treble == 8)
}

@Test func updateEventOmitsWhatTheReportDidNotCarry() {
  var update = DeviceUpdate(identifier: "A", isConnected: true)
  update.deviceInfo = DeviceInfo(firmwareVersion: "8.2.2")
  update.controlState = ControlState(bass: 7, treble: 3)

  let body = update.eventBody
  #expect(Set(body.keys) == ["identifier", "isConnected", "deviceInfo", "controlState"])
  #expect(body["deviceInfo"] as? [String: String] == ["firmwareVersion": "8.2.2"])
  #expect(body["controlState"] as? [String: Int] == ["bass": 7, "treble": 3])
}

private let connected: [String: Any] = ["name": "ACTON III", "identifier": "A", "isConnected": true]

@Test func snapshotCarriesVolumeAndEQWithinTheirScales() throws {
  let payload = connected.merging(
    ["volume": 14, "maxVolume": 31, "bass": 6, "treble": 4, "batteryPercent": NSNull()],
    uniquingKeysWith: { $1 })
  let snapshot = try WidgetPublisher.snapshot(from: payload, now: Date(timeIntervalSince1970: 0))
  #expect(snapshot.volume == 14)
  #expect(snapshot.maxVolume == 31)
  #expect(snapshot.bass == 6)
  #expect(snapshot.batteryPercent == nil)
}

@Test(arguments: [
  ("volume", ["volume": 32, "maxVolume": 31]),  // above the device maximum
  ("bass", ["bass": 11]),  // above the knob range
  ("treble", ["treble": -1]),
  ("batteryPercent", ["batteryPercent": 101]),
] as [(String, [String: Int])])
func snapshotRejectsValuesAWidgetGaugeWouldMisdraw(field: String, extra: [String: Int]) {
  let payload = connected.merging(extra, uniquingKeysWith: { $1 })
  #expect(throws: WidgetPublishError.invalidPayload(field)) {
    try WidgetPublisher.snapshot(from: payload, now: Date())
  }
}

@Test func widgetRequestsQueueInOrderAndDrainOnce() throws {
  let store = SharedStore(
    directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
  try ControlRequestQueue.enqueue(.volume(15), in: store)
  try ControlRequestQueue.enqueue(.bass(6), in: store)

  #expect(ControlRequestQueue.drain(store) == [.volume(15), .bass(6)])
  #expect(ControlRequestQueue.drain(store) == [])
}

@Test func concurrentWidgetRequestsAreNeverLost() throws {
  let store = SharedStore(
    directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
  // Each enqueue reads, appends and rewrites the file; unlocked, two of them
  // racing write back the same prefix and one request disappears.
  DispatchQueue.concurrentPerform(iterations: 50) { level in
    try? ControlRequestQueue.enqueue(.volume(level), in: store)
  }

  #expect(ControlRequestQueue.drain(store).count == 50)
}

@Test func snapshotRoundTripsThroughTheSharedStore() throws {
  let store = SharedStore(
    directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
  #expect(SnapshotStore.load(from: store) == nil)
  try SnapshotStore.save(.sample, to: store)
  #expect(SnapshotStore.load(from: store) == DeviceSnapshot.sample)
}

@Test func disconnectEventCarriesNoReadings() {
  let body = DeviceUpdate(identifier: "A", isConnected: false).eventBody
  #expect(Set(body.keys) == ["identifier", "isConnected"])
}

@Test func deviceInfoStringsLoseTheirNulPadding() {
  #expect(GattValue.string(from: Data("ACTON III\0\0".utf8)) == "ACTON III")
  #expect(GattValue.string(from: Data([0x00, 0x00])) == nil)
}

@Test func batteryAbove100IsMalformed() {
  #expect(GattValue.batteryPercent(from: Data([100])) == 100)
  #expect(GattValue.batteryPercent(from: Data([101])) == nil)
}
