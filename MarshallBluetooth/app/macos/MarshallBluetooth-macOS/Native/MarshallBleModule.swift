import Foundation
import React

/// React Native adapter over `MarshallScanner`: methods in, events out. No logic here.
@objc(MarshallBle)
final class MarshallBleModule: RCTEventEmitter, MarshallScannerDelegate {
  private let scanner = MarshallScanner()
  /// Widget buttons reach the speaker through this relay, so it lives as long as the scanner.
  private var relay: ControlRequestRelay?

  override init() {
    super.init()
    scanner.delegate = self
    relay = ControlRequestRelay(scanner: scanner)
  }

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["stateChanged", "deviceDiscovered", "deviceUpdated", "deviceFailed"]
  }

  @objc func startScan() { scanner.startScan() }
  @objc func stopScan() { scanner.stopScan() }
  @objc(connect:) func connect(_ identifier: String) { scanner.connect(identifier: identifier) }
  @objc(disconnect:) func disconnect(_ identifier: String) {
    scanner.disconnect(identifier: identifier)
  }

  @objc(setEQ:bass:treble:) func setEQ(_ identifier: String, bass: NSNumber, treble: NSNumber) {
    scanner.setEQ(identifier: identifier, bass: bass.intValue, treble: treble.intValue)
  }

  @objc(setVolume:level:) func setVolume(_ identifier: String, level: NSNumber) {
    scanner.setVolume(identifier: identifier, level: level.intValue)
  }

  // RCTEventEmitter drops events while no JS listener is registered, so no
  // listener flag is kept here — one would be read on the BLE queue and
  // written on the bridge queue.
  func scanner(_ scanner: MarshallScanner, didChangeState state: String) {
    sendEvent(withName: "stateChanged", body: ["state": state])
  }

  func scanner(_ scanner: MarshallScanner, didDiscover device: DiscoveredDevice) {
    sendEvent(withName: "deviceDiscovered", body: device.eventBody)
  }

  func scanner(_ scanner: MarshallScanner, didUpdate update: DeviceUpdate) {
    sendEvent(withName: "deviceUpdated", body: update.eventBody)
  }

  func scanner(_ scanner: MarshallScanner, didFail identifier: String, message: String) {
    sendEvent(withName: "deviceFailed", body: ["identifier": identifier, "message": message])
  }
}
