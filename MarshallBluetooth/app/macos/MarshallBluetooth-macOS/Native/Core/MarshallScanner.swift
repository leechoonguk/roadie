import CoreBluetooth
import Foundation

protocol MarshallScannerDelegate: AnyObject {
  func scanner(_ scanner: MarshallScanner, didChangeState state: String)
  func scanner(_ scanner: MarshallScanner, didDiscover device: DiscoveredDevice)
  func scanner(_ scanner: MarshallScanner, didUpdate update: DeviceUpdate)
  func scanner(_ scanner: MarshallScanner, didFail identifier: String, message: String)
  func scanner(_ scanner: MarshallScanner, didMapGatt identifier: String, services: [GattService])
  func scanner(
    _ scanner: MarshallScanner, didReadRaw identifier: String, service: String,
    characteristic: String, value: Data
  )
}

extension MarshallScannerDelegate {
  /// Optional: the map is a diagnostic — the probe prints it, the app has no use for it yet.
  func scanner(_ scanner: MarshallScanner, didMapGatt identifier: String, services: [GattService]) {}

  /// Optional: raw values of undecoded characteristics, sent only while
  /// `reportsUnknownCharacteristics` is on.
  func scanner(
    _ scanner: MarshallScanner, didReadRaw identifier: String, service: String,
    characteristic: String, value: Data
  ) {}
}

/// CoreBluetooth central for Marshall speakers, free of React so `make swift-check` covers it.
///
/// Services used after connecting:
/// - `0x180A` Device Information — model, firmware, serial
/// - `0x180F` Battery — level, on models that have one
/// - `0xFCCD` Marshall control — volume and EQ characteristics, mapped on an
///   ACTON III with `make ble-probe` (see `EQSettings`, `VolumeLevel`)
///
/// Every CoreBluetooth call and every piece of state below is confined to `queue`.
final class MarshallScanner: NSObject {
  static let deviceInfoService = CBUUID(string: "180A")
  static let batteryService = CBUUID(string: "180F")
  static let controlService = CBUUID(string: "FCCD")

  static let modelNumber = CBUUID(string: "2A24")
  static let serialNumber = CBUUID(string: "2A25")
  static let firmwareVersion = CBUUID(string: "2A26")
  static let batteryLevel = CBUUID(string: "2A19")
  static let volume = CBUUID(string: "00000007-1337-1DEA-FEED-C0FFEE70C0DE")
  static let maxVolume = CBUUID(string: "00000008-1337-1DEA-FEED-C0FFEE70C0DE")
  static let equalizer = CBUUID(string: "0000000F-1337-1DEA-FEED-C0FFEE70C0DE")

  /// Advertised-name fragments of Marshall products named in the analysed app.
  static let productNameTokens = [
    "MARSHALL", "ACTON", "STANMORE", "WOBURN", "EMBERTON", "MIDDLETON", "WILLEN",
    "OZZY", "TYLER", "GAHAN", "PLANT", "IGGY", "WEMBLEY", "SMITH", "NINA", "WATERS", "LYKK",
  ]

  weak var delegate: MarshallScannerDelegate?

  private let queue = DispatchQueue(label: "marshall.ble.central")
  private lazy var central = CBCentralManager(delegate: self, queue: queue)
  private var peripherals: [UUID: CBPeripheral] = [:]
  /// The control characteristics and last-read values of each connected device.
  private var controls: [UUID: Controls] = [:]
  /// Peripherals whose GATT map has been reported this connection.
  private var mappedPeripherals: Set<UUID> = []
  private var wantsScan = false
  /// Read and subscribe to every characteristic of services the scanner has no
  /// decoder for, and report their raw values. Off in the app; the probe turns it
  /// on to learn which characteristic carries which setting. Set before `connect`.
  var reportsUnknownCharacteristics = false

  private struct Controls {
    var volume: CBCharacteristic?
    var equalizer: CBCharacteristic?
    var maxVolume: Int?
    /// The last EQ read or notified; an EQ write keeps its middle bytes.
    var eq: EQSettings?
  }

  static func isMarshallCandidate(name: String?, services: [CBUUID]) -> Bool {
    if services.contains(controlService) {
      return true
    }
    guard let upper = name?.uppercased() else {
      return false
    }
    return productNameTokens.contains { upper.contains($0) }
  }

  // MARK: - Public API

  func startScan() {
    queue.async {
      self.wantsScan = true
      // A fresh scan forgets devices that stopped advertising; connected ones stay addressable.
      self.peripherals = self.peripherals.filter { $0.value.state != .disconnected }
      if self.central.state == .poweredOn {
        self.central.scanForPeripherals(withServices: nil, options: nil)
      }
    }
  }

  func stopScan() {
    queue.async {
      self.wantsScan = false
      if self.central.state == .poweredOn {
        self.central.stopScan()
      }
    }
  }

  func connect(identifier: String) {
    queue.async {
      guard let peripheral = self.peripheral(identifier) else {
        self.delegate?.scanner(self, didFail: identifier, message: "Unknown device")
        return
      }
      self.central.connect(peripheral, options: nil)
    }
  }

  func disconnect(identifier: String) {
    queue.async {
      guard let peripheral = self.peripheral(identifier) else { return }
      self.central.cancelPeripheralConnection(peripheral)
    }
  }

  /// Sets bass and treble (steps 0–10). Needs the EQ read first: the write
  /// carries back the three bytes this app does not interpret.
  func setEQ(identifier: String, bass: Int, treble: Int) {
    queue.async {
      guard let (peripheral, controls) = self.connectedControls(identifier) else { return }
      guard let characteristic = controls.equalizer, let current = controls.eq else {
        self.delegate?.scanner(
          self, didFail: identifier, message: "EQ is not available on this device yet")
        return
      }
      peripheral.writeValue(
        current.with(bass: bass, treble: treble).data, for: characteristic, type: .withResponse)
    }
  }

  func setVolume(identifier: String, level: Int) {
    queue.async {
      guard let (peripheral, controls) = self.connectedControls(identifier) else { return }
      guard let characteristic = controls.volume else {
        self.delegate?.scanner(
          self, didFail: identifier, message: "Volume is not available on this device")
        return
      }
      peripheral.writeValue(
        VolumeLevel.encode(level, maximum: controls.maxVolume), for: characteristic,
        type: .withResponse)
    }
  }

  /// Writes bytes to any characteristic of a connected device — the diagnostic
  /// counterpart of `reportsUnknownCharacteristics`, for confirming what a
  /// characteristic controls before a typed command is built on it.
  func writeRaw(identifier: String, characteristic uuid: String, value: Data) {
    queue.async {
      guard let peripheral = self.peripheral(identifier), peripheral.state == .connected else {
        self.delegate?.scanner(self, didFail: identifier, message: "Device is not connected")
        return
      }
      let target = CBUUID(string: uuid)
      let characteristic = (peripheral.services ?? [])
        .flatMap { $0.characteristics ?? [] }
        .first { $0.uuid == target }
      guard let characteristic else {
        self.delegate?.scanner(self, didFail: identifier, message: "No characteristic \(uuid)")
        return
      }
      let type: CBCharacteristicWriteType =
        characteristic.properties.contains(.write) ? .withResponse : .withoutResponse
      peripheral.writeValue(value, for: characteristic, type: type)
    }
  }

  // MARK: - Private

  private func peripheral(_ identifier: String) -> CBPeripheral? {
    UUID(uuidString: identifier).flatMap { peripherals[$0] }
  }

  /// The connected peripheral and its controls, or a reported failure. Runs on `queue`.
  private func connectedControls(_ identifier: String) -> (CBPeripheral, Controls)? {
    guard let peripheral = peripheral(identifier), peripheral.state == .connected else {
      delegate?.scanner(self, didFail: identifier, message: "Device is not connected")
      return nil
    }
    return (peripheral, controls[peripheral.identifier] ?? Controls())
  }

  private func report(_ update: DeviceUpdate) {
    delegate?.scanner(self, didUpdate: update)
  }

  private static func describe(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "poweredOn"
    case .poweredOff: return "poweredOff"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
  }

  private static func describe(_ properties: CBCharacteristicProperties) -> [String] {
    let names: [(CBCharacteristicProperties, String)] = [
      (.read, "read"), (.write, "write"), (.writeWithoutResponse, "writeWithoutResponse"),
      (.notify, "notify"), (.indicate, "indicate"),
    ]
    return names.filter { properties.contains($0.0) }.map(\.1)
  }
}

// MARK: - CBCentralManagerDelegate

extension MarshallScanner: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    delegate?.scanner(self, didChangeState: Self.describe(central.state))
    if central.state == .poweredOn && wantsScan {
      central.scanForPeripherals(withServices: nil, options: nil)
    }
  }

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber
  ) {
    peripherals[peripheral.identifier] = peripheral
    let services =
      advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
    let name =
      advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name
    delegate?.scanner(
      self,
      didDiscover: DiscoveredDevice(
        identifier: peripheral.identifier.uuidString,
        name: name,
        rssi: RSSI.intValue,
        advertisedServices: services.map(\.uuidString),
        isMarshallCandidate: Self.isMarshallCandidate(name: name, services: services)
      ))
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.delegate = self
    report(DeviceUpdate(identifier: peripheral.identifier.uuidString, isConnected: true))
    // Every service, not just the known three: which one carries control on a
    // given model is not settled, and the map below is how it gets settled.
    peripheral.discoverServices(nil)
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?
  ) {
    delegate?.scanner(
      self, didFail: peripheral.identifier.uuidString,
      message: error?.localizedDescription ?? "Connection failed")
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?
  ) {
    controls.removeValue(forKey: peripheral.identifier)
    mappedPeripherals.remove(peripheral.identifier)
    report(DeviceUpdate(identifier: peripheral.identifier.uuidString, isConnected: false))
  }
}

// MARK: - CBPeripheralDelegate

extension MarshallScanner: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      delegate?.scanner(
        self, didFail: peripheral.identifier.uuidString, message: error.localizedDescription)
      return
    }
    for service in peripheral.services ?? [] {
      switch service.uuid {
      case Self.deviceInfoService:
        peripheral.discoverCharacteristics(
          [Self.modelNumber, Self.firmwareVersion, Self.serialNumber], for: service)
      case Self.batteryService:
        peripheral.discoverCharacteristics([Self.batteryLevel], for: service)
      default:
        peripheral.discoverCharacteristics(nil, for: service)
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?
  ) {
    guard error == nil, let characteristics = service.characteristics else { return }
    switch service.uuid {
    case Self.deviceInfoService:
      for characteristic in characteristics where characteristic.properties.contains(.read) {
        peripheral.readValue(for: characteristic)
      }
    case Self.batteryService:
      if let level = characteristics.first(where: { $0.uuid == Self.batteryLevel }) {
        peripheral.readValue(for: level)
        if level.properties.contains(.notify) {
          peripheral.setNotifyValue(true, for: level)
        }
      }
    case Self.controlService:
      var found = controls[peripheral.identifier] ?? Controls()
      for characteristic in characteristics {
        switch characteristic.uuid {
        case Self.volume: found.volume = characteristic
        case Self.equalizer: found.equalizer = characteristic
        case Self.maxVolume: break
        default:
          watchIfDiagnosing(peripheral, characteristic)
          continue
        }
        peripheral.readValue(for: characteristic)
        if characteristic.properties.contains(.notify) {
          peripheral.setNotifyValue(true, for: characteristic)
        }
      }
      controls[peripheral.identifier] = found
    default:
      for characteristic in characteristics {
        watchIfDiagnosing(peripheral, characteristic)
      }
    }
    reportGattMapWhenComplete(peripheral)
  }

  /// Reports the service map once, after the last service's characteristics arrive.
  private func reportGattMapWhenComplete(_ peripheral: CBPeripheral) {
    let services = peripheral.services ?? []
    guard !mappedPeripherals.contains(peripheral.identifier),
      services.allSatisfy({ $0.characteristics != nil })
    else { return }
    mappedPeripherals.insert(peripheral.identifier)
    let map = services.map { service in
      GattService(
        uuid: service.uuid.uuidString,
        characteristics: (service.characteristics ?? []).map {
          GattCharacteristic(uuid: $0.uuid.uuidString, properties: Self.describe($0.properties))
        })
    }
    delegate?.scanner(self, didMapGatt: peripheral.identifier.uuidString, services: map)
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard let error else {
      reportDiagnostic(peripheral, "subscribed \(characteristic.uuid.uuidString)")
      return
    }
    reportDiagnostic(peripheral, "subscribe \(characteristic.uuid.uuidString): \(error.localizedDescription)")
  }

  /// Failures the app tolerates silently but a diagnostic run needs to see.
  private func reportDiagnostic(_ peripheral: CBPeripheral, _ message: String) {
    guard reportsUnknownCharacteristics else { return }
    delegate?.scanner(self, didFail: peripheral.identifier.uuidString, message: message)
  }

  /// Reads and subscribes to a characteristic the app has no decoder for — diagnostic runs only.
  private func watchIfDiagnosing(_ peripheral: CBPeripheral, _ characteristic: CBCharacteristic) {
    guard reportsUnknownCharacteristics else { return }
    if characteristic.properties.contains(.read) {
      reportDiagnostic(peripheral, "read requested \(characteristic.uuid.uuidString)")
      peripheral.readValue(for: characteristic)
    }
    if characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) {
      peripheral.setNotifyValue(true, for: characteristic)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    if let error {
      reportDiagnostic(peripheral, "read \(characteristic.uuid.uuidString): \(error.localizedDescription)")
      return
    }
    let serviceUUID = characteristic.service?.uuid
    var update = DeviceUpdate(identifier: peripheral.identifier.uuidString, isConnected: true)
    switch (serviceUUID, characteristic.uuid) {
    case (Self.batteryService, Self.batteryLevel):
      guard let percent = GattValue.batteryPercent(from: characteristic.value) else { return }
      update.batteryPercent = percent
    case (Self.deviceInfoService, Self.modelNumber):
      update.deviceInfo = DeviceInfo(model: GattValue.string(from: characteristic.value))
    case (Self.deviceInfoService, Self.firmwareVersion):
      update.deviceInfo = DeviceInfo(firmwareVersion: GattValue.string(from: characteristic.value))
    case (Self.deviceInfoService, Self.serialNumber):
      update.deviceInfo = DeviceInfo(serialNumber: GattValue.string(from: characteristic.value))
    case (Self.controlService, Self.volume):
      guard let value = characteristic.value, let level = VolumeLevel.decode(value) else { return }
      update.controlState = ControlState(volume: level)
    case (Self.controlService, Self.maxVolume):
      guard let value = characteristic.value, let maximum = VolumeLevel.decode(value) else { return }
      controls[peripheral.identifier, default: Controls()].maxVolume = maximum
      update.controlState = ControlState(maxVolume: maximum)
    case (Self.controlService, Self.equalizer):
      guard let value = characteristic.value, let eq = EQSettings(value) else { return }
      controls[peripheral.identifier, default: Controls()].eq = eq
      update.controlState = ControlState(bass: eq.bass, treble: eq.treble)
    default:
      // Another service can reuse a DIS UUID (Fast Pair carries its own 2A26),
      // so known characteristics are matched by service as well as UUID.
      if reportsUnknownCharacteristics, let serviceUUID, let value = characteristic.value {
        delegate?.scanner(
          self, didReadRaw: peripheral.identifier.uuidString, service: serviceUUID.uuidString,
          characteristic: characteristic.uuid.uuidString, value: value)
      }
      return
    }
    report(update)
  }

  func peripheral(
    _ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    if let error {
      delegate?.scanner(
        self, didFail: peripheral.identifier.uuidString, message: error.localizedDescription)
      return
    }
    // The speaker notifies knob turns but not, as far as measured, its own
    // accepted writes; reading back reports the value it actually stored.
    if characteristic.uuid == Self.volume || characteristic.uuid == Self.equalizer {
      peripheral.readValue(for: characteristic)
    }
  }
}
