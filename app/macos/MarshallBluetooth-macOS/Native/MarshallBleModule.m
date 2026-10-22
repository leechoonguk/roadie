#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift `MarshallBle` class (MarshallBleModule.swift) to React Native.
@interface RCT_EXTERN_MODULE(MarshallBle, RCTEventEmitter)

RCT_EXTERN_METHOD(startScan)
RCT_EXTERN_METHOD(stopScan)
RCT_EXTERN_METHOD(connect:(NSString *)identifier)
RCT_EXTERN_METHOD(disconnect:(NSString *)identifier)
RCT_EXTERN_METHOD(setEQ:(NSString *)identifier bass:(nonnull NSNumber *)bass treble:(nonnull NSNumber *)treble)
RCT_EXTERN_METHOD(setVolume:(NSString *)identifier level:(nonnull NSNumber *)level)

@end
