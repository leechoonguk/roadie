/**
 * `src/native/widgetBridge.ts` for iOS and Android, which have no Roadie
 * widget yet: a phone suspends the app in the background, so the macOS
 * design — the app holds the connection and the widget asks it — does not
 * carry over. Publishing succeeds and goes nowhere.
 */
import type { WidgetPayload } from '../../src/native/widgetBridge';

export type { WidgetPayload } from '../../src/native/widgetBridge';

export function publishToWidget(_payload: WidgetPayload): Promise<void> {
  return Promise.resolve();
}
