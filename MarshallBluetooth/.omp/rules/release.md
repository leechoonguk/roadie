---
description: Releases and in-app updates on every platform — the git tag is the version; make dist builds and Sparkle-signs on this Mac, make release publishes to GitHub only when asked, CI attaches the Windows/Linux/Android installers and feeds; every updater reads the same repository
globs:
      - .omp/hooks/lib/app-release.ts
      - .omp/hooks/post/check-release.ts
      - .omp/hooks/pre/strict-release-route.ts
      - app/macos/Podfile
      - app/macos/MarshallBluetooth-macOS/Info.plist
      - app/macos/MarshallBluetooth-macOS/MarshallBluetooth.entitlements
      - app/macos/MarshallWidget/Info.plist
      - app/src/updates.ts
      - app/desktop/package.json
      - app/desktop/src/updates.ts
      - app/mobile/src/appUpdates.ts
alwaysApply: false
---

# Release

Every Roadie updates itself from GitHub Releases of `leechoonguk/roadie`, so
publishing a release *is* shipping an update — to every platform at once.

| Platform | Updater | Reads | Installs |
|---|---|---|---|
| macOS | Sparkle (`AppDelegate`, menu bar item, window button) | `releases/latest/download/appcast.xml` (`SUFeedURL`) | `Roadie-<version>-macos.dmg` — what a user opens and drags to Applications, and what Sparkle installs in place, EdDSA-verified |
| Windows | electron-updater (`app/desktop/src/updates.ts`, tray item, window button) | `latest.yml` of the latest release (`build.publish` → `app-update.yml`) | the NSIS setup, sha512-verified |
| Linux | electron-updater, as above | `latest-linux.yml` | the AppImage in place, or the `.deb` through `pkexec` |
| Android | `app/mobile/src/appUpdates.ts` (window button) | where `releases/latest` redirects (`app/src/updates.ts`) | opens the release's APK; Android installs it over the old one (same debug key, higher versionCode) |
| iOS | none — no release asset | — | rebuilt from Xcode by the maintainer |

Each checks shortly after launch (macOS daily via Sparkle, Windows and Linux
every 6 hours) or when asked, and asks before installing. Development and CI
builds (`0.0.0`, `0.0.0-ci.N`, a Debug Mac build) never check.

| Gate | Hook | Blocks |
|---|---|---|
| Consent | `strict-publish-consent.ts` | `make release` / `make unrelease` when the current user turn does not ask for a release (or asks and forbids it); `make release … DRY_RUN=1` is exempt |
| Route | `strict-release-route.ts` | raw `git tag` writes, pushing a version tag, `gh release create/delete/edit/upload/delete-asset` |
| Consistency | `check-release.ts` (in `make verify`) | a feed URL other than the one `app-release.ts` publishes, a malformed `SUPublicEDKey`, a sandboxed app without the installer service and its mach-lookup exceptions, a literal version in either Info.plist, no Sparkle pod, an installer workflow (`desktop.yml`, `native.yml`) that is missing, does not run on a published release, builds tag pushes, uploads unguarded, or uploads a name matching `Roadie-<v>-macos.dmg`, `appcast.xml` or `checksums.txt`; a desktop `build.publish`, a `desktop.yml` without `latest.yml`/`latest-linux.yml`, or an Android `RELEASE_REPO` naming another repository |

## Versions

- The version **is** the annotated git tag `vMAJOR.MINOR.PATCH`. No file stores it:
  both Info.plists read `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)`, the
  project's default is `0.0.0` (a development build), and `make dist v=x.y.z` sets
  both from the tag. Sparkle compares `CFBundleVersion`, so every release must be
  a higher version than the last.
- `bump=patch` — fixes; `bump=minor` — new behaviour; `bump=major` — a user must
  change something.
- Release notes are this project's commit subjects since the last tag (`docs:`,
  `test:` and `chore(harness):` are left out), so write subjects a user can read.

## Where a Release Is Built

On this Mac, never in CI. Both keys live in the login keychain here:

- the **Apple Development** identity of team `X575PLRF8N`, which signs the app
  (rule://app-macos-project); Sparkle installs an update only when its code
  signature matches the running app's team;
- the **Sparkle EdDSA private key**, keychain account `roadie`, whose public half
  is `SUPublicEDKey`. A release signed with any other key is refused by every
  installed copy, so `make dist` compares the two before building.

The private key exists nowhere else. Export it once and keep it offline
(`app/macos/Pods/Sparkle/bin/generate_keys --account roadie -x <file>`); on a new
Mac import it with `-f <file>`. Losing it strands every installed copy on its
current version.

## Releasing

1. Commit and push the work (`make commit`, `make push` — only when asked); the
   release refuses a dirty worktree or a HEAD that is not `origin/main`.
2. `make dist v=<next>` when the build itself is in doubt — it builds Release into
   `app/macos/build/dist`, checks the bundle (version, `main.jsbundle`, Sparkle
   framework, `codesign --verify --deep --strict`) and signs the archive, without
   publishing. Install it by hand to try it.
3. `make release bump=patch|minor|major DRY_RUN=1` — every preflight check, the
   next version and its notes; publishes nothing and needs no request.
4. `make release bump=…` — only when the user asks in the current turn. It runs
   `make verify`, rebuilds via `dist`, tags, pushes the tag, creates the GitHub
   release with `Roadie-<version>-macos.dmg`, `appcast.xml` and `checksums.txt`, and verifies
   both the attached assets and that the latest release's `appcast.xml` now
   names the new version (read through `gh`; it warns when the repository is
   not public, because installed copies download without logging in).
5. Publishing the release starts `.github/workflows/desktop.yml`, which builds
   the Windows and Linux app (`app/desktop`, `make desktop-dist`) on GitHub's
   runners and attaches `Roadie-<version>-windows-setup.exe` (+ its `.blockmap`),
   `…-linux-x86_64.AppImage`, `…-linux-amd64.deb` and the `latest.yml` /
   `latest-linux.yml` feeds to the same release a few minutes later, and
   `.github/workflows/native.yml` attaches `Roadie-<version>-android.apk`
   (`make android-apk`, signed with the template's public debug key). None of
   these carries an Apple key, so CI may build them; CI only adds assets and
   never touches the three above. Until they are attached, a Windows, Linux or
   Android check finds the release but nothing to install, and says so. iOS has
   no release asset: installing it needs the maintainer's Apple signing in Xcode.

## When It Fails

| Where | State | What to do |
|---|---|---|
| Preflight, build, signing | nothing published | fix what it names; run again |
| `gh release create` or the read-back | tag pushed, release missing or partial | `make unrelease v=vX.Y.Z`, fix, release again |
| After publishing | release public, installed copies updating | fix and release the next version; `make unrelease` only if the release harms users — `latest` falls back to the previous one |

Never move or reuse a published tag: Sparkle and users' caches key on the version.

## Never Do These

- Tag, push a tag, or create/edit/delete a GitHub release by hand — `make release` / `make unrelease`
- Publish a release the user did not ask for in the current turn
- Hard-code a version in an Info.plist or a target's build settings
- Regenerate the Sparkle key while a release is installed anywhere — export and import the existing one
- Change `RELEASE_REPO` or an asset name in `app-release.ts` without the app's `SUFeedURL` (installed copies keep the old URL until they update)
- Start the updater in a Debug build — it would offer the published release over the development build
- Point `build.publish` in `app/desktop/package.json` or `RELEASE_REPO` in `app/src/updates.ts` anywhere but the release repository
- Change the Android signing key — Android refuses an APK signed with another key over an installed one, stranding every copy
