import { androidApkUrl, isNewer, parseVersion, versionFromReleaseUrl } from '../src/updates';

test('versions order by number, not by text', () => {
  expect(isNewer('0.10.0', '0.9.9')).toBe(true);
  expect(isNewer('1.0.0', '0.99.99')).toBe(true);
  expect(isNewer('0.2.0', '0.2.0')).toBe(false);
  expect(isNewer('0.1.9', '0.2.0')).toBe(false);
});

test('development and CI builds never update, and are never offered', () => {
  expect(parseVersion('0.0.0')).toBeNull();
  expect(parseVersion('0.0.0-ci.42')).toBeNull();
  expect(isNewer('0.3.0', '0.0.0')).toBe(false);
  expect(isNewer('0.3.0', '0.0.0-ci.42')).toBe(false);
  expect(isNewer('0.3.0-ci.1', '0.2.0')).toBe(false);
});

test('the latest release is read from the redirect, and only from a release page', () => {
  expect(versionFromReleaseUrl('https://github.com/leechoonguk/roadie/releases/tag/v0.2.0')).toBe('0.2.0');
  // No release yet: `releases/latest` stays on the release list.
  expect(versionFromReleaseUrl('https://github.com/leechoonguk/roadie/releases')).toBeNull();
  expect(versionFromReleaseUrl('https://github.com/leechoonguk/roadie/releases/tag/nightly')).toBeNull();
});

test('the APK is the file native.yml attaches to that version', () => {
  expect(androidApkUrl('0.2.0')).toBe(
    'https://github.com/leechoonguk/roadie/releases/download/v0.2.0/Roadie-0.2.0-android.apk',
  );
});
