import Foundation

/// What the widget shows about one Marshall device: the app writes it, the widget reads it.
///
/// Compiled into both the app and the widget extension. They are separate
/// processes with separate sandboxes, so the only channel between them is the
/// App Group container's `UserDefaults` suite.
struct DeviceSnapshot: Codable, Equatable {
  let name: String
  let identifier: String
  /// Model from Device Information, nil until the speaker has been read.
  var model: String?
  /// 0–100, or nil on a model without a battery (an ACTON III is mains-powered).
  var batteryPercent: Int?
  let isConnected: Bool
  /// Speaker volume 0–`maxVolume`, in the speaker's own steps.
  var volume: Int?
  var maxVolume: Int?
  /// EQ steps 0–10, 5 flat.
  var bass: Int?
  var treble: Int?
  let updatedAt: Date

  /// Shown in the widget gallery and before the app has published anything.
  static let sample = DeviceSnapshot(
    name: "ACTON III",
    identifier: "sample",
    model: "ACTON III",
    batteryPercent: nil,
    isConnected: true,
    volume: 14,
    maxVolume: 31,
    bass: 5,
    treble: 5,
    updatedAt: Date(timeIntervalSince1970: 0)
  )
}

/// The speaker's EQ scale: knob steps 0–10, flat at 5. Shared so the BLE codec
/// and the widget draw from one definition.
enum EQScale {
  static let steps = 0...10
  static let flat = 5
}

/// The App Group container both processes can read and write.
///
/// Files, not `UserDefaults`: with an ad-hoc signature the group has no team
/// prefix, and cfprefsd then refuses to share a suite between the app and the
/// widget ("only allowed for System Containers") while the container directory
/// itself works for both. Writes are atomic, so a reader never sees a torn file.
struct SharedStore {
  /// Info.plist key holding the App Group identifier.
  ///
  /// The value is `$(TeamIdentifierPrefix)marshallbluetooth`, expanded at build
  /// time, so both targets read the same group without hardcoding a team.
  static let appGroupInfoKey = "AppGroupIdentifier"

  let directory: URL

  /// The store for this process's App Group, or nil when the bundle names none.
  init?(bundle: Bundle = .main) {
    guard let group = bundle.object(forInfoDictionaryKey: Self.appGroupInfoKey) as? String,
      !group.isEmpty,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    directory = container.appendingPathComponent("Roadie", isDirectory: true)
  }

  init(directory: URL) {
    self.directory = directory
  }

  func write<Value: Encodable>(_ value: Value, as name: String) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try JSONEncoder().encode(value).write(to: directory.appendingPathComponent(name), options: .atomic)
  }

  func read<Value: Decodable>(_ type: Value.Type, from name: String) -> Value? {
    guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  func remove(_ name: String) {
    try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
  }
}

/// The single published snapshot.
enum SnapshotStore {
  static let file = "snapshot.json"

  static func save(_ snapshot: DeviceSnapshot, to store: SharedStore) throws {
    try store.write(snapshot, as: file)
  }

  static func load(from store: SharedStore) -> DeviceSnapshot? {
    store.read(DeviceSnapshot.self, from: file)
  }
}
