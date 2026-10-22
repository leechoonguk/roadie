import AppKit
import Foundation

// Renders Roadie's app icon into the asset catalog: a brass amp knob on
// charcoal, pointer past "10" — the dial that goes to eleven. Drawn with
// CoreGraphics at every catalog size so no bitmap is ever scaled.
//
//   roadie-icon <path to AppIcon.appiconset>

let catalogSizes: [(points: Int, scale: Int)] = [
  (16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2),
]

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
  CGColor(
    red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
    blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

func gradient(_ stops: [(UInt32, CGFloat)]) -> CGGradient {
  CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: stops.map { color($0.0) } as CFArray,
    locations: stops.map(\.1))!
}

/// Draws the icon in a 1024-unit space; the context's transform supplies the size.
func drawIcon(in g: CGContext) {
  // macOS icon template: the artwork fills an 824pt rounded square centred in 1024.
  let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
  let tilePath = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)

  g.saveGState()
  g.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, alpha: 0.45))
  g.setFillColor(color(0x1B1B1E))
  g.addPath(tilePath)
  g.fillPath()
  g.restoreGState()

  g.saveGState()
  g.addPath(tilePath)
  g.clip()
  g.drawLinearGradient(
    gradient([(0x303034, 0), (0x161618, 1)]),
    start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

  // Faint grille cloth: horizontal hairlines.
  g.setStrokeColor(color(0xFFFFFF, alpha: 0.035))
  g.setLineWidth(2)
  for y in stride(from: 120, through: 910, by: 14) {
    g.move(to: CGPoint(x: 100, y: CGFloat(y)))
    g.addLine(to: CGPoint(x: 924, y: CGFloat(y)))
  }
  g.strokePath()
  g.restoreGState()

  let centre = CGPoint(x: 512, y: 500)

  // Scale ticks 0…11 around the knob; "11" sits past the usual end.
  let tickCount = 12
  for index in 0..<tickCount {
    let sweep = 270.0 * Double(index) / Double(tickCount - 1)
    let angle = (225 - sweep) * Double.pi / 180
    let inner = CGPoint(x: centre.x + 326 * cos(angle), y: centre.y + 326 * sin(angle))
    let outer = CGPoint(x: centre.x + 352 * cos(angle), y: centre.y + 352 * sin(angle))
    g.setStrokeColor(color(index == tickCount - 1 ? 0xE8C86A : 0xB89A4E, alpha: 0.9))
    g.setLineWidth(index == tickCount - 1 ? 14 : 9)
    g.setLineCap(.round)
    g.move(to: inner)
    g.addLine(to: outer)
    g.strokePath()
  }

  // Brass ring.
  g.saveGState()
  g.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: color(0x000000, alpha: 0.6))
  g.addEllipse(in: CGRect(x: centre.x - 290, y: centre.y - 290, width: 580, height: 580))
  g.clip()
  g.drawLinearGradient(
    gradient([(0xE2C470, 0), (0xB8923E, 0.55), (0x7E5F20, 1)]),
    start: CGPoint(x: 512, y: 790), end: CGPoint(x: 512, y: 210), options: [])
  g.restoreGState()

  // Knurled edge: alternating light and dark spokes on the ring.
  g.saveGState()
  g.addEllipse(in: CGRect(x: centre.x - 290, y: centre.y - 290, width: 580, height: 580))
  g.addEllipse(in: CGRect(x: centre.x - 248, y: centre.y - 248, width: 496, height: 496))
  g.clip(using: .evenOdd)
  for index in 0..<48 {
    let angle = Double(index) / 48 * 2 * Double.pi
    g.setStrokeColor(color(index.isMultiple(of: 2) ? 0xFFF1B8 : 0x5E4515, alpha: 0.35))
    g.setLineWidth(6)
    g.move(to: CGPoint(x: centre.x + 240 * cos(angle), y: centre.y + 240 * sin(angle)))
    g.addLine(to: CGPoint(x: centre.x + 300 * cos(angle), y: centre.y + 300 * sin(angle)))
    g.strokePath()
  }
  g.restoreGState()

  // Cap.
  g.saveGState()
  g.addEllipse(in: CGRect(x: centre.x - 248, y: centre.y - 248, width: 496, height: 496))
  g.clip()
  g.drawRadialGradient(
    gradient([(0x3A3A3E, 0), (0x1C1C1F, 0.7), (0x0E0E10, 1)]),
    startCenter: CGPoint(x: 440, y: 600), startRadius: 0,
    endCenter: centre, endRadius: 260, options: [])
  g.restoreGState()

  // Pointer, resting on 11.
  let pointerAngle = (225 - 270) * Double.pi / 180
  g.setStrokeColor(color(0xF4F1EA))
  g.setLineWidth(34)
  g.setLineCap(.round)
  g.move(to: CGPoint(x: centre.x + 70 * cos(pointerAngle), y: centre.y + 70 * sin(pointerAngle)))
  g.addLine(to: CGPoint(x: centre.x + 212 * cos(pointerAngle), y: centre.y + 212 * sin(pointerAngle)))
  g.strokePath()
}

func render(pixels: Int) -> Data {
  let context = CGContext(
    data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
  drawIcon(in: context)
  let image = context.makeImage()!
  let rep = NSBitmapImageRep(cgImage: image)
  return rep.representation(using: .png, properties: [:])!
}

guard CommandLine.arguments.count == 2 else {
  print("usage: roadie-icon <AppIcon.appiconset>")
  exit(2)
}
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
var entries: [[String: String]] = []
for (points, scale) in catalogSizes {
  let name = scale == 1 ? "icon_\(points).png" : "icon_\(points)@\(scale)x.png"
  try render(pixels: points * scale).write(to: folder.appendingPathComponent(name))
  entries.append(["idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x", "filename": name])
  print("wrote \(name)")
}
let manifest: [String: Any] = ["images": entries, "info": ["author": "roadie-icon", "version": 1]]
let json = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
try (String(decoding: json, as: UTF8.self) + "\n").write(
  to: folder.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
