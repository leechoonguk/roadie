import Foundation

// MARK: - Values

/// Device information from the Device Information Service (0x180A).
///
/// Each characteristic is read separately, so one report carries one field and
/// leaves the rest nil; a nil field means "not in this report", never "empty".
struct DeviceInfo: Equatable {
  var model: String?
  var firmwareVersion: String?
  var serialNumber: String?
}

/// Bass and treble as the speaker stores them: steps 0–10, 5 is flat.
///
/// The EQ characteristic holds five bytes, `[bass, b1, b2, b3, treble]`,
/// measured on an ACTON III (firmware 8.2.2): turning the bass knob moved only
/// byte 0 and the treble knob only byte 4, each across 0x00–0x0A, while bytes
/// 1–3 stayed 0xFF. Those three are kept as read and written back untouched —
/// what they mean on other models is unknown, and an EQ write must not change
/// a setting the app does not understand.
struct EQSettings: Equatable {
  /// The knob range, from the shared scale the widget also draws.
  static let steps = EQScale.steps

  let bass: Int
  let treble: Int
  let middle: [UInt8]

  init?(_ data: Data) {
    let bytes = [UInt8](data)
    guard bytes.count == 5, Self.steps.contains(Int(bytes[0])), Self.steps.contains(Int(bytes[4]))
    else { return nil }
    bass = Int(bytes[0])
    treble = Int(bytes[4])
    middle = Array(bytes[1...3])
  }

  private init(bass: Int, treble: Int, middle: [UInt8]) {
    self.bass = bass
    self.treble = treble
    self.middle = middle
  }

  /// A new bass/treble over the middle bytes this value was read with. Clamps
  /// rather than rejects: a step past the end is a UI edge, not a bad request.
  func with(bass: Int, treble: Int) -> EQSettings {
    EQSettings(
      bass: min(max(bass, Self.steps.lowerBound), Self.steps.upperBound),
      treble: min(max(treble, Self.steps.lowerBound), Self.steps.upperBound),
      middle: middle)
  }

  var data: Data {
    Data([UInt8(bass)] + middle + [UInt8(treble)])
  }
}

/// Volume as the speaker stores it: one byte, 0 to the device's own maximum.
///
/// The maximum has its own characteristic (31 on an ACTON III); a write made
/// before it is read is clamped to `fallbackMaximum`, that measured value.
enum VolumeLevel {
  static let fallbackMaximum = 31

  static func decode(_ data: Data) -> Int? {
    data.count == 1 ? Int(data[data.startIndex]) : nil
  }

  static func encode(_ level: Int, maximum: Int?) -> Data {
    Data([UInt8(min(max(level, 0), maximum ?? fallbackMaximum))])
  }
}

/// Control state from one notification or read; a nil field was not reported.
struct ControlState: Equatable {
  var volume: Int?
  var maxVolume: Int?
  var bass: Int?
  var treble: Int?
}

// MARK: - GATT values

enum GattValue {
  /// Battery Level (0x2A19) is one byte, 0–100; anything above is malformed.
  static func batteryPercent(from data: Data?) -> Int? {
    guard let byte = data?.first, byte <= 100 else { return nil }
    return Int(byte)
  }

  /// DIS strings are UTF-8 and some firmwares pad them with NULs.
  static func string(from data: Data?) -> String? {
    guard let data, !data.isEmpty,
      let text = String(data: data, encoding: .utf8)?.trimmingCharacters(
        in: .controlCharacters.union(.whitespaces)),
      !text.isEmpty
    else { return nil }
    return text
  }
}

/// One characteristic of a connected device, as the GATT map reports it.
struct GattCharacteristic: Equatable {
  let uuid: String
  let properties: [String]
}

/// One service and its characteristics, discovered after connecting.
struct GattService: Equatable {
  let uuid: String
  let characteristics: [GattCharacteristic]
}

// MARK: - Reports

/// One advertising peripheral, as the scanner reports it to JavaScript.
struct DiscoveredDevice: Equatable {
  let identifier: String
  let name: String?
  let rssi: Int
  let advertisedServices: [String]
  let isMarshallCandidate: Bool

  var eventBody: [String: Any] {
    [
      "identifier": identifier,
      "name": name ?? NSNull(),
      "rssi": rssi,
      "advertisedServices": advertisedServices,
      "isMarshallCandidate": isMarshallCandidate,
    ]
  }
}

/// One report about a connected or disconnecting device.
///
/// Only reported fields reach JavaScript: an absent key leaves the last known
/// value in place, so a volume report cannot erase the EQ and a firmware read
/// cannot erase the model.
struct DeviceUpdate: Equatable {
  let identifier: String
  let isConnected: Bool
  var batteryPercent: Int?
  var deviceInfo: DeviceInfo?
  var controlState: ControlState?

  var eventBody: [String: Any] {
    var body: [String: Any] = ["identifier": identifier, "isConnected": isConnected]
    if let batteryPercent {
      body["batteryPercent"] = batteryPercent
    }
    if let deviceInfo {
      var info: [String: Any] = [:]
      info["model"] = deviceInfo.model
      info["firmwareVersion"] = deviceInfo.firmwareVersion
      info["serialNumber"] = deviceInfo.serialNumber
      body["deviceInfo"] = info
    }
    if let controlState {
      var control: [String: Any] = [:]
      control["volume"] = controlState.volume
      control["maxVolume"] = controlState.maxVolume
      control["bass"] = controlState.bass
      control["treble"] = controlState.treble
      body["controlState"] = control
    }
    return body
  }
}
