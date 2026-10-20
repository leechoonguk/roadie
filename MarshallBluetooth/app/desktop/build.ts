/**
 * Bundles the desktop app into `out/`: the main process, the preload script,
 * and the window — which is `app/App.tsx` itself, with `react-native` resolved
 * to react-native-web and the three platform files (the two native wrappers
 * and the AppKit theme) swapped for their `src/renderer/` counterparts.
 *
 * Run with `make desktop-build`; node strips the types, so no compile step.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const modules = join(here, 'node_modules');
const icons = join(here, '..', 'macos', 'MarshallBluetooth-macOS', 'Assets.xcassets', 'AppIcon.appiconset');
const shared = join(here, '..', 'src');
const production = process.env.NODE_ENV !== 'development';

/** Imports from the shared code (`app/src`) that resolve to a desktop file instead. */
const SWAPS: Array<[RegExp, string]> = [
  [/\/native\/marshallBle$/, join(here, 'src', 'renderer', 'marshallBle.ts')],
  [/\/native\/widgetBridge$/, join(here, 'src', 'renderer', 'widgetBridge.ts')],
  [/^\.\.?\/(?:\.\.\/)?theme$/, join(here, 'src', 'renderer', 'theme.ts')],
];

/**
 * One React for the whole bundle: the shared screens sit under `app/`, whose
 * own `node_modules` holds the React Native copy, and two Reacts in one tree
 * break every hook.
 */
const desktopResolution: esbuild.Plugin = {
  name: 'desktop-resolution',
  setup(build) {
    build.onResolve({ filter: /^react-native$/ }, () => ({
      path: join(modules, 'react-native-web', 'dist', 'index.js'),
    }));
    build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, async args => {
      if (args.pluginData === 'desktop') {
        return undefined;
      }
      return build.resolve(args.path, { kind: args.kind, resolveDir: here, pluginData: 'desktop' });
    });
    for (const [filter, path] of SWAPS) {
      build.onResolve({ filter }, args => (args.importer.startsWith(shared) ? { path } : undefined));
    }
  },
};

mkdirSync(out, { recursive: true });

await Promise.all([
  esbuild.build({
    entryPoints: [join(here, 'src', 'main.ts')],
    outfile: join(out, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    minify: production,
  }),
  esbuild.build({
    entryPoints: [join(here, 'src', 'preload.ts')],
    outfile: join(out, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    minify: production,
  }),
  esbuild.build({
    entryPoints: [join(here, 'src', 'renderer', 'index.tsx')],
    outfile: join(out, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    // React Native ships JSX in .js files.
    loader: { '.js': 'jsx' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
      __DEV__: String(!production),
    },
    plugins: [desktopResolution],
    minify: production,
  }),
]);

copyFileSync(join(here, 'src', 'renderer', 'index.html'), join(out, 'index.html'));
copyFileSync(join(icons, 'icon_512@2x.png'), join(out, 'icon.png'));
copyFileSync(join(icons, 'icon_32.png'), join(out, 'tray.png'));
console.log(`desktop bundle written to ${out}`);
