/**
 * Android-only libraries stay out of the Apple builds: macOS and iOS run the
 * Swift Bluetooth core and the WidgetKit widget, so neither pod would be used
 * there. react-native-macos autolinks a dependency's `macos` entry, or else
 * its `ios` one, so both are switched off.
 */
const ANDROID_ONLY = { platforms: { ios: null, macos: null } };

module.exports = {
  dependencies: {
    'react-native-ble-plx': ANDROID_ONLY,
    '@react-native-async-storage/async-storage': ANDROID_ONLY,
  },
};
