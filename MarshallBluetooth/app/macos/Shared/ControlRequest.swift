import Foundation

/// The changes the macOS widget asks the menu bar app to make on the published speaker.
///
/// The macOS widget extension never touches Bluetooth: the connection lives in
/// the app, which is why the app stays resident in the menu bar. A widget
/// button enqueues a `ControlChange` in the App Group, posts a Darwin
/// notification, and the app applies it to the speaker and republishes the
/// snapshot. iOS has no resident app; its widget presses connect for
/// themselves (`OneShotSession`).
enum ControlRequestQueue {
  static let file = "requests.json"
  /// Held by the widget and the app around every read-modify-write of `file`.
  static let lockFile = "requests.lock"
  /// Darwin notifications cross the process boundary without a payload; the
  /// payload is the queue itself.
  static let notification = "com.uk.marshallbluetooth.controlRequest"

  static func enqueue(_ change: ControlChange, in store: SharedStore) throws {
    try store.withLock(lockFile) {
      var pending = store.read([ControlChange].self, from: file) ?? []
      pending.append(change)
      try store.write(pending, as: file)
    }
    // Posted after the lock is released, so the woken app does not wait on it.
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(notification as CFString), nil, nil, true)
  }

  /// Returns every pending change and clears the queue.
  static func drain(_ store: SharedStore) -> [ControlChange] {
    store.withLock(lockFile) {
      let pending = store.read([ControlChange].self, from: file) ?? []
      store.remove(file)
      return pending
    }
  }
}
