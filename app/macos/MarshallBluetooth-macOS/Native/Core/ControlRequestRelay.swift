import Foundation
import os

/// Carries the widget's requests to the speaker.
///
/// Listens for the Darwin notification the widget posts, drains the App Group
/// queue, and applies the coalesced changes to the published speaker through
/// the scanner. The scanner's read-back then flows to JavaScript, which
/// republishes the snapshot, so the widget settles on the value the speaker
/// actually stored.
final class ControlRequestRelay {
  private static let log = Logger(subsystem: "com.uk.marshallbluetooth", category: "relay")

  private let scanner: MarshallScanner
  private let store: SharedStore?

  init(scanner: MarshallScanner, store: SharedStore? = SharedStore()) {
    self.scanner = scanner
    self.store = store
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), observer,
      { _, observer, _, _, _ in
        guard let observer else { return }
        Unmanaged<ControlRequestRelay>.fromOpaque(observer).takeUnretainedValue().drain()
      },
      ControlRequestQueue.notification as CFString, nil, .deliverImmediately)
    Self.log.info("listening for widget requests; app group \(store == nil ? "unavailable" : "ready", privacy: .public)")
    drain()
  }

  deinit {
    CFNotificationCenterRemoveEveryObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
  }

  /// Applies every pending change to the speaker the snapshot names.
  func drain() {
    guard let store else { return }
    let changes = ControlChange.coalesced(ControlRequestQueue.drain(store))
    guard !changes.isEmpty else {
      Self.log.debug("woken with an empty queue")
      return
    }
    guard let snapshot = SnapshotStore.load(from: store) else {
      Self.log.error("\(changes.count) change(s) but no published speaker to apply them to")
      return
    }
    Self.log.info("applying \(changes.count) change(s) to \(snapshot.identifier, privacy: .public)")
    for change in changes {
      switch change {
      case .volume(let level):
        scanner.setVolume(identifier: snapshot.identifier, level: level)
      case .eq(let bass, let treble):
        scanner.setEQ(identifier: snapshot.identifier, bass: bass, treble: treble)
      }
    }
  }
}
