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
  [/\/native\/backgroundTasks$/, path.join(MOBILE, 'widget.tsx')],
];

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
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
