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
  private let updater = SPUStandardUpdaterController(
    startingUpdater: !AppDelegate.isDebugBuild, updaterDelegate: nil, userDriverDelegate: nil)

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

  /// The window's "Check for Updates" button; the menu item reaches Sparkle directly.
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

  /// Sparkle validates the item itself: it is disabled while a check runs. A
  /// Debug build gets no item — its updater never started.
  private func updateMenuItem() -> NSMenuItem {
    let item = NSMenuItem(
      title: "Check for Updates…", action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: "")
    item.target = updater
    return item
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
