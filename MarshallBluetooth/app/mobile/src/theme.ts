/**
 * `src/theme.ts` for iOS and Android. The macOS theme names AppKit colours;
 * iOS has UIKit's own semantic colours, which follow light/dark mode and
 * Increase Contrast by themselves. Android has no portable named equivalents,
 * so it takes a fixed palette for the scheme the app starts in.
 */
import { Appearance, type ColorValue, Platform, PlatformColor } from 'react-native';

type Palette = Record<
  | 'label'
  | 'secondaryLabel'
  | 'tertiaryLabel'
  | 'track'
  | 'accent'
  | 'separator'
  | 'window'
  | 'sidebar'
  | 'card'
  | 'selection'
  | 'selectedText'
  | 'error'
  | 'connected',
  ColorValue
>;

const UIKIT: Palette = {
  label: PlatformColor('label'),
  secondaryLabel: PlatformColor('secondaryLabel'),
  tertiaryLabel: PlatformColor('tertiaryLabel'),
  track: PlatformColor('systemFill'),
  accent: PlatformColor('systemBlue'),
  separator: PlatformColor('separator'),
  window: PlatformColor('systemGroupedBackground'),
  sidebar: PlatformColor('secondarySystemGroupedBackground'),
  card: PlatformColor('secondarySystemGroupedBackground'),
  selection: PlatformColor('systemBlue'),
  selectedText: PlatformColor('white'),
  error: PlatformColor('systemRed'),
  connected: PlatformColor('systemGreen'),
};

const LIGHT: Palette = {
  label: '#1d1d1f',
  secondaryLabel: '#6e6e73',
  tertiaryLabel: '#aeaeb2',
  track: '#d1d1d6',
  accent: '#0a64d8',
  separator: '#d2d2d7',
  window: '#f5f5f7',
  sidebar: '#ececee',
  card: '#ffffff',
  selection: '#0a64d8',
  selectedText: '#ffffff',
  error: '#d70015',
  connected: '#248a3d',
};

const DARK: Palette = {
  label: '#f5f5f7',
  secondaryLabel: '#a1a1a6',
  tertiaryLabel: '#636366',
  track: '#48484a',
  accent: '#3b8cff',
  separator: '#3a3a3c',
  window: '#1c1c1e',
  sidebar: '#2c2c2e',
  card: '#2c2c2e',
  selection: '#3b8cff',
  selectedText: '#ffffff',
  error: '#ff453a',
  connected: '#30d158',
};

export const colors: Palette =
  Platform.OS === 'ios' ? UIKIT : Appearance.getColorScheme() === 'dark' ? DARK : LIGHT;

/** One spacing scale for every margin and gap, so the layout keeps a rhythm. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
