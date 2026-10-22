// The project's resolveRequest replaces the CLI's, which is the one that maps
// `react-native` to `react-native-macos` on macOS. Dropping it bundled core
// React Native into the Mac app, and it died at launch on `Platform.select`.

type Resolve = (context: { originModulePath: string; resolveRequest: Resolve }, name: string, platform: string) => unknown;

const mockFrameworkResolve = jest.fn((_context: unknown, name: string, platform: string) => ({ via: 'framework', name, platform }));

jest.mock('@react-native/metro-config', () => ({
  getDefaultConfig: () => ({ resolver: { resolveRequest: mockFrameworkResolve } }),
  mergeConfig: (base: { resolver: object }, extra: { resolver: object }) => ({
    ...base,
    resolver: { ...base.resolver, ...extra.resolver },
  }),
}));

const { resolver } = require('../metro.config') as { resolver: { resolveRequest: Resolve } };

const context = (origin: string) => ({
  originModulePath: origin,
  resolveRequest: jest.fn(() => ({ via: 'metro' })) as unknown as Resolve,
});

beforeEach(() => mockFrameworkResolve.mockClear());

test('macOS requests still go through the CLI resolver that maps react-native to react-native-macos', () => {
  expect(resolver.resolveRequest(context('/app/App.tsx'), 'react-native', 'macos')).toEqual({
    via: 'framework',
    name: 'react-native',
    platform: 'macos',
  });
});

test('an Android import of a native wrapper resolves to its mobile file, and nothing else is swapped', () => {
  const swapped = resolver.resolveRequest(context('/app/src/screens/DeviceScreen.tsx'), '../native/appUpdates', 'android');
  expect(swapped).toEqual({ type: 'sourceFile', filePath: expect.stringMatching(/mobile\/src\/appUpdates\.ts$/) });
  expect(mockFrameworkResolve).not.toHaveBeenCalled();

  // A library's own file of the same name is the library's.
  resolver.resolveRequest(context('/app/node_modules/lib/index.js'), './native/appUpdates', 'android');
  expect(mockFrameworkResolve).toHaveBeenCalledTimes(1);
});
