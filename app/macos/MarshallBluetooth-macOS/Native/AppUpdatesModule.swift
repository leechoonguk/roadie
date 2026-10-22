import Foundation
import React

/// React Native adapter over `AppUpdates`. No logic here.
@objc(AppUpdates)
final class AppUpdatesModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(info:rejecter:)
  func info(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      resolve(["version": AppUpdates.version(), "canCheck": AppUpdates.isAvailable])
    }
  }

  @objc(check)
  func check() {
    DispatchQueue.main.async { AppUpdates.requestCheck() }
  }
}
