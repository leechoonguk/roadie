import Foundation

@testable import MarshallCore

// Exercises `MarshallScanner` step by step against a real speaker, so a failure
// is pinned to one stage — scan, connect, GATT reads, or the vendor command —
// instead of surfacing as "the app does nothing".
//
//   marshall-probe [--scan SECONDS] [--target TEXT] [--volume LEVEL] [--eq BASS,TREBLE]
//                  [--listen SECONDS] [--raw] [--write UUID=HEX]
//
//   --raw  read and subscribe to every undecoded characteristic and print its
//          bytes; change a setting on the speaker while it listens to see which
//          characteristic moves.

/// Collects scanner events from the scanner's queue and prints them as they arrive.
final class Recorder: MarshallScannerDelegate {
  private let lock = NSLock()
  private var seen: [String: DiscoveredDevice] = [:]
  private let started = Date()

  var devices: [DiscoveredDevice] {
    lock.lock()
    defer { lock.unlock() }
    return Array(seen.values)
  }

  func scanner(_ scanner: MarshallScanner, didChangeState state: String) {
    print("[state] Bluetooth \(state)")
  }

  func scanner(_ scanner: MarshallScanner, didDiscover device: DiscoveredDevice) {
    lock.lock()
    let isNew = seen[device.identifier] == nil
    seen[device.identifier] = device
    lock.unlock()
    if isNew && device.isMarshallCandidate {
      print("[scan] Marshall candidate: \(device.name ?? "(no name)") \(device.identifier)")
    }
  }

  func scanner(_ scanner: MarshallScanner, didUpdate update: DeviceUpdate) {
    var parts = [update.isConnected ? "connected" : "disconnected"]
    if let battery = update.batteryPercent { parts.append("battery \(battery)%") }
    if let info = update.deviceInfo { parts.append("info \(info)") }
    if let control = update.controlState { parts.append("control \(control)") }
    print("[update] \(parts.joined(separator: ", "))")
  }

  func scanner(_ scanner: MarshallScanner, didFail identifier: String, message: String) {
    print("[fail] \(message)")
  }

  func scanner(_ scanner: MarshallScanner, didMapGatt identifier: String, services: [GattService]) {
    print("[gatt] \(services.count) services")
    for service in services {
      print("   service \(service.uuid)")
      for characteristic in service.characteristics {
        print("     char \(characteristic.uuid)  [\(characteristic.properties.joined(separator: ", "))]")
      }
    }
  }

  func scanner(
    _ scanner: MarshallScanner, didReadRaw identifier: String, service: String,
    characteristic: String, value: Data
  ) {
    let hex = value.map { String(format: "%02X", $0) }.joined(separator: " ")
    let text = String(data: value, encoding: .utf8).map { " \"\($0)\"" } ?? ""
    let elapsed = String(format: "%5.1f", Date().timeIntervalSince(started))
    print("[raw +\(elapsed)s] \(service) \(characteristic): \(hex)\(text)")
  }
}

func option(_ name: String) -> String? {
  let arguments = CommandLine.arguments
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else {
    return nil
  }
  return arguments[index + 1]
}

let scanSeconds = option("--scan").flatMap(Double.init) ?? 8
let listenSeconds = option("--listen").flatMap(Double.init) ?? 10
let target = option("--target")?.uppercased()
let volume = option("--volume").flatMap(Int.init)
let eq = option("--eq").map { $0.split(separator: ",").compactMap { Int($0) } }.flatMap {
  $0.count == 2 ? (bass: $0[0], treble: $0[1]) : nil
}
// `--write UUID=HEX`, e.g. `--write 00000007-1337-1DEA-FEED-C0FFEE70C0DE=0A`.
let rawWrite: (uuid: String, value: Data)? = option("--write").flatMap { spec in
  let parts = spec.split(separator: "=", maxSplits: 1).map(String.init)
  guard parts.count == 2, parts[1].count.isMultiple(of: 2) else { return nil }
  let hex = Array(parts[1])
  let bytes = stride(from: 0, to: hex.count, by: 2).compactMap {
    UInt8(String(hex[$0...$0 + 1]), radix: 16)
  }
  return bytes.count * 2 == hex.count ? (parts[0], Data(bytes)) : nil
}

let recorder = Recorder()
let scanner = MarshallScanner()
scanner.delegate = recorder
scanner.reportsUnknownCharacteristics = CommandLine.arguments.contains("--raw")
print("== raw characteristic reporting: \(scanner.reportsUnknownCharacteristics ? "on" : "off")")

print("== 1. scan (\(Int(scanSeconds))s)")
scanner.startScan()
Thread.sleep(forTimeInterval: scanSeconds)
scanner.stopScan()

let devices = recorder.devices.sorted { $0.rssi > $1.rssi }
print("   \(devices.count) advertisers, \(devices.filter(\.isMarshallCandidate).count) Marshall candidates")
for device in devices.prefix(25) {
  let services = device.advertisedServices.isEmpty ? "" : " services \(device.advertisedServices)"
  print(
    "   \(device.isMarshallCandidate ? "*" : " ") \(String(device.rssi).padding(toLength: 4, withPad: " ", startingAt: 0))"
      + " \(device.name ?? "(no name)")  \(device.identifier)\(services)")
}

let chosen = devices.first { device in
  guard let target else { return device.isMarshallCandidate }
  return (device.name?.uppercased().contains(target) ?? false)
    || device.identifier.uppercased().hasPrefix(target)
}
guard let chosen else {
  print("== no target: no Marshall candidate advertised. Turn the speaker on or put it in pairing mode,")
  print("   or pick a row above with --target <name or identifier prefix>.")
  exit(1)
}

print("== 2. connect \(chosen.name ?? "(no name)") \(chosen.identifier) (listening \(Int(listenSeconds))s)")
scanner.connect(identifier: chosen.identifier)
Thread.sleep(forTimeInterval: listenSeconds)

if let volume {
  print("== 3. setVolume \(volume)")
  scanner.setVolume(identifier: chosen.identifier, level: volume)
  Thread.sleep(forTimeInterval: 4)
}

if let eq {
  print("== 3. setEQ bass \(eq.bass) treble \(eq.treble)")
  scanner.setEQ(identifier: chosen.identifier, bass: eq.bass, treble: eq.treble)
  Thread.sleep(forTimeInterval: 4)
}

if let rawWrite {
  let hex = rawWrite.value.map { String(format: "%02X", $0) }.joined(separator: " ")
  print("== 3. write \(rawWrite.uuid) = \(hex)")
  scanner.writeRaw(identifier: chosen.identifier, characteristic: rawWrite.uuid, value: rawWrite.value)
  Thread.sleep(forTimeInterval: 5)
}

print("== done, disconnecting")
scanner.disconnect(identifier: chosen.identifier)
Thread.sleep(forTimeInterval: 1)
