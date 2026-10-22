import SwiftUI
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Sparkle

@main
struct MarshallBluetoothApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

  var body: some Scene {
    Window("Roadie", id: "main") {
      ReactNativeView(factory: appDelegate.reactNativeFactory)
        .frame(minWidth: 560, minHeight: 440)
    }
    .defaultSize(width: 680, height: 520)
    .windowResizability(.contentMinSize)
  }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
  private let reactNativeDelegate: ReactNativeDelegate
  let reactNativeFactory: RCTReactNativeFactory
  private var statusItem: StatusItemController?
  /// Updates from GitHub Releases: `SUFeedURL` names the appcast `make release`
  /// publishes. A Debug build never starts it, so development runs are not
  /// offered the published version over themselves.
  private let updatePresenter = UpdatePresenter()
  private lazy var updater = SPUStandardUpdaterController(
    startingUpdater: !AppDelegate.isDebugBuild, updaterDelegate: nil, userDriverDelegate: updatePresenter)

  override init() {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    AppUpdates.isAvailable = updater.updater.canCheckForUpdates
    NotificationCenter.default.addObserver(
      self, selector: #selector(checkForUpdates), name: AppUpdates.checkRequested, object: nil)
    statusItem = StatusItemController(
      openWindow: { [weak self] in self?.showMainWindow() },
      updateItem: AppDelegate.isDebugBuild ? nil : updateMenuItem())
  }

  /// Every way to ask — the window's button, the menu item — comes here, so the
  /// app is in front before Sparkle answers; otherwise "up to date" or the
  /// update alert opens behind whatever window is active.
  @objc private func checkForUpdates() {
    NSApp.activate(ignoringOtherApps: true)
    updater.checkForUpdates(nil)
  }

  private static var isDebugBuild: Bool {
#if DEBUG
    true
#else
    false
#endif
  }

  /// Disabled while a check runs. A Debug build gets no item — its updater never started.
  private func updateMenuItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
    item.target = self
    return item
  }

  @objc func validateMenuItem(_ item: NSMenuItem) -> Bool {
    item.action != #selector(checkForUpdates) || updater.updater.canCheckForUpdates
  }

  /// A menu bar app outlives its window; the widget relies on it staying up.
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  /// Clicking the Dock-less app's menu item, or reopening it, brings the window back.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    showMainWindow()
    return false
  }

  private func showMainWindow() {
    // The SwiftUI `Window` scene keeps its NSWindow after close; ordering it
    // front reopens it without a second scene instance.
    NSApp.windows.first { $0.identifier?.rawValue == "main" }?.makeKeyAndOrderFront(nil)
  }
}

// MARK: - Update Alerts

/// Roadie runs in the menu bar, so a window it opens lands behind the active
/// app — and since macOS 14 an app may activate itself only while the user is
/// interacting with it, which a scheduled check never is. The alert Sparkle is
/// about to open is ordered in front of every app instead, which needs no
/// activation, so an update is seen whether it was asked for or found by itself.
final class UpdatePresenter: NSObject, SPUStandardUserDriverDelegate {
  var supportsGentleScheduledUpdateReminders: Bool { true }

  func standardUserDriverWillHandleShowingUpdate(
    _ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState
  ) {
    guard handleShowingUpdate else { return }
    NSApp.activate()
    // Sparkle opens its window after this call returns.
    DispatchQueue.main.async {
      for window in NSApp.windows where window.isVisible && window.identifier?.rawValue != "main" {
        window.orderFrontRegardless()
      }
    }
  }
}

// MARK: - React Native Delegate

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

// MARK: - React Native SwiftUI View

struct ReactNativeView: NSViewRepresentable {
  let factory: RCTReactNativeFactory

  func makeNSView(context: Context) -> NSView {
    factory.rootViewFactory.view(withModuleName: "MarshallBluetooth")
  }

  func updateNSView(_ nsView: NSView, context: Context) {}
}
