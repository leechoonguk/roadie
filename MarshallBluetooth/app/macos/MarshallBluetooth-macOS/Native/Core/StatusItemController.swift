import AppKit

/// The menu bar presence of a Dock-less app (`LSUIElement`).
///
/// Roadie lives in the menu bar so the desktop widget's buttons always have a
/// running app to carry them to the speaker. The item shows the speaker's
/// state at a glance and is the way back to the window once it is closed.
final class StatusItemController: NSObject {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let speakerLine = NSMenuItem(title: "No speaker yet", action: nil, keyEquivalent: "")
  private let openWindow: () -> Void
  /// The App Group store the app publishes snapshots to; the menu mirrors it.
  private let store: SharedStore?

  /// - Parameter updateItem: "Check for Updates…", built by the app target where
  ///   Sparkle is linked; this core file compiles without it (`make swift-check`).
  init(openWindow: @escaping () -> Void, updateItem: NSMenuItem? = nil, store: SharedStore? = SharedStore()) {
    self.openWindow = openWindow
    self.store = store
    super.init()
    item.button?.image = NSImage(systemSymbolName: "dial.medium", accessibilityDescription: "Roadie")
    item.button?.image?.isTemplate = true

    let menu = NSMenu()
    speakerLine.isEnabled = false
    menu.addItem(speakerLine)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Open Roadie", action: #selector(open), keyEquivalent: "o").target = self
    if let updateItem { menu.addItem(updateItem) }
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Roadie", action: #selector(quit), keyEquivalent: "q").target = self
    item.menu = menu
    NotificationCenter.default.addObserver(
      self, selector: #selector(refresh), name: WidgetPublisher.didPublish, object: nil)
    refresh()
  }

  @objc private func refresh() {
    guard let store, let snapshot = SnapshotStore.load(from: store) else { return }
    var parts = [snapshot.name, snapshot.isConnected ? "connected" : "not connected"]
    if let volume = snapshot.volume { parts.append("volume \(volume)") }
    speakerLine.title = parts.joined(separator: " · ")
  }

  @objc private func open() {
    NSApp.activate(ignoringOtherApps: true)
    openWindow()
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }
}
