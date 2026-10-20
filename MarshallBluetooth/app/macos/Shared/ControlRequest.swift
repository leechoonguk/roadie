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
  /// Darwin notifications cross the process boundary without a payload; the
  /// payload is the queue itself.
  static let notification = "com.uk.marshallbluetooth.controlRequest"

  static func enqueue(_ request: ControlRequest, in store: SharedStore) throws {
    var pending = drain(store, keep: true)
    pending.append(request)
    try store.write(pending, as: file)
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(notification as CFString), nil, nil, true)
  }

  /// Returns every pending request, clearing the queue unless `keep` is set.
  static func drain(_ store: SharedStore, keep: Bool = false) -> [ControlRequest] {
    let pending = store.read([ControlRequest].self, from: file) ?? []
    if !keep {
      store.remove(file)
    }
    return pending
  }
}
