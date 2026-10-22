/**
 * Bundles the desktop app into `out/`: the main process, the preload script,
 * and the window — which is `app/App.tsx` itself, with `react-native` resolved
 * to react-native-web (through `src/renderer/reactNative.ts`) and the two native
 * wrappers swapped for their `src/renderer/` counterparts.
 *
 * Run with `make desktop-build`; node strips the types, so no compile step.
 * `ROADIE_DEMO=1` bundles the in-memory speaker (`src/demo/`) in place of Web
 * Bluetooth, for `make demo` — the only build that ever contains it.
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
const demo = process.env.ROADIE_DEMO === '1';
const renderer = join(here, 'src', 'renderer');

/** Imports from the shared code (`app/src`) that resolve to a desktop file instead. */
const SWAPS: Array<[RegExp, string]> = [
  [/\/native\/marshallBle$/, join(here, 'src', 'renderer', 'marshallBle.ts')],
  [/\/native\/widgetBridge$/, join(here, 'src', 'renderer', 'widgetBridge.ts')],
  [/\/native\/appUpdates$/, join(here, 'src', 'renderer', 'appUpdates.ts')],
];
/** Web Bluetooth, and what `ROADIE_DEMO=1` bundles in its place: the in-memory speaker `make demo` records. */
const WEB_BLUETOOTH = join(renderer, 'marshallBle.ts');
const DEMO_BLUETOOTH = join(here, 'src', 'demo', 'marshallBle.ts');

/**
 * One React for the whole bundle: the shared screens sit under `app/`, whose
 * own `node_modules` holds the React Native copy, and two Reacts in one tree
 * break every hook.
 */
const desktopResolution: esbuild.Plugin = {
  name: 'desktop-resolution',
  setup(build) {
    // The shim re-exports react-native-web; its own import of it resolves normally.
    build.onResolve({ filter: /^react-native$/ }, () => ({ path: join(renderer, 'reactNative.ts') }));
    build.onResolve({ filter: /^react-native-web$/ }, () => ({
      path: join(modules, 'react-native-web', 'dist', 'index.js'),
    }));
    build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, async args => {
      if (args.pluginData === 'desktop') {
        return undefined;
      }
      return build.resolve(args.path, { kind: args.kind, resolveDir: here, pluginData: 'desktop' });
    });
    for (const [filter, path] of SWAPS) {
      build.onResolve({ filter }, args => (args.importer.startsWith(shared) ? { path: bundled(path) } : undefined));
    }
    // The window's own import of Web Bluetooth, which the tray's presses go through.
    build.onResolve({ filter: /^\.\/marshallBle$/ }, args =>
      demo && args.importer.startsWith(renderer) ? { path: DEMO_BLUETOOTH } : undefined,
    );
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
    entryPoints: [join(renderer, 'index.tsx')],
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

copyFileSync(join(renderer, 'index.html'), join(out, 'index.html'));
copyFileSync(join(icons, 'icon_512@2x.png'), join(out, 'icon.png'));
copyFileSync(join(icons, 'icon_32.png'), join(out, 'tray.png'));
console.log(`desktop bundle written to ${out}${demo ? ' (demo speaker)' : ''}`);

function bundled(path: string): string {
  return demo && path === WEB_BLUETOOTH ? DEMO_BLUETOOTH : path;
}
