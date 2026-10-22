// swift-tools-version:6.0
import PackageDescription

// Builds the React-free native code as a library so `make swift-test` can run
// Swift Testing over it with the Command Line Tools alone. The sources are
// symlinks to `Shared/` and `Native/Core/`: a package rooted at `app/macos/`
// would sweep in the asset catalog and Pods, which need Xcode to build. The
// app itself is still built by the Xcode project.
let package = Package(
  name: "MarshallCore",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "MarshallCore", path: "Sources/MarshallCore"),
    .testTarget(name: "MarshallCoreTests", dependencies: ["MarshallCore"], path: "Tests"),
    // Drives the real scanner against a real speaker from the terminal, without
    // React. The embedded Info.plist carries the Bluetooth usage string macOS
    // demands before a process may touch CoreBluetooth.
    .executableTarget(
      name: "marshall-probe",
      dependencies: ["MarshallCore"],
      path: "Probe",
      exclude: ["Info.plist"],
      linkerSettings: [
        .unsafeFlags([
          "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
          "-Xlinker", "Probe/Info.plist",
        ])
      ]
    ),
    // Draws the app icon into the asset catalog (`make app-icon`).
    .executableTarget(name: "roadie-icon", path: "Icon"),
    // Renders the widget's own views into the README's pictures (`make
    // widget-snapshots`). `Widget` links the extension's sources; its entry
    // point and bundle files stay out, as this tool has an entry point of its own.
    .executableTarget(
      name: "roadie-widget-snapshots",
      path: "WidgetSnapshots",
      exclude: ["Widget/MarshallWidgetBundle.swift", "Widget/Info.plist", "Widget/MarshallWidget.entitlements"]
    ),
  ],
  swiftLanguageModes: [.v5]
)
