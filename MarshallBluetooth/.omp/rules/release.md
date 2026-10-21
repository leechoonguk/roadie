---
description: Releases and in-app updates — the git tag is the version; make dist builds and Sparkle-signs on this Mac, make release publishes to GitHub only when asked; feed URL, EdDSA key, installer entitlements and versions stay in step
globs:
      - .omp/hooks/lib/app-release.ts
      - .omp/hooks/post/check-release.ts
      - .omp/hooks/pre/strict-release-route.ts
      - app/macos/Podfile
      - app/macos/MarshallBluetooth-macOS/Info.plist
      - app/macos/MarshallBluetooth-macOS/MarshallBluetooth.entitlements
      - app/macos/MarshallWidget/Info.plist
alwaysApply: false
---

# Release

Roadie updates itself with Sparkle from GitHub Releases of `leechoonguk/roadie`.
Every installed copy reads one URL — `releases/latest/download/appcast.xml`, the
app's `SUFeedURL` — so publishing a release *is* shipping an update.

| Gate | Hook | Blocks |
|---|---|---|
| Consent | `strict-publish-consent.ts` | `make release` / `make unrelease` when the current user turn does not ask for a release (or asks and forbids it); `make release … DRY_RUN=1` is exempt |
| Route | `strict-release-route.ts` | raw `git tag` writes, pushing a version tag, `gh release create/delete/edit/upload/delete-asset` |
| Consistency | `check-release.ts` (in `make verify`) | a feed URL other than the one `app-release.ts` publishes, a malformed `SUPublicEDKey`, a sandboxed app without the installer service and its mach-lookup exceptions, a literal version in either Info.plist, no Sparkle pod, an installer workflow (`desktop.yml`, `native.yml`) that is missing, does not run on a published release, builds tag pushes, uploads unguarded, or uploads a name matching `Roadie.zip`, `appcast.xml` or `checksums.txt` |

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
   release with `Roadie.zip`, `appcast.xml` and `checksums.txt`, and verifies
   both the attached assets and that `releases/latest/download/appcast.xml` now
   names the new version.
5. Publishing the release starts `.github/workflows/desktop.yml`, which builds
   the Windows and Linux app (`app/desktop`, `make desktop-dist`) on GitHub's
   runners and attaches `Roadie-<version>-windows-setup.exe`, `…-linux-x86_64.AppImage`
   and `…-linux-amd64.deb` to the same release a few minutes later, and
   `.github/workflows/native.yml` attaches `Roadie-<version>-android.apk`
   (`make android-apk`, signed with the template's public debug key). None of
   these carries an Apple key, so CI may build them; CI only adds assets and
   never touches the three above. iOS has no release asset: installing it
   needs the maintainer's Apple signing in Xcode.

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
