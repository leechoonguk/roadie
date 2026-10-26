# Roadie — Project Guide

## Overview

**Roadie** — volume and tone of a Marshall Bluetooth speaker, on six
platforms from one set of React Native screens (TypeScript, npm):

| Platform | Window | Bluetooth | Widget | Updates (rule://release) |
|---|---|---|---|---|
| macOS | react-native-macos 0.83, menu bar app | Swift over CoreBluetooth | WidgetKit, through the resident app | Sparkle |
| iOS | React Native 0.83 | the same Swift, compiled again | the same WidgetKit sources; a press connects for itself | none (Xcode install) |
| Windows, Linux | Electron + react-native-web | `src/ble/client.ts` over Web Bluetooth | the tray menu | electron-updater |
| Android | React Native 0.83 | `src/ble/client.ts` over react-native-ble-plx | react-native-android-widget; a press connects for itself | checks GitHub, opens the APK |

One Bluetooth core per language: Swift for Apple platforms, TypeScript for the
rest, held to each other by rule://app-protocol-parity; the layers and swaps
are rule://app-native-boundary. `README.md` at the project root is the
front page; its pictures in `docs/` are made from the app (rule://root-readme).

The `make verify` gate runs without Xcode; `make build`, `make run` and
`make pods` need it (rule://app-macos-project, "Running on This
Mac"). Native logic lives in React-free Swift so the gate still compiles and
tests it.

## Project Structure

```
Makefile                      the only entry point (rule://root-makefile)
README.md                     the front page, kept true to the code (rule://root-readme)
docs/                         the README's pictures: demo.gif (`make demo`), widgets-*.png (`make widget-snapshots`)
app/                          React Native + react-native-macos, TypeScript, npm
  App.tsx, index.js           entry points (index.js also registers background tasks)
  metro.config.js             Android swaps of src/native/* → mobile/src/
  react-native.config.js      keeps Android-only libraries out of the Apple builds
  src/native/*.ts             typed wrappers over NativeModules (MarshallBle, WidgetBridge, AppUpdates) — the API every platform implements
  src/updates.ts              release repository and version order (Android's updater; rule://release)
  src/ble/client.ts           that API over any JS Bluetooth transport (Windows, Linux, Android)
  src/protocol.ts             GATT UUIDs and value codecs (TypeScript half; Swift half in macos/)
  src/controls.ts             the press model: ControlAction, stepControl
  src/theme.ts                AppKit, UIKit or a fixed palette, per platform
  src/screens/*.tsx           screens
  __tests__/                  jest tests (shared modules, each platform's transport, the Android widget)
  desktop/                    Windows/Linux: Electron package (own package.json; rule://tooling)
    build.ts                  esbuild bundle: react-native → react-native-web, src/native/* swapped
    demo.ts                   `make demo`: records docs/demo.gif from a ROADIE_DEMO bundle (rule://root-readme)
    src/demo/                 the in-memory ACTON III that recording talks to; never in an installer
    src/main.ts               main process and the tray menu (the widget's counterpart)
    src/renderer/             Web Bluetooth transport, tray bridge, react-native shim
  mobile/src/                 Android only: ble-plx transport, the home screen widget
  android/                    React Native template project; widget provider + manifest
  ios/                        iOS Xcode project compiling the macOS Swift (rule://app-ios-project)
    MarshallBluetooth/        the template's AppDelegate, Info.plist, entitlements
    RoadieWidget/             the widget extension's Info.plist and entitlements (sources from macos/)
  macos/
    Podfile
    MarshallBluetooth.xcodeproj                    targets, signing, App Group (rule://app-macos-project)
    Shared/*.swift                                 compiled into both the app and the widget (on macOS and iOS)
    MarshallBluetooth-macOS/AppDelegate.swift      menu bar app entry (Roadie.app)
    MarshallBluetooth-macOS/Native/Core/*.swift    React-free core: BLE, status item, widget request relay, one-shot press (iOS)
    MarshallBluetooth-macOS/Native/*.swift, *.m    RN native module adapters (Swift + ObjC RCT_EXTERN)
    MarshallWidget/*.swift, Info.plist, *.entitlements   WidgetKit extension and its App Intents
    CoreTests/                                     SwiftPM: Swift tests, BLE probe, icon renderer, widget snapshots (docs/)
.omp/                         rules/ hooks/ extensions/ skills/ (this harness)
.github/workflows/            CI: desktop.yml, native.yml (rule://release)
```

The boundary between those layers — what may import React, where CoreBluetooth
lives, what a bridge file may hold — is rule://app-native-boundary.

## Commands

Everything runs through the `Makefile` at the repository root, which is the
project directory.

| Need | Command |
|---|---|
| Install | `make install` (app, CocoaPods for macOS), `make desktop-install`, `make ios-pods` |
| Unit gates while working | `make lint`, `make typecheck`, `make test`, `make swift-check`, `make swift-test`, `make desktop-typecheck` |
| Run the app as built (Xcode) | `make start` once, then `make run` (fails fast without Metro; drops every other registered copy); `make app-logs` to follow widget → app |
| The window as a user drives it (menu bar "Open", close, reopen, sizes) | `make app-smoke` (Accessibility; the running copy; needs a GUI session, so not in `verify`) |
| What this Mac believes about Roadie | `make doctor` — registered copies, the widget host's choice, running processes, signing identity, WWDR G3, `xcode-select`, Metro (read-only, fail-loud) |
| Windows/Linux app | `make desktop-start`; installers with `make desktop-dist v=x.y.z` (this OS only — CI builds both) |
| Android APK, iOS build | `make android-apk v=x.y.z` (Android SDK, JDK 17); `make ios-build` (Xcode, simulator) |
| The README's pictures | `make demo` (desktop recording), `make widget-snapshots` (macOS; CI renders them too) |
| Talk to the speaker without the app | `make ble-probe ARGS="--target ACTON --raw"` — the only evidence for a claim about what the speaker does, sends or supports |
| Release (only when asked) | `make release bump=patch\|minor\|major` (`DRY_RUN=1` first); `make app-install` puts the published Mac build in /Applications |
| One harness check | `make check-<name>` (listed by `make help`) |
| What the harness blocked | `make hook-report` — the pre-hook blocks per hook and the top reasons (`.omp/state/hook-metrics.jsonl`) |
| The whole gate | `make verify` — runs once, at commit, through `make commit`; run it bare and read the `artifact://` it leaves (or `make verify > /tmp/verify.log 2>&1; echo EXIT=$?`) — never pipe it into `tail`/`grep` |
| Publish (only when asked) | `make commit m="type(scope): subject"` (any text: an apostrophe or `$` in the message arrives as typed), `make push` |

## Measure Before You Claim

A statement about what the speaker does, sends or supports needs the probe
output that shows it (`make ble-probe`), quoted in the answer or pinned as a
test fixture in `CoreTests/Tests/`; otherwise it is labelled **unverified**. An
unknown protocol is captured before a codec is written — a codec written from an
assumption is thrown away whole when the capture disagrees. A real device address
never appears in the tree: use a documented placeholder (`AA:00:00:00:00:0n`) or
the probe's arguments (`check-code-layout` rejects the literal).

## Rules (`.omp/rules/`)

Domain rules live in `.omp/rules/` and are **never** imported here. There are
exactly three delivery channels, and only one of them puts a rule body in front
of the model on its own:

| Channel | Frontmatter | What actually reaches the model |
|---|---|---|
| Rulebook | `description` + `globs` | Only the line `- <name> (<globs>): <description>`. The body is read on demand via `rule://<name>` |
| Always-apply | `alwaysApply: true` | Full body in every session's system prompt — capped at 2 rules by `check-omp-rules` |
| TTSR trigger | `condition` (regex) + `scope` + `interruptMode` | Full body injected the moment a matching stream appears — an edit is aborted before it lands |

**`globs` do not deliver anything.** Editing a file that matches a rule's globs
injects nothing: measured, and stated in the harness docs (`globs` "is not used
to automatically select rulebook rules"). On a TTSR rule, `globs` is only a path
gate. So a rulebook rule is documentation of an invariant that a hook enforces
mechanically — the enforcement is the hook (`make verify`), never the listing.

`RULES.md` (this directory, not `rules/`) is the sticky always-apply rule.

Naming: `<scope>-<name>.md` with scope `app-`, `omp-` or `root-` (e.g.
`app-native-boundary.md`); a rule whose globs span several top-level
directories omits the prefix (`tooling.md`). Adding a rule = creating the file
only; no `@rules/` entry here. Every rule maps to a hook in the `omp-hooks.md`
table. A TTSR trigger additionally needs `omp ttsr test` proof that it fires on
the construct and stays quiet on prose (`check-omp-rules` runs it).

## Development Workflow

Before applying or modifying any code pattern for the first time, use **Context7** (`context7-mcp`) to look up relevant library/framework documentation. Query the library ID, fetch the current docs, and apply patterns based on verified content — not assumptions. This applies to React Native, react-native-macos, WidgetKit and CoreBluetooth (and the native-module bridge APIs `RCTBridgeModule`/`RCTEventEmitter` they meet at).
