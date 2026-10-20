/**
 * `app/src/theme.ts` for Windows and Linux. `PlatformColor` names AppKit
 * colours, which a browser has none of; these CSS variables, defined in
 * `index.html`, follow the system light/dark setting instead.
 */
export const colors = {
  label: 'var(--label)',
  secondaryLabel: 'var(--secondary-label)',
  tertiaryLabel: 'var(--tertiary-label)',
  track: 'var(--track)',
  accent: 'var(--accent)',
  separator: 'var(--separator)',
  window: 'var(--window)',
  sidebar: 'var(--sidebar)',
  card: 'var(--card)',
  selection: 'var(--selection)',
  selectedText: 'var(--selected-text)',
  error: 'var(--error)',
  connected: 'var(--connected)',
};

/** One spacing scale for every margin and gap, so the layout keeps a rhythm. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
