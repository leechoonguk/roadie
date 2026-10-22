/**
 * Work the app registers at launch, before any screen. macOS and iOS have
 * none: their widget is WidgetKit, in Swift. Android swaps in its widget's
 * task handler (`mobile/src/widget.tsx`, via `metro.config.js`).
 */
export function registerBackgroundTasks(): void {}
