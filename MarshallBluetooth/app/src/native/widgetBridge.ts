import { NativeModules } from 'react-native';

/**
 * What `WidgetPublisher.snapshot(from:now:)` accepts; the native side stamps the
 * time. Numbers outside their scale are rejected natively as `invalid_payload`.
 */
export interface WidgetPayload {
  name: string;
  identifier: string;
  isConnected: boolean;
  model: string | null;
  /** 0–100, or null on a speaker without a battery. */
  batteryPercent: number | null;
  /** 0–`maxVolume`. */
  volume: number | null;
  maxVolume: number | null;
  /** EQ steps 0–10. */
  bass: number | null;
  treble: number | null;
}

interface WidgetBridgeNative {
  publish(payload: WidgetPayload): Promise<void>;
}

/** Stores the payload in the App Group and reloads the Marshall widget's timeline. */
export function publishToWidget(payload: WidgetPayload): Promise<void> {
  const module = NativeModules.WidgetBridge as WidgetBridgeNative | undefined;
  if (module === undefined) {
    return Promise.reject(new Error('WidgetBridge native module is not linked'));
  }
  return module.publish(payload);
}
