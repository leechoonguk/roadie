const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * On iOS and Android the shared screens' platform files resolve to `mobile/src/`:
 * the macOS native modules and AppKit colours do not exist there. macOS
 * resolves them as written. The desktop bundle makes the same three swaps
 * (`desktop/build.ts`).
 */
const SHARED = path.join(__dirname, 'src');
const MOBILE = path.join(__dirname, 'mobile', 'src');
const MOBILE_SWAPS = [
  [/\/native\/marshallBle$/, path.join(MOBILE, 'marshallBle.ts')],
  [/\/native\/widgetBridge$/, path.join(MOBILE, 'widgetBridge.ts')],
  [/^\.\.?\/(?:\.\.\/)?theme$/, path.join(MOBILE, 'theme.ts')],
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
      if ((platform === 'ios' || platform === 'android') && context.originModulePath.startsWith(SHARED)) {
        const swap = MOBILE_SWAPS.find(([pattern]) => pattern.test(moduleName));
        if (swap !== undefined) {
          return { type: 'sourceFile', filePath: swap[1] };
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
