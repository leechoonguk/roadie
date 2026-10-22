import Foundation
import os

/// The decisions of one widget press, apart from Bluetooth so `make swift-test`
/// covers them: wait for the value the press moves, step from it, write the
/// change, wait for the speaker's read-back, finish.
///
/// It steps from what the speaker reports now, not from the snapshot the
/// button was drawn with — the knob may have moved since. The JavaScript client
/// does the same in `applyStep` (`app/src/ble/client.ts`).
struct OneShotPlan {
  enum Next: Equatable {
    case wait
    case write(ControlChange)
    case finish
  }

  let action: ControlAction
  /// Everything the speaker has reported during this press.
  private(set) var values = ControlState()
  private var written = false

  init(action: ControlAction) {
    self.action = action
  }

  mutating func receive(_ report: ControlState) -> Next {
    values = values.merging(report)
    guard action.isAnswered(by: report) else { return .wait }
    if written {
      return .finish
    }
    guard let change = action.change(from: values) else { return .finish }
    written = true
    return .write(change)
  }
}

enum OneShotError: Error, Equatable {
  case bluetooth(String)
  case disconnected
  case failed(String)
  case timedOut
}

/// One widget press where no resident app holds the speaker — iOS, where the
/// system wakes the app for the press: connect, step, read back, disconnect.
///
/// It runs its own `MarshallScanner`, beside the window's if the app is in
/// use: CoreBluetooth shares the one link between both, and this session's
/// disconnect leaves the window's connection standing.
final class OneShotSession: MarshallScannerDelegate, @unchecked Sendable {
  private static let log = Logger(subsystem: "com.uk.marshallbluetooth", category: "one-shot")

  private let identifier: String
  private let scanner = MarshallScanner()
  /// Touched only on the scanner's queue, where every delegate call arrives.
  private var plan: OneShotPlan
  private var connecting = false
  /// Taken once, by whichever comes first: the plan finishing, a failure, or cancellation.
  private let lock = NSLock()
  private var continuation: CheckedContinuation<ControlState, Error>?

  private init(identifier: String, action: ControlAction) {
    self.identifier = identifier
    plan = OneShotPlan(action: action)
  }

  /// Applies `action` to the speaker `identifier` names; resolves with what it stored.
  static func apply(
    _ action: ControlAction, to identifier: String, timeout: Duration = .seconds(12)
  ) async throws -> ControlState {
    let session = OneShotSession(identifier: identifier, action: action)
    return try await withThrowingTaskGroup(of: ControlState.self) { group in
      group.addTask { try await session.run() }
      group.addTask {
        try await Task.sleep(for: timeout)
        throw OneShotError.timedOut
      }
      defer { group.cancelAll() }
      guard let stored = try await group.next() else { throw OneShotError.timedOut }
      return stored
    }
  }

  private func run() async throws -> ControlState {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        lock.withLock { self.continuation = continuation }
        scanner.delegate = self
        scanner.powerUp()
      }
    } onCancel: {
      finish(.failure(CancellationError()))
    }
  }

  private func finish(_ result: Result<ControlState, Error>) {
    let continuation = lock.withLock {
      defer { self.continuation = nil }
      return self.continuation
    }
    guard let continuation else { return }
    scanner.disconnect(identifier: identifier)
    if case .failure(let error) = result {
      Self.log.error("press on \(self.identifier, privacy: .public) failed: \(String(describing: error), privacy: .public)")
    }
    continuation.resume(with: result)
  }

  // MARK: - MarshallScannerDelegate

  func scanner(_ scanner: MarshallScanner, didChangeState state: String) {
    switch state {
    case "poweredOn" where !connecting:
      connecting = true
      scanner.connect(identifier: identifier)
    case "poweredOff", "unauthorized", "unsupported":
      finish(.failure(OneShotError.bluetooth(state)))
    default:
      break
    }
  }

  func scanner(_ scanner: MarshallScanner, didDiscover device: DiscoveredDevice) {}

  func scanner(_ scanner: MarshallScanner, didUpdate update: DeviceUpdate) {
    guard update.identifier == identifier else { return }
    guard update.isConnected else {
      finish(.failure(OneShotError.disconnected))
      return
    }
    guard let report = update.controlState else { return }
    switch plan.receive(report) {
    case .wait:
      break
    case .write(.volume(let level)):
      scanner.setVolume(identifier: identifier, level: level)
    case .write(.eq(let bass, let treble)):
      scanner.setEQ(identifier: identifier, bass: bass, treble: treble)
    case .finish:
      finish(.success(plan.values))
    }
  }

  func scanner(_ scanner: MarshallScanner, didFail identifier: String, message: String) {
    finish(.failure(OneShotError.failed(message)))
  }
}
