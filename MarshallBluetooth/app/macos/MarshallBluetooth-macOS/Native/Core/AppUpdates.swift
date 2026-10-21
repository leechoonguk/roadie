import Foundation

/// The window's way to the updater.
///
/// Sparkle is linked into the app target only, so this core neither imports it
/// nor runs it: it carries the request as a notification the app delegate
/// answers, and the facts the window shows next to its button.
enum AppUpdates {
  /// Posted on the main queue; the app delegate starts a user-initiated check.
  static let checkRequested = Notification.Name("com.uk.marshallbluetooth.checkForUpdates")

  /// Whether a check can run — set once the updater has started. A Debug build
  /// never starts it, so the window does not offer a button that does nothing.
  static var isAvailable = false

  /// The version a user reads: the release tag `make dist` stamps, `0.0.0` in development.
  static func version(of bundle: Bundle = .main) -> String {
    bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
  }

  static func requestCheck(center: NotificationCenter = .default) {
    center.post(name: checkRequested, object: nil)
  }
}
