import { findUpdate, updateInfo } from '../mobile/src/appUpdates';

let mockVersion = '0.2.0';
jest.mock('react-native-device-info', () => ({ getVersion: () => mockVersion }));

/** GitHub as the check sees it: where `releases/latest` lands, and which APKs exist. */
function github(latestTag: string | null, apks: string[]): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/releases/latest')) {
      const landing = latestTag === null ? 'https://github.com/leechoonguk/roadie/releases' : `https://github.com/leechoonguk/roadie/releases/tag/${latestTag}`;
      return { ok: true, url: landing };
    }
    return { ok: apks.some(name => url.endsWith(name)), url };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  mockVersion = '0.2.0';
});

test('a newer release with its APK attached is offered for download', async () => {
  github('v0.3.0', ['Roadie-0.3.0-android.apk']);
  await expect(findUpdate()).resolves.toEqual({
    kind: 'available',
    version: '0.3.0',
    apk: 'https://github.com/leechoonguk/roadie/releases/download/v0.3.0/Roadie-0.3.0-android.apk',
  });
});

test('a newer release whose APK CI has not attached yet is not offered', async () => {
  github('v0.3.0', []);
  await expect(findUpdate()).resolves.toEqual({ kind: 'building', version: '0.3.0' });
});

test('the same or an older release means up to date, without asking for an APK', async () => {
  const fetchMock = github('v0.2.0', ['Roadie-0.2.0-android.apk']);
  await expect(findUpdate()).resolves.toEqual({ kind: 'current', version: '0.2.0' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a GitHub page that is not a release is an error, not "up to date"', async () => {
  github(null, []);
  await expect(findUpdate()).rejects.toThrow('did not lead to a release');
});

test('a development or CI build offers no check', async () => {
  mockVersion = '0.0.0-ci.17';
  await expect(updateInfo()).resolves.toEqual({ version: '0.0.0-ci.17', canCheck: false });
  mockVersion = '0.2.0';
  await expect(updateInfo()).resolves.toEqual({ version: '0.2.0', canCheck: true });
});
