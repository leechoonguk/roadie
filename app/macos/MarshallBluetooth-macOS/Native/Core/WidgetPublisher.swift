import Foundation
import WidgetKit

enum WidgetPublishError: Error, Equatable {
  case invalidPayload(String)
  case appGroupUnavailable
}

/// Turns the JavaScript payload into a snapshot, stores it, and reloads the widget.
enum WidgetPublisher {
  /// Builds a snapshot from `{ name, identifier, isConnected, model?, batteryPercent?,
  /// volume?, maxVolume?, bass?, treble? }`.
  ///
  /// Out-of-range numbers are rejected rather than clamped: a value the widget
  /// would draw as a full or empty gauge must not come from a bug.
  static func snapshot(from payload: [String: Any], now: Date) throws -> DeviceSnapshot {
    guard let name = payload["name"] as? String, !name.isEmpty else {
      throw WidgetPublishError.invalidPayload("name")
    }
    guard let identifier = payload["identifier"] as? String, !identifier.isEmpty else {
      throw WidgetPublishError.invalidPayload("identifier")
    }
    guard let isConnected = payload["isConnected"] as? Bool else {
      throw WidgetPublishError.invalidPayload("isConnected")
    }
    let maxVolume = try integer(payload, "maxVolume", in: 1...255)
    return DeviceSnapshot(
      name: name,
      identifier: identifier,
      model: payload["model"] as? String,
      batteryPercent: try integer(payload, "batteryPercent", in: 0...100),
      isConnected: isConnected,
      volume: try integer(payload, "volume", in: 0...(maxVolume ?? 255)),
      maxVolume: maxVolume,
      bass: try integer(payload, "bass", in: EQSettings.steps),
      treble: try integer(payload, "treble", in: EQSettings.steps),
      updatedAt: now)
  }

  /// An optional integer field: absent or null is nil, anything else must be in range.
  private static func integer(
    _ payload: [String: Any], _ key: String, in range: ClosedRange<Int>
  ) throws -> Int? {
    guard let value = payload[key], !(value is NSNull) else { return nil }
    guard let number = value as? Int, range.contains(number) else {
      throw WidgetPublishError.invalidPayload(key)
    }
    return number
  }

  static func publish(_ snapshot: DeviceSnapshot, bundle: Bundle = .main) throws {
    guard let store = SharedStore(bundle: bundle) else {
      throw WidgetPublishError.appGroupUnavailable
    }
    try SnapshotStore.save(snapshot, to: store)
    WidgetCenter.shared.reloadAllTimelines()
    // In-process listeners (the menu bar item) learn of the new snapshot here;
    // the widget learns through the timeline reload.
    NotificationCenter.default.post(name: Self.didPublish, object: nil)
  }

  static let didPublish = Notification.Name("com.uk.marshallbluetooth.didPublish")
}
