import AppIntents
import Foundation
import WidgetKit
import os

private let log = Logger(subsystem: "com.uk.marshallbluetooth", category: "widget-intent")

/// Which speaker setting a widget button moves.
enum WidgetControl: String, AppEnum {
  case volume
  case bass
  case treble

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Control")
  static let caseDisplayRepresentations: [WidgetControl: DisplayRepresentation] = [
    .volume: "Volume", .bass: "Bass", .treble: "Treble",
  ]
}

/// Steps one setting of the published speaker.
///
/// Runs inside the widget extension, which has no Bluetooth: it enqueues the
/// request for the menu bar app and shows the expected value at once so the
/// button feels immediate. The app's read-back then publishes the real value.
struct StepControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Adjust speaker"
  static let isDiscoverable = false

  @Parameter(title: "Control") var control: WidgetControl
  @Parameter(title: "Step") var step: Int

  init() {}

  init(control: WidgetControl, step: Int) {
    self.control = control
    self.step = step
  }

  func perform() async throws -> some IntentResult {
    guard let store = SharedStore(), var snapshot = SnapshotStore.load(from: store)
    else {
      log.error("\(control.rawValue, privacy: .public) \(step): no app group or no published speaker")
      return .result()
    }
    // Stepping from a guessed start would write the guess: volume 0 on a
    // speaker not yet read is silence. The button waits for the reading.
    guard let current = snapshot.value(of: control) else {
      log.info("\(control.rawValue, privacy: .public) \(step): not read from the speaker yet")
      return .result()
    }
    let request: ControlRequest
    switch control {
    case .volume:
      let next = clamp(current + step, 0, snapshot.maxVolume ?? 31)
      snapshot.volume = next
      request = .volume(next)
    case .bass:
      let next = clamp(current + step, EQScale.steps)
      snapshot.bass = next
      request = .bass(next)
    case .treble:
      let next = clamp(current + step, EQScale.steps)
      snapshot.treble = next
      request = .treble(next)
    }
    try SnapshotStore.save(snapshot, to: store)
    try ControlRequestQueue.enqueue(request, in: store)
    log.info("\(control.rawValue, privacy: .public) \(step) queued for \(snapshot.identifier, privacy: .public)")
    return .result()
  }

  private func clamp(_ value: Int, _ range: ClosedRange<Int>) -> Int {
    min(max(value, range.lowerBound), range.upperBound)
  }

  private func clamp(_ value: Int, _ lower: Int, _ upper: Int) -> Int {
    clamp(value, lower...upper)
  }
}

/// Returns both tone bands to flat in one press.
struct ResetToneIntent: AppIntent {
  static let title: LocalizedStringResource = "Reset tone to flat"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    guard let store = SharedStore(), var snapshot = SnapshotStore.load(from: store) else {
      log.error("reset tone: no app group or no published speaker")
      return .result()
    }
    // An EQ write carries both bands; the app has nothing to write until it has read them.
    guard snapshot.bass != nil, snapshot.treble != nil else {
      log.info("reset tone: tone not read from the speaker yet")
      return .result()
    }
    snapshot.bass = EQScale.flat
    snapshot.treble = EQScale.flat
    try SnapshotStore.save(snapshot, to: store)
    try ControlRequestQueue.enqueue(.bass(EQScale.flat), in: store)
    try ControlRequestQueue.enqueue(.treble(EQScale.flat), in: store)
    log.info("tone reset queued for \(snapshot.identifier, privacy: .public)")
    return .result()
  }
}

extension DeviceSnapshot {
  /// The setting a widget button steps, or nil until the app has read it.
  func value(of control: WidgetControl) -> Int? {
    switch control {
    case .volume: return volume
    case .bass: return bass
    case .treble: return treble
    }
  }
}
