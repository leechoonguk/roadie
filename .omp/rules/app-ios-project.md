---
description: Xcode project for the iOS app — the macOS Swift compiled into both iOS targets, one group. App Group, widget presses run in the app's process (LiveActivityIntent, iOS 17), Bluetooth allowed from the background, widget embedded, the macOS team
globs:
      - app/ios/MarshallBluetooth.xcodeproj/project.pbxproj
      - app/ios/MarshallBluetooth/Info.plist
      - app/ios/RoadieWidget/Info.plist
      - app/ios/**/*.entitlements
      - app/macos/MarshallWidget/ControlIntents.swift
alwaysApply: false
---

# App iOS Project

## Why This Is Checked

The iOS app writes almost no Swift of its own: it compiles the macOS sources a
second time. That is what keeps Apple platforms on one Bluetooth core and one
widget — and it is fragile in exactly the way nothing compiles here. A file
added to `app/macos/Shared/` is in the macOS targets (rule://app-macos-project)
and missing from the iOS ones until someone remembers the second project; a
widget intent that is not a Live Activity intent runs in the extension, which
has no Bluetooth; a background mode left out makes every press fail on a locked
phone. Each builds cleanly. `check-app-ios-project` reads the project, the
Info.plists and the entitlements as files, in `make verify`; CI compiles them
(`make ios-build`).

## Targets

| Target | Compiles | Product |
|---|---|---|
| `MarshallBluetooth` | `app/ios/MarshallBluetooth/` (the template's `AppDelegate`), and from `app/macos/`: `Shared/`, `Native/*.swift` + `*.m`, `Native/Core/` less the AppKit-only files, and the widget files that declare an intent | the iOS app, which runs the React Native screens over the shared `MarshallBle` module |
| `RoadieWidget` | from `app/macos/`: `Shared/`, `MarshallWidget/`, and the core a press needs (`MarshallScanner`, `MarshallProtocol`, `OneShotSession`) | `RoadieWidget.appex`, embedded in the app |

The macOS sources are referenced through the project's "Shared with macOS"
group (`path = ../macos`), never copied: a copy is a second implementation that
the macOS gates do not test.

## A Press, On iOS

There is no resident app, as there is on macOS. A widget button runs
`StepControlIntent`/`ResetToneIntent`, which are `LiveActivityIntent`s under
`#if os(iOS)`: the system performs them in the app's process, launching it in
the background if needed. That process holds the Bluetooth permission and the
`bluetooth-central` background mode; `OneShotSession` connects, steps from the
value the speaker reports, reads back, and disconnects
(rule://app-native-boundary, "Platforms").

## Project Conventions

- **Every shared source in both projects.** Adding a file under
  `app/macos/Shared/` or `Native/Core/` means adding it to the iOS targets too;
  the check names each file missing from each target.
- **No React in the widget.** The extension links no React Native.
- **One `group.` App Group.** iOS accepts only `group.` identifiers — not the
  macOS `$(TeamIdentifierPrefix)…` form — so the iOS Info.plists and
  entitlements name `group.com.uk.marshallbluetooth`, each target reading it
  from `AppGroupIdentifier` (`SharedStore`).
- **iOS 17 everywhere.** Interactive widget buttons and `LiveActivityIntent`
  start there.
- **One team.** Every iOS configuration signs with the macOS project's
  `DEVELOPMENT_TEAM`.

## Never Do These

- Copy a macOS source into `app/ios/` instead of referencing it
- Make a widget intent run in the extension on iOS (drop its `LiveActivityIntent` conformance)
- Give the iOS targets a macOS-style or differing App Group
- Import React in a file the widget compiles
