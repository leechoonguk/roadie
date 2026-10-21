---
description: Xcode project for the macOS app (Roadie) — every native source in its target, team signing, one App Group, one product name, a menu bar app that outlives its window, Bluetooth declared
globs:
      - app/macos/MarshallBluetooth.xcodeproj/project.pbxproj
      - app/macos/MarshallBluetooth-macOS/Info.plist
      - app/macos/MarshallBluetooth-macOS/AppDelegate.swift
      - app/macos/MarshallWidget/Info.plist
      - app/macos/**/*.entitlements
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
- **Bluetooth is declared.** The app target imports CoreBluetooth, so its
  Info.plist carries `NSBluetoothAlwaysUsageDescription` and its sandbox holds
  `com.apple.security.device.bluetooth`.

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
4. Run `make relaunch` and exercise the change on the desktop; follow it with
   `make app-logs` when it crosses from the widget to the app.

## Running on This Mac

- **Signing identity.** `make build` needs an *Apple Development* identity for
  the project's team in the login keychain (Xcode › Settings › Accounts ›
  Manage Certificates). If `security find-identity -v -p codesigning` lists
  none while the certificate is present, the keychain is missing Apple's WWDR
  G3 intermediate certificate.
- **Debug needs Metro.** The Debug build loads its JavaScript from Metro;
  without `make start` the app runs with an empty window and never scans.
- **`make relaunch`** rebuilds, quits the running app (a menu bar app keeps the
  old build alive otherwise), re-registers the widget extension and restarts
  the widget host so the gallery and the placed widgets pick up the new build.
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

## Enforcement

`check-app-macos-project` (`make check-app-macos-project`, part of
`make verify`) holds every Project Convention by reading the project, plist and
entitlements files — it builds nothing and contacts no device. It is dormant
(cause `absent`) while the Xcode project does not exist.

## Never Do These

- Add a `.swift`/`.m` under `app/macos/` without registering it in its target
- Compile a file from one target's tree into another — move it to `Shared/`
- Build with the team removed, or with a hardcoded team ID in an App Group
- Rename the app in one of `PRODUCT_NAME` / `CFBundleDisplayName` only
- Share state between the app and the widget through `UserDefaults(suiteName:)`
- Let the menu bar app terminate when its window closes
