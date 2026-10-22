/**
 * `app/src/native/widgetBridge.ts` for Windows and Linux. There is no desktop
 * widget there; the tray menu is its counterpart, and the main process owns it.
 */
import type { WidgetPayload } from '../../../src/native/widgetBridge';

export type { WidgetPayload } from '../../../src/native/widgetBridge';

export function publishToWidget(payload: WidgetPayload): Promise<void> {
  window.roadie.publish(payload);
  return Promise.resolve();
}
