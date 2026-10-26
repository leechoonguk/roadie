---
description: Xcode project for the macOS app (Roadie) — every native source in its target, team signing, one App Group, one product name, a menu bar app that outlives its window and reopens it from the menu (AppKit-owned NSWindow), Bluetooth declared, one build location, one registered copy, the Mac's environment
globs:
      - app/macos/MarshallBluetooth.xcodeproj/project.pbxproj
      - app/macos/MarshallBluetooth-macOS/Info.plist
      - app/macos/MarshallBluetooth-macOS/AppDelegate.swift
      - app/macos/MarshallWidget/Info.plist
      - app/macos/**/*.entitlements
      - app/macos/MarshallBluetooth.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings
      - Makefile
      - app/.eslintrc.js
alwaysApply: false
---

# App macOS Project

## Why This Is Checked

Everything here builds cleanly when it is wrong. A source file left out of its
target links without it; an ad-hoc signature builds and launches; a stale
product name builds. Each one fails only at run time, on the desktop, as a
widget that shows a sample, buttons that stay grey, or an app that quits when
its window closes — and no compile step, test, or type check looks there. The
project file, the Info.plists and the entitlements are therefore checked as
files, by `check-app-macos-project`, in `make verify`.

## Targets and Trees

A target compiles exactly the sources under the directory of its own name, plus
`Shared/`:

| Target | Tree | Product |
|---|---|---|
| `MarshallBluetooth-macOS` | `app/macos/MarshallBluetooth-macOS/` + `app/macos/Shared/` | `Roadie.app` — the menu bar app that owns the Bluetooth connection |
| `MarshallWidget` | `app/macos/MarshallWidget/` + `app/macos/Shared/` | `MarshallWidget.appex` — the desktop widget, embedded in the app |

`app/macos/CoreTests/` is a SwiftPM package (`make swift-test`, `make
ble-probe`, `make app-icon`), not part of the Xcode project; it reaches the core
through symlinks, never by membership.

## Project Conventions

- **Every source is in its target.** A `.swift`/`.m` under a target's tree has
  a `PBXFileReference`, a `PBXBuildFile`, and an entry in that target's Sources
  phase; a file in `Shared/` is in both. A file that moves out of a tree, or is
  deleted, leaves no reference behind. A file needed by both targets lives in
  `Shared/` — never compiled across trees. The iOS project compiles these same
  sources a second time, so a file added or removed here is added or removed
  there too (rule://app-ios-project, `make check-app-ios-project`).
- **Signed by a team.** Every configuration that signs with entitlements names
  a `DEVELOPMENT_TEAM`. With an ad-hoc signature the App Group loses its team
  prefix and macOS refuses the shared container *without a prompt*, so the
  widget falls back to its sample and its buttons are disabled.
- **One App Group.** Both entitlements files and both Info.plists
  (`AppGroupIdentifier`) name the same `$(TeamIdentifierPrefix)marshallbluetooth`.
  The app and the widget exchange the snapshot and the widget's requests as
  files in that container (`SharedStore`), never through `UserDefaults`.
- **One name.** The app target's `PRODUCT_NAME` and both `CFBundleDisplayName`s
  are equal. The widget gallery lists the containing bundle's name, so renaming
  only the display name leaves the widget listed under the old one.
- **A menu bar app outlives its window.** With `LSUIElement` set, the app
  delegate returns `false` from `applicationShouldTerminateAfterLastWindowClosed`
  — the widget's buttons reach the speaker only through the running app.
- **The main window is the app's own.** With `LSUIElement` set, "Open Roadie" in
  the menu bar item must reopen the window at any time, so AppDelegate owns an
  `NSWindow` and keeps it (`isReleasedWhenClosed = false`), and the only SwiftUI
  scene is `Settings { EmptyView() }`. A `Window(` or `WindowGroup(` scene is
  dropped by SwiftUI once the user closes it, and the menu then opens nothing —
  measured on this app, and invisible to the build.
- **Bluetooth is declared.** The app target imports CoreBluetooth, so its
  Info.plist carries `NSBluetoothAlwaysUsageDescription` and its sandbox holds
  `com.apple.security.device.bluetooth`.
- **One build location.** Every build lands in `app/macos/build/DerivedData.noindex`:
  Xcode through the workspace's shared `WorkspaceSettings.xcsettings`
  (`WorkspaceRelativePath`, `build/DerivedData.noindex`), every `xcodebuild` in
  the root Makefile through `-derivedDataPath $(DERIVED_DATA)`, and the release
  builder (`app-release.ts`) through the same directory. Xcode's default
  DerivedData is keyed by the repository's path, so each move or clone left one
  more `Roadie.app` that Spotlight, Launchpad and the widget gallery listed
  beside the installed one — three Roadies on this Mac before the rule. The
  `.noindex` suffix keeps Spotlight out of the directory that remains. ESLint
  ignores `macos/build/**` (`app/.eslintrc.js`): the build output holds generated
  and vendored JavaScript that is not a source. A previous `DerivedData`
  directory beside it is stale: `make clean` unregisters its copies and removes it.
- **One registered copy.** Launch Services and the widget host know a Roadie by
  bundle id, so every registered `Roadie.app` competes: the widget host prefers a
  Release copy's higher version over the Debug build being developed, and a copy
  left by a moved repository or a deleted build stays listed. Only
  `/Applications/Roadie.app` and the Debug build `make run` launches may be
  registered. `make run` unregisters every other copy (absolute paths, the
  embedded Sparkle `Updater.app` with it) and the Release widget before it
  launches; `make app-install` finds copies through the Launch Services dump and
  unregisters them all; `make clean` unregisters every build copy before deleting
  it. `make doctor` (read-only) lists every registered copy with its version,
  the widget registration pluginkit chose and the running processes, and exits
  non-zero when an extra copy is registered or the widget points elsewhere than
  the app that runs. The recipes are held by `check-app-macos-project`.

## Adding a New Native Source File

1. Create the file in the tree of the target that compiles it (`Shared/` when
   both do) and register it in `project.pbxproj` in the same change: one
   `PBXFileReference`, one `PBXBuildFile` per target, one entry in each
   target's Sources phase, one child in its group. Run
   `make check-app-macos-project`.
2. If the file is React-free (`Shared/`, `Native/Core/`, `MarshallWidget/`),
   run `make swift-check`; if it holds testable logic, cover it in
   `CoreTests/Tests/` and run `make swift-test` (rule://app-native-boundary).
3. Run `make build` — the first gate that links the targets.
4. Run `make run` and exercise the change on the desktop; follow it with
   `make app-logs` when it crosses from the widget to the app.

## Running on This Mac

- **Signing, TCC and folder-permission symptoms start with the identity.** A
  prompt that never appears, a container the app cannot open, or a widget that
  shows a sample all trace to the signing identity and the App Group prefix
  first — not to the app code. `make build` needs an *Apple Development*
  identity for the project's team in the login keychain (Xcode › Settings ›
  Accounts › Manage Certificates). If `security find-identity -v -p
  codesigning` lists none while the certificate is present, the keychain is
  missing Apple's WWDR G3 intermediate certificate. `make doctor` checks that a
  valid identity belongs to the pbxproj's `DEVELOPMENT_TEAM`, that the WWDR G3
  intermediate is present, and that `xcode-select -p` is Xcode (not the Command
  Line Tools) when Xcode is installed. Every read it makes is fail-loud: a registry or
  keychain it cannot read is a problem, never "none registered".
- **Debug needs Metro.** The Debug build loads its JavaScript from Metro;
  without `make start` the app runs with an empty window and never scans, so
  `make run` fails before building when nothing answers on port 8081
  (`node .omp/hooks/lib/app-doctor.ts metro`, the probe `make doctor` reports
  too) — run `make start` first, or install a Release with `make app-install`.
- **`make run`** rebuilds, quits the running app (a menu bar app keeps the
  old build alive otherwise), drops every other registered copy, re-registers
  the widget extension and restarts the widget host so the gallery and the
  placed widgets pick up the new build.
- **`make app-logs`** streams the app's and the widget's own lines: a widget
  press shows as `widget-intent … queued` followed by `relay applying …` in the
  app. A press with no `widget-intent` line never ran (the button was disabled
  or the widget had no snapshot); one with no `relay` line never reached the
  app (not running, or a different App Group).
- **`make ble-probe`** drives the BLE core against the speaker without the app,
  to tell a protocol fault from a UI one.
- **Bluetooth permission** is asked once per signing identity. A rebuilt app
  with the same team keeps it; an ad-hoc build is a new app every time.
- **Editor diagnostics are not the gate.** SourceKit type-checks one file at a
  time, so a file in `Shared/`, `Native/Core/` or `MarshallWidget/` that uses a
  type from a sibling file reports "Cannot find '…' in scope". The
  authoritative answer is `make swift-check`, which compiles each tree as a
  whole; trust it over the editor.
- **Granting Input Monitoring or Screen Recording makes macOS quit the app.**
  That is expected, not a crash: relaunch it after the grant.
- **Log levels decide what survives.** `log show` sees only `notice` and above
  after a few minutes — `info` lines are not persisted — and a `log stream`
  started in the background dies with its shell. Decisions worth reading later
  (a connection chosen, a press applied) are logged at `notice`; follow live
  with `make app-logs` in the foreground.
- **Never drive the GUI by screen coordinates.** A click by coordinate lands on
  whichever window is there. Use Accessibility element actions, or ask the user
  to click.
- **`make app-smoke`** drives the running app's window through Accessibility
  (`lib/app-smoke.ts`): "Open Roadie" from the menu bar item, the close button,
  and the reopen three times; the opening size (the saved frame, else 680×520
  content) and that shrinking stops at the minimum (560×440 content); then the
  size it found is set back. It prints PASS/FAIL per step and fails clearly when
  Accessibility is not allowed for the terminal or Roadie is not running. It
  needs a logged-in GUI session, so it is not a `verify` gate: run it after
  `make app-install` or `make run`, on any change to the window or the menu.
  The calls are separate `osascript` runs with pauses — one long `tell` block
  raced the window list — and two GUI drivers at once (another agent clicking
  its own menu bar item) make windows vanish mid-run: run it alone.

## Enforcement

`check-app-macos-project` (`make check-app-macos-project`, part of
`make verify`) holds every Project Convention by reading the project, plist and
entitlements files — it builds nothing and contacts no device. It is dormant
(cause `absent`) while the Xcode project does not exist.

The window's behaviour needs a GUI session, so it is not a `verify` gate:
`make app-smoke` drives the running app through Accessibility.

## Never Do These

- Add a `.swift`/`.m` under `app/macos/` without registering it in its target
- Compile a file from one target's tree into another — move it to `Shared/`
- Build with the team removed, or with a hardcoded team ID in an App Group
- Rename the app in one of `PRODUCT_NAME` / `CFBundleDisplayName` only
- Share state between the app and the widget through `UserDefaults(suiteName:)`
- Let the menu bar app terminate when its window closes
- Create the main window of an `LSUIElement` app as a SwiftUI `Window`/`WindowGroup`
  scene, or release its `NSWindow` when closed — the menu cannot reopen it
- Build with `react-native run-macos`, Xcode's default DerivedData, or an
  `xcodebuild` without `-derivedDataPath` — each leaves another Roadie.app listed
- Delete a build directory without unregistering its app (`make clean` does both)
- Leave a Release or an old build registered beside the one being run, or launch
  Debug without Metro
