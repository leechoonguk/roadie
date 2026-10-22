/**
 * `react-native` for the desktop window: react-native-web, plus the one name
 * the shared code imports that it lacks. `src/theme.ts` builds its AppKit and
 * UIKit tables on every platform and picks the fixed palette on this one, so
 * `PlatformColor` is called but its result never drawn.
 */
export * from 'react-native-web';

export function PlatformColor(...names: string[]): string {
  return names[0] ?? '';
}
