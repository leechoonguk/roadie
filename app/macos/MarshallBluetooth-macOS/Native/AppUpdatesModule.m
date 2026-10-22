#import <React/RCTBridgeModule.h>

// Exposes the Swift `AppUpdates` class (AppUpdatesModule.swift) to React Native.
@interface RCT_EXTERN_MODULE(AppUpdates, NSObject)

RCT_EXTERN_METHOD(info:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(check)

@end
