/**
 * Where releases live and how versions order, for the platforms that look for
 * an update themselves (Android; macOS uses Sparkle, Windows and Linux
 * electron-updater). The git tag `vMAJOR.MINOR.PATCH` is the version on every
 * platform (rule://release); development and CI builds carry `0.0.0` or a
 * `-ci.N` suffix and never update.
 */
export const RELEASE_REPO = 'leechoonguk/roadie';
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** `[major, minor, patch]` of a released version, or null for a development or CI build. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = RELEASE_VERSION.exec(version.replace(/^v/, ''));
  if (match === null || match.slice(1).every(part => part === '0')) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `candidate` is a release newer than `current`; false whenever either is not a release. */
export function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (next === null || now === null) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) {
      return next[index] > now[index];
    }
  }
  return false;
}

/**
 * The version `releases/latest` redirected to — `…/releases/tag/v1.2.3` — or
 * null when the URL is not a release page (no release yet, or a GitHub error page).
 */
export function versionFromReleaseUrl(url: string): string | null {
  const match = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(url);
  return match === null ? null : match[1];
}

/** The Android installer `native.yml` attaches to the release for `version`. */
export function androidApkUrl(version: string): string {
  return `${RELEASES_URL}/download/v${version}/Roadie-${version}-android.apk`;
}
