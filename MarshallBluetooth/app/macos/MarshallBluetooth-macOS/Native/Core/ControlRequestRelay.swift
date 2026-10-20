import Foundation
import os

/// Carries the widget's requests to the speaker.
///
/// Listens for the Darwin notification the widget posts, drains the App Group
/// queue, and applies each request to the published speaker through the
/// scanner. The scanner's read-back then flows to JavaScript, which
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

  /// Applies every pending request to the speaker the snapshot names.
  func drain() {
    guard let store else { return }
    let requests = ControlRequestQueue.drain(store)
    guard !requests.isEmpty else {
      Self.log.debug("woken with an empty queue")
      return
    }
    guard var snapshot = SnapshotStore.load(from: store) else {
      Self.log.error("\(requests.count) request(s) but no published speaker to apply them to")
      return
    }
    // Rapid presses queue several steps of the same control; only the last
    // value per control reaches the speaker, so a burst costs one write.
    var volume: Int?
    var toneChanged = false
    for request in requests {
      switch request {
      case .volume(let level): volume = level
      case .bass(let step):
        snapshot.bass = step
        toneChanged = true
      case .treble(let step):
        snapshot.treble = step
        toneChanged = true
      }
    }
    Self.log.info("applying \(requests.count) request(s) to \(snapshot.identifier, privacy: .public)")
    if let volume {
      scanner.setVolume(identifier: snapshot.identifier, level: volume)
    }
    if toneChanged {
      scanner.setEQ(
        identifier: snapshot.identifier,
        bass: snapshot.bass ?? EQScale.flat, treble: snapshot.treble ?? EQScale.flat)
    }
  }
}
