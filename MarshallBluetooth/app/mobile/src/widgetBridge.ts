/**
 * `src/native/widgetBridge.ts` for Android: the selected speaker goes to the
 * home screen widget (`widget.tsx`) instead of the App Group the Apple widgets
 * read. macOS and iOS share the Swift `WidgetBridge` module.
 */
import type { WidgetPayload } from '../../src/native/widgetBridge';
import { showOnWidget } from './widget';

export type { WidgetPayload } from '../../src/native/widgetBridge';

export function publishToWidget(payload: WidgetPayload): Promise<void> {
  return showOnWidget(payload);
}
