/**
 * The IPC contract between the Electron main process and the window. Both
 * sides import these names, so a channel cannot be renamed on one side only.
 */
import type { WidgetPayload } from '../../src/native/widgetBridge';

export const CHANNELS = {
  /** Window → main: start a Web Bluetooth device request with a user gesture. */
  scan: 'roadie:scan',
  /** Main → window: the speakers the pending request has found so far. */
  devices: 'roadie:devices',
  /** Window → main: answer the pending request with this speaker. */
  select: 'roadie:select',
  /** Window → main: end the pending request without a speaker. */
  cancel: 'roadie:cancel',
  /** Window → main: the selected speaker, for the tray. */
  publish: 'roadie:publish',
  /** Main → window: a tray menu item asks for a change on the speaker. */
  control: 'roadie:control',
};

/** One entry of Electron's `select-bluetooth-device` list. */
export interface ChooserDevice {
  deviceId: string;
  deviceName: string;
}

/** A change the tray asks the window to make; values are absolute, not steps. */
export type ControlRequest =
  | { kind: 'volume'; identifier: string; level: number }
  | { kind: 'eq'; identifier: string; bass: number; treble: number };

/** What the preload script exposes as `window.roadie`. */
export interface RoadieBridge {
  scan(): void;
  select(deviceId: string): void;
  cancel(): void;
  publish(payload: WidgetPayload): void;
  onDevices(listener: (devices: ChooserDevice[]) => void): void;
  onControl(listener: (request: ControlRequest) => void): void;
}
