module.exports = {
  root: true,
  extends: '@react-native',
  // The desktop app's bundles and packaged builds, not its sources.
  ignorePatterns: ['desktop/out/', 'desktop/release/'],
};
