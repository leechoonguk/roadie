import Foundation
import React

/// React Native adapter over `WidgetPublisher`. No logic here.
@objc(WidgetBridge)
final class WidgetBridgeModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(publish:resolver:rejecter:)
  func publish(
    _ payload: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let snapshot = try WidgetPublisher.snapshot(
        from: payload as? [String: Any] ?? [:], now: Date())
      try WidgetPublisher.publish(snapshot)
      resolve(nil)
    } catch WidgetPublishError.invalidPayload(let field) {
      reject("invalid_payload", "Invalid widget payload field: \(field)", nil)
    } catch WidgetPublishError.appGroupUnavailable {
      reject("app_group_unavailable", "App Group container is not available", nil)
    } catch {
      reject("publish_failed", error.localizedDescription, error)
    }
  }
}
