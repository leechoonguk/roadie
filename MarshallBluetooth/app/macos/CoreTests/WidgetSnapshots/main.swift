import AppKit
import SwiftUI
import WidgetKit

// Renders the README's widget pictures: the real `MarshallWidgetView`, in all
// three sizes, once light and once dark, each set on one backdrop. The widget
// sources are compiled in through the `Widget` symlink, so a changed widget is
// re-rendered with `make widget-snapshots`, never redrawn by hand.
//
//   roadie-widget-snapshots <output directory>

/// WidgetKit's point sizes for each family on a Mac desktop.
let families: [(family: WidgetFamily, size: CGSize)] = [
  (.systemSmall, CGSize(width: 170, height: 170)),
  (.systemMedium, CGSize(width: 364, height: 170)),
  (.systemLarge, CGSize(width: 364, height: 382)),
]
let gap: CGFloat = 20

/// A connected speaker a minute after its last change, knob values off flat so every bar shows.
let entry = MarshallEntry(
  date: Date(),
  snapshot: DeviceSnapshot(
    name: "ACTON III", identifier: "readme", model: "ACTON III", batteryPercent: nil,
    isConnected: true, volume: 18, maxVolume: 31, bass: 7, treble: 4,
    updatedAt: Date().addingTimeInterval(-60)),
  isSample: false)

/// One widget as a desktop host draws it: its content inset, on a rounded tile.
struct Tile: View {
  let family: WidgetFamily
  let size: CGSize
  let scheme: ColorScheme

  var body: some View {
    MarshallWidgetView(entry: entry, family: family)
      .padding(16)
      .frame(width: size.width, height: size.height)
      .background(
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(scheme == .dark ? Color(white: 0.17) : Color.white)
          .shadow(color: .black.opacity(scheme == .dark ? 0.5 : 0.12), radius: 10, y: 4))
  }
}

/// Small over medium on the left, large on the right.
struct Board: View {
  let scheme: ColorScheme

  var body: some View {
    HStack(alignment: .top, spacing: gap) {
      VStack(alignment: .leading, spacing: gap) {
        tile(.systemMedium)
        tile(.systemSmall)
      }
      tile(.systemLarge)
    }
    .padding(32)
    .background(scheme == .dark ? Color(white: 0.08) : Color(white: 0.92))
    .environment(\.colorScheme, scheme)
  }

  private func tile(_ family: WidgetFamily) -> some View {
    Tile(family: family, size: families.first(where: { $0.family == family })!.size, scheme: scheme)
  }
}

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(Data("usage: roadie-widget-snapshots <output directory>\n".utf8))
  exit(2)
}
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

for (scheme, name) in [(ColorScheme.light, "light"), (.dark, "dark")] {
  let png = MainActor.assumeIsolated { () -> Data? in
    let renderer = ImageRenderer(content: Board(scheme: scheme))
    // Twice the point size, so the picture stays sharp on a high-density screen.
    renderer.scale = 2
    return renderer.cgImage.flatMap { NSBitmapImageRep(cgImage: $0).representation(using: .png, properties: [:]) }
  }
  guard let png else {
    FileHandle.standardError.write(Data("could not render the \(name) widgets\n".utf8))
    exit(1)
  }
  let file = output.appendingPathComponent("widgets-\(name).png")
  try png.write(to: file)
  print("wrote \(file.path)")
}
