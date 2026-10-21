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

  func action(step: Int) -> ControlAction {
    switch self {
    case .volume: return .volume(step: step)
    case .bass: return .bass(step: step)
    case .treble: return .treble(step: step)
    }
  }
}

/// Steps one setting of the published speaker.
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
    await WidgetPress.perform(control.action(step: step))
    return .result()
  }
}

/// Returns both tone bands to flat in one press.
struct ResetToneIntent: AppIntent {
  static let title: LocalizedStringResource = "Reset tone to flat"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    await WidgetPress.perform(.flat)
    return .result()
  }
}

#if os(iOS)
  // A widget's intent runs in the widget extension unless it is a Live Activity
  // intent, which the system performs in the app's process — launching the app
  // in the background if it is not running. That process holds the Bluetooth
  // permission and the `bluetooth-central` background mode an extension lacks.
  extension StepControlIntent: LiveActivityIntent {}
  extension ResetToneIntent: LiveActivityIntent {}
#endif

/// One press, the same on every Apple widget: step the published snapshot so
/// the button answers at once, then hand the change to the speaker.
enum WidgetPress {
  static func perform(_ action: ControlAction) async {
    guard let store = SharedStore(), let snapshot = SnapshotStore.load(from: store) else {
      log.error("\(String(describing: action), privacy: .public): no app group or no published speaker")
      return
    }
    guard let change = action.change(from: snapshot.controls) else {
      log.info("\(String(describing: action), privacy: .public): nothing to change from the values read")
      return
    }
    do {
      try SnapshotStore.save(snapshot.with(snapshot.controls.applying(change)), to: store)
      try await deliver(action, change, for: snapshot, in: store)
    } catch {
      log.error("\(String(describing: action), privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
      // The speaker kept what it had; so does the widget.
      try? SnapshotStore.save(snapshot, to: store)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }

  #if os(iOS)
    /// iOS has no resident app to hand the press to: connect for this one
    /// press, step from what the speaker reports now, and show what it stored.
    private static func deliver(
      _ action: ControlAction, _ change: ControlChange, for snapshot: DeviceSnapshot,
      in store: SharedStore
    ) async throws {
      let stored = try await OneShotSession.apply(action, to: snapshot.identifier)
      try SnapshotStore.save(snapshot.with(snapshot.controls.merging(stored)), to: store)
      WidgetCenter.shared.reloadAllTimelines()
      log.info("\(String(describing: action), privacy: .public) applied to \(snapshot.identifier, privacy: .public)")
    }
  #else
    /// macOS: the menu bar app holds the connection; the extension queues the
    /// change for it, and the app's read-back republishes the real value.
    private static func deliver(
      _ action: ControlAction, _ change: ControlChange, for snapshot: DeviceSnapshot,
      in store: SharedStore
    ) async throws {
      try ControlRequestQueue.enqueue(change, in: store)
      log.info("\(String(describing: action), privacy: .public) queued for \(snapshot.identifier, privacy: .public)")
    }
  #endif
}
