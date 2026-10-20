import Foundation

/// A change the widget asks the app to make on the published speaker.
///
/// The widget extension never touches Bluetooth: the connection lives in the
/// app, which is why the app stays resident in the menu bar. A widget button
/// enqueues a request in the App Group, posts a Darwin notification, and the
/// app applies it to the speaker and republishes the snapshot.
enum ControlRequest: Codable, Equatable {
  case volume(Int)
  case bass(Int)
  case treble(Int)
}

enum ControlRequestQueue {
  static let file = "requests.json"
  /// Held by the widget and the app around every read-modify-write of `file`.
  static let lockFile = "requests.lock"
  /// Darwin notifications cross the process boundary without a payload; the
  /// payload is the queue itself.
  static let notification = "com.uk.marshallbluetooth.controlRequest"

  static func enqueue(_ request: ControlRequest, in store: SharedStore) throws {
    try store.withLock(lockFile) {
      var pending = store.read([ControlRequest].self, from: file) ?? []
      pending.append(request)
      try store.write(pending, as: file)
    }
    // Posted after the lock is released, so the woken app does not wait on it.
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(notification as CFString), nil, nil, true)
  }

  /// Returns every pending request and clears the queue.
  static func drain(_ store: SharedStore) -> [ControlRequest] {
    store.withLock(lockFile) {
      let pending = store.read([ControlRequest].self, from: file) ?? []
      store.remove(file)
      return pending
    }
  }
}
