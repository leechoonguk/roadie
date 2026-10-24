module.exports = {
  root: true,
  extends: '@react-native',
  // The desktop app's bundles and packaged builds, and the native build output
  // (DerivedData holds generated and vendored JS), not its sources.
  ignorePatterns: ['desktop/out/', 'desktop/release/', 'macos/build/**'],
};
