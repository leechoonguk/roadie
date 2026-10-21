/**
 * `src/native/appUpdates.ts` for Android. The APK on the GitHub release is the
 * update (`native.yml` attaches it): a check reads the version `releases/latest`
 * redirects to, and a newer one opens its APK, which Android downloads and
 * installs over this one — same signing key, higher versionCode (rule://release).
 * A development or CI build (`0.0.0`, `-ci.N`) offers no check.
 */
import { Alert, Linking } from 'react-native';
import DeviceInfo from 'react-native-device-info';

import type { UpdateInfo } from '../../src/native/appUpdates';
import { androidApkUrl, isNewer, parseVersion, RELEASES_URL, versionFromReleaseUrl } from '../../src/updates';

export type { UpdateInfo } from '../../src/native/appUpdates';

export function updateInfo(): Promise<UpdateInfo> {
  const version = DeviceInfo.getVersion();
  return Promise.resolve({ version, canCheck: parseVersion(version) !== null });
}

export function checkForUpdates(): void {
  findUpdate().then(showResult, (error: unknown) =>
    Alert.alert('Could not check for updates', error instanceof Error ? error.message : String(error)),
  );
}

type CheckResult =
  | { kind: 'current'; version: string }
  | { kind: 'building'; version: string }
  | { kind: 'available'; version: string; apk: string };

/** What GitHub says now: no newer release, a newer one whose APK is not attached yet, or one to install. */
export async function findUpdate(): Promise<CheckResult> {
  const current = DeviceInfo.getVersion();
  const latest = await fetch(`${RELEASES_URL}/latest`, { method: 'HEAD' });
  const version = versionFromReleaseUrl(latest.url);
  if (version === null) {
    throw new Error(`${RELEASES_URL}/latest did not lead to a release`);
  }
  if (!isNewer(version, current)) {
    return { kind: 'current', version: current };
  }
  // The Mac assets publish first; CI attaches the APK a few minutes later.
  const apk = androidApkUrl(version);
  const asset = await fetch(apk, { method: 'HEAD' });
  return asset.ok ? { kind: 'available', version, apk } : { kind: 'building', version };
}

function showResult(result: CheckResult): void {
  if (result.kind === 'current') {
    Alert.alert('Roadie is up to date', `You have Roadie ${result.version}, the newest version.`);
  } else if (result.kind === 'building') {
    Alert.alert(`Roadie ${result.version} is on its way`, 'Its Android installer is still being built. Try again in a few minutes.');
  } else {
    Alert.alert(`Roadie ${result.version} is available`, 'Download it, then open the file to install it over this version.', [
      { text: 'Later', style: 'cancel' },
      { text: 'Download', onPress: () => Linking.openURL(result.apk) },
    ]);
  }
}
