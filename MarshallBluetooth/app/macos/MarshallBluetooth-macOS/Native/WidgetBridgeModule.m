#import <React/RCTBridgeModule.h>

// Exposes the Swift `WidgetBridge` class (WidgetBridgeModule.swift) to React Native.
@interface RCT_EXTERN_MODULE(WidgetBridge, NSObject)

RCT_EXTERN_METHOD(publish:(NSDictionary *)payload
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
