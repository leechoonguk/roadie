---
description: Project Makefile — the one entry point for install, run, the gates, the harness checks and publishing
globs:
      - Makefile
alwaysApply: false
---

# Project Makefile Usage

## Overview

`MarshallBluetooth/Makefile` is the only way commands run in this project. It
owns the npm and CocoaPods installs, Metro, the Xcode build, the five app gates
(`lint`, `typecheck`, `test`, `swift-check`, `swift-test`), one `check-*` target per harness
post hook, and the publish path. Run it from the project directory
(`MarshallBluetooth/`); the Git repository root is the parent directory and
holds other projects.

`strict-command-routing` blocks the direct tool invocations these targets own
(`npx tsc`, `npx eslint`, `npx jest`, `swiftc -typecheck`, `pod install`,
`xcodebuild`, the React Native CLI), so every run uses the flags the gate uses.

## Self-Documenting Targets

Every target carries a `## <description>` on its header line. `make help` greps
those descriptions, so a target without one exists but cannot be found - and an
undiscoverable target is re-invented as a raw command. `check-makefiles`
enforces it.

## Verify Membership

`make verify` is the gate: `make commit` and `make push` depend on it, and
`strict-verified-git` reruns it before any raw `git commit`/`git push`. A
`check-*` target that exists but is not a prerequisite of `verify` passes when
run by hand and is never run by the gate. The contract, enforced by
`check-makefiles`:

- Every `check-<name>` target whose recipe runs `node .omp/hooks/post/...`
  **must** be a prerequisite of `verify` — except `check-verify`, which runs
  `make verify` itself and would recurse. That exemption is named in
  `check-makefiles` (`GATE_RUNNER`), not inferred.
- The `make verify` row in the table below lists **exactly** the Makefile's
  prerequisites, joined by ` + `. The doc is the reviewable contract, the
  Makefile is the executed one — `check-makefiles` diffs them in both
  directions, so editing one without the other fails the gate.

Adding a post hook therefore touches four places: the hook file, its
`check-<name>` target, the `verify:` prerequisite list, and this table (its own
row plus the `make verify` row).

## Makefile Targets

| Target | Command | Purpose |
|---|---|---|
| `make help` | `grep -E '^[a-zA-Z_-]+:.*?## .*'` | Show this help |
| `make install` | `cd app && npm ci` + `make pods` | Install JS dependencies, then CocoaPods |
| `make pods` | `cd app/macos && pod install` | Install CocoaPods for the macOS app (requires Xcode) |
| `make start` | `cd app && npx react-native start` | Start the Metro bundler |
| `make run` | `cd app && npx react-native run-macos --scheme MarshallBluetooth-macOS` | Build and launch the macOS app with its widget (requires Xcode) |
| `make build` | `xcodebuild -workspace … -scheme MarshallBluetooth-macOS -configuration Debug build` | Build the app and the widget extension (requires Xcode) |
| `make relaunch` | `make build` + `pkill -x Roadie` + `pluginkit -a <MarshallWidget.appex>` + `open <Roadie.app>` + `killall chronod` | Run the build that was just made: a menu bar app keeps the old build alive and the widget host caches the old extension until both are replaced (requires Xcode; Debug needs `make start`) |
| `make app-logs` | `log stream --predicate 'subsystem == "com.uk.marshallbluetooth"'` | Stream the app's and the widget's own lines — a widget press shows as `widget-intent … queued` then `relay applying …` (`rule://app-macos-project`) |
| `make typecheck` | `cd app && npx tsc --noEmit` | Type-check the app TypeScript |
| `make lint` | `cd app && npx eslint .` | Lint the app TypeScript |
| `make test` | `cd app && npx jest` | Run the jest tests |
| `make swift-check` | `swiftc -typecheck` over `Shared/` + `Native/Core/`, then `Shared/` + `MarshallWidget/` | Type-check the React-free Swift against the Command Line Tools SDK — the native gate that runs without Xcode |
| `make swift-test` | `swift test --package-path app/macos/CoreTests` + the Command Line Tools' Swift Testing plugin/framework paths | Run the Swift Testing suite over the React-free Swift (`Shared/` + `Native/Core/`, symlinked into the package) — the native behaviour gate that runs without Xcode |
| `make ble-probe` | `swift run --package-path app/macos/CoreTests marshall-probe $(ARGS)` | Drive `MarshallScanner` against a real speaker without React — scan, connect, GATT reads, `--volume` — so a failure is pinned to one stage; not a `verify` gate (needs hardware) |
| `make app-icon` | `swift run --package-path app/macos/CoreTests roadie-icon <AppIcon.appiconset>` | Render the app icon PNG set from its Swift drawing (`CoreTests/Icon`) — the icon is code, so it is regenerated, never hand-edited |
| `make desktop-install` | `cd app/desktop && npm ci` | Install the Windows/Linux desktop app's dependencies (Electron, electron-builder, esbuild, react-native-web) |
| `make desktop-build` | `node app/desktop/build.ts` | Bundle the desktop app into `app/desktop/out`: the main process, the preload script and the window — `app/App.tsx` itself, with `react-native` resolved to react-native-web (through `app/desktop/src/renderer/reactNative.ts`) and the two native wrappers swapped for Web Bluetooth and the tray (`app/desktop/src/renderer/`) |
| `make desktop-start` | `make desktop-build` + `cd app/desktop && npx electron .` | Run the desktop app from its bundle (Windows/Linux; on macOS `make run` is the app) |
| `make desktop-typecheck` | `cd app/desktop && npx tsc --noEmit -p tsconfig.json` | Type-check the desktop app and `__tests__/desktop.test.ts` against DOM, Node and Web Bluetooth types — not in `verify`, which must not need `make desktop-install`; CI runs it |
| `make desktop-dist` | `make desktop-build` + `cd app/desktop && npx electron-builder --publish never` | Package this OS's installers into `app/desktop/release` — NSIS on Windows, AppImage + deb on Linux; `v=x.y.z` sets the version. CI attaches them to the GitHub release `make release` publishes (`.github/workflows/desktop.yml`) |
| `make android-apk` | `cd app/android && ./gradlew assembleRelease` | Build the Android APK — Release (bundled JS, Hermes) signed with the template's public debug key, so it installs by hand but is not a store build; `v=x.y.z` sets `versionName` and `versionCode` (`x*10000+y*100+z`). Needs the Android SDK and JDK 17; CI attaches it to the GitHub release (`.github/workflows/native.yml`) |
| `make ios-pods` | `cd app/ios && pod install` | Install CocoaPods for the iOS app (requires Xcode) |
| `make ios-build` | `xcodebuild -workspace app/ios/MarshallBluetooth.xcworkspace -scheme MarshallBluetooth -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build` | Build the iOS app for the simulator, unsigned — the compile gate CI runs. A device build is signed in Xcode with team `X575PLRF8N`; distribution needs the Apple Developer Program, so no iOS build is attached to a release |
| `make verify` | `lint + typecheck + test + swift-check + swift-test + check-app-duplicate-blocks + check-app-ios-project + check-app-macos-project + check-app-native-boundary + check-app-protocol-parity + check-code-layout + check-makefiles + check-omp-hooks + check-omp-rules + check-omp-skills + check-omp-types + check-release + check-tooling` | Run every gate that runs without Xcode |
| `make clean` | `rm -rf app/macos/build app/macos/CoreTests/.build app/coverage` + `jest --clearCache` | Remove build output and caches |
| `make commit` | `git add -A -- .` + `git commit -- .` behind `verify` | Commit this project's verified worktree — `m="type(scope): subject"`; the gate is a prerequisite, so the tree that is committed is the tree that passed |
| `make push` | `git push origin <current branch>` behind `verify` | Push after the gate passes again, because the worktree may have moved since the commit |
| `make dist` | `node .omp/hooks/lib/app-release.ts dist $(v)` | Build Release with version `v`, check the bundle, zip and Sparkle-sign it, write `appcast.xml` + `checksums.txt` into `app/macos/build/dist` — publishes nothing (`rule://release`; requires Xcode) |
| `make release` | `node .omp/hooks/lib/app-release.ts release $(bump)` behind `verify` | Tag the next version, build and sign it, publish the GitHub release, read the feed back — only when the user asks; `DRY_RUN=1` runs the preflight only (`rule://release`) |
| `make unrelease` | `node .omp/hooks/lib/app-release.ts unrelease $(v)` | Delete a GitHub release and its tag; `latest` falls back to the previous release (`rule://release`) |
| `make app-install` | `node .omp/hooks/lib/app-release.ts install` | Download the latest published release, check its sha256 and signature, install it as `/Applications/Roadie.app` and unregister build copies from LaunchServices and the widget host, so one Roadie exists (`rule://release`) |
| `make check-app-duplicate-blocks` | `node .omp/hooks/post/check-app-duplicate-blocks.ts` | Check `app/` sources for duplicated block runs (`rule://app-duplicate-blocks`) |
| `make check-app-ios-project` | `node .omp/hooks/post/check-app-ios-project.ts` | Check the iOS Xcode project — the macOS sources compiled into both iOS targets, one `group.` App Group, widget presses in the app's process, Bluetooth from the background, the widget embedded, the macOS team (`rule://app-ios-project`) |
| `make check-app-macos-project` | `node .omp/hooks/post/check-app-macos-project.ts` | Check the Xcode project — target membership, team signing, App Group, names, menu bar residency (`rule://app-macos-project`) |
| `make check-app-native-boundary` | `node .omp/hooks/post/check-app-native-boundary.ts` | Check the React Native ↔ Swift boundary (`rule://app-native-boundary`) |
| `make check-app-protocol-parity` | `node .omp/hooks/post/check-app-protocol-parity.ts` | Check that the Swift and TypeScript halves agree on the GATT UUIDs, the EQ and volume scales, the product-name tokens and the press model (`rule://app-protocol-parity`) |
| `make check-code-layout` | `node .omp/hooks/post/check-code-layout.ts` | Check code layout — comments, TS file layout, member order, whitespace (`rule://code-layout`) |
| `make check-makefiles` | `node .omp/hooks/post/check-makefiles.ts` | Check the Makefile against this table and the post hooks |
| `make check-omp-hooks` | `node .omp/hooks/post/check-omp-hooks.ts` | Check `.omp/hooks/` against `omp-hooks.md` and the hook contract |
| `make check-omp-rules` | `node .omp/hooks/post/check-omp-rules.ts` | Check `.omp/rules/` frontmatter, naming and TTSR triggers |
| `make check-omp-skills` | `node .omp/hooks/post/check-omp-skills.ts` | Check the skills catalog against the discovered `SKILL.md` files |
| `make check-omp-types` | `node .omp/hooks/post/check-omp-types.ts` | Type-check the harness TypeScript (`.omp/**/*.ts`) |
| `make check-release` | `node .omp/hooks/post/check-release.ts` | Check the update feed URL, Sparkle key, sandbox installer entitlements, tag-driven versions and Sparkle pod (`rule://release`) |
| `make check-tooling` | `node .omp/hooks/post/check-tooling.ts` | Check the tooling language policy (`rule://tooling`) |
| `make check-verify` | `node .omp/hooks/post/check-verify.ts` | Run the root `make verify` and quote the failing lines — outside `verify` because it runs `verify` |

## Gates That Need Xcode

`make pods`, `make build`, `make run`, `make relaunch` and `make dist` need Xcode; the
`verify` gate does not, so it runs on a machine with the Command Line Tools
only. `make swift-check` and `make swift-test` exist for exactly that reason:
they type-check and test the Swift that does not depend on React or CocoaPods
(`app/macos/Shared/`, `Native/Core/`, `app/macos/MarshallWidget/`) against
whichever SDK is selected. That is why rule://app-native-boundary keeps logic
out of the React Native adapters — code in an adapter is code only `make build`
compiles — and why `check-app-macos-project` reads the project file instead of
building it: a source left out of its target is visible without Xcode.

## Verification Status

- A `make verify` failure is authoritative only when the command's captured exit
  status is nonzero.
- If a tool wrapper reports a nonzero status while every check prints `PASS`, rerun
  the command and capture Make's status before changing code:

  ```bash
  make verify; status=$?; printf 'MAKE_VERIFY_EXIT=%s\n' "$status"
  ```

- `MAKE_VERIFY_EXIT=0` means verification passed. Report the wrapper discrepancy
  as a harness issue; do not change project code to satisfy a contradictory status.

## Never Do These

- Declare a catch-all rule (`%:`, `.DEFAULT:`) — it answers every unknown target
  with success, so every `check-*` gate would pass without running. Measured in
  the harness this was ported from: an unattended local model whose acceptance
  was a nonexistent target added exactly that rule to make the predicate pass.
  `check-makefiles` rejects it.
- Add a `check-*` target that runs anything but `node .omp/hooks/...`
  (`check-tooling` rejects it).
- Run `npx tsc`, `npx eslint`, `npx jest`, `swiftc -typecheck`, `pod install` or
  `xcodebuild` directly — use the target that owns them.
- Truncate a gate's output with a pipe (`| tail`, `| grep`): the pipe returns its
  own exit status, so a red gate reads green.
