import { Appearance, type ColorValue, Platform, PlatformColor } from 'react-native';

/** Every colour a screen or widget names. */
export type Palette = Record<
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
  `#${string}`
>;

/**
 * A fixed palette per scheme, for the platforms with no named system colours
 * React Native can reach — Android and the Windows/Linux window — and for the
 * Android widget, which draws with plain hex values.
 */
export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
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
  },
  dark: {
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
  },
};

/**
 * macOS semantic colours. They follow light/dark mode, Increase Contrast and
 * the user's accent colour on their own, which fixed hex values never do.
 */
const APPKIT = {
  label: PlatformColor('labelColor'),
  secondaryLabel: PlatformColor('secondaryLabelColor'),
  tertiaryLabel: PlatformColor('tertiaryLabelColor'),
  track: PlatformColor('quaternaryLabelColor'),
  accent: PlatformColor('controlAccentColor'),
  separator: PlatformColor('separatorColor'),
  window: PlatformColor('windowBackgroundColor'),
  sidebar: PlatformColor('underPageBackgroundColor'),
  card: PlatformColor('controlBackgroundColor'),
  selection: PlatformColor('selectedContentBackgroundColor'),
  selectedText: PlatformColor('alternateSelectedControlTextColor'),
  error: PlatformColor('systemRedColor'),
  connected: PlatformColor('systemGreenColor'),
};

/** UIKit's semantic colours: the same behaviour as AppKit's, under UIKit's names. */
const UIKIT = {
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

/** The fixed palettes follow the scheme the app starts in. */
export const colors = Platform.select<Record<keyof Palette, ColorValue>>({
  macos: APPKIT,
  ios: UIKIT,
  default: PALETTES[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'],
});

/** One spacing scale for every margin and gap, so the layout keeps a rhythm. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
