const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * On Android the platform files resolve to `mobile/src/`: the Swift modules
 * that macOS and iOS share do not exist there. Every other platform resolves
 * them as written. The desktop bundle makes the same kind of swap
 * (`desktop/build.ts`).
 */
const MOBILE = path.join(__dirname, 'mobile', 'src');
const ANDROID_SWAPS = [
  [/\/native\/marshallBle$/, path.join(MOBILE, 'marshallBle.ts')],
  [/\/native\/widgetBridge$/, path.join(MOBILE, 'widgetBridge.ts')],
  [/\/native\/appUpdates$/, path.join(MOBILE, 'appUpdates.ts')],
  [/\/native\/backgroundTasks$/, path.join(MOBILE, 'widget.tsx')],
];

/**
 * The CLI's own resolver comes in through the defaults: for macOS it maps
 * `react-native` to `react-native-macos`. A `resolveRequest` here replaces it
 * outright, so every request that is not an Android swap goes back through it —
 * without it the macOS bundle loads core React Native, whose `Platform` has no
 * macOS file, and the app dies at launch.
 */
const defaults = getDefaultConfig(__dirname);
const frameworkResolve = defaults.resolver.resolveRequest;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (platform === 'android' && !context.originModulePath.includes(`${path.sep}node_modules${path.sep}`)) {
        const swap = ANDROID_SWAPS.find(([pattern]) => pattern.test(moduleName));
        if (swap !== undefined) {
          return { type: 'sourceFile', filePath: swap[1] };
        }
      }
      return frameworkResolve
        ? frameworkResolve(context, moduleName, platform)
        : context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaults, config);
