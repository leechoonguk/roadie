# MarshallBluetooth — Project Guide

## Overview

**Roadie** — a macOS menu bar app for Marshall Bluetooth speakers: React Native
0.83 + react-native-macos 0.83 (TypeScript, npm) for the window, Swift over
CoreBluetooth for the speaker, and a WidgetKit extension whose buttons adjust
volume and tone from the desktop. The prior reverse-engineering report of the
official Marshall app is `README.md` at the project root (kept verbatim).

The `make verify` gate runs without Xcode; `make build`, `make relaunch`,
`make run` and `make pods` need it (rule://app-macos-project, "Running on This
Mac"). Native logic lives in React-free Swift so the gate still compiles and
tests it.

## Project Structure

```
Makefile                      the only entry point (rule://root-makefile)
README.md                     prior reverse-engineering report (do not edit)
app/                          React Native + react-native-macos, TypeScript, npm
  App.tsx, index.js           entry points
  src/native/*.ts             typed wrappers over NativeModules (MarshallBle, WidgetBridge)
  src/screens/*.tsx           screens
  __tests__/                  jest tests
  macos/
    Podfile
    MarshallBluetooth.xcodeproj                    targets, signing, App Group (rule://app-macos-project)
    Shared/*.swift                                 compiled into both the app and the widget
    MarshallBluetooth-macOS/AppDelegate.swift      menu bar app entry (Roadie.app)
    MarshallBluetooth-macOS/Native/Core/*.swift    React-free core: BLE, status item, widget request relay
    MarshallBluetooth-macOS/Native/*.swift, *.m    RN native module adapters (Swift + ObjC RCT_EXTERN)
    MarshallWidget/*.swift, Info.plist, *.entitlements   WidgetKit extension and its App Intents
    CoreTests/                                     SwiftPM: Swift tests, BLE probe, icon renderer
.omp/                         rules/ hooks/ extensions/ skills/ (this harness)
```

The boundary between those layers — what may import React, where CoreBluetooth
lives, what a bridge file may hold — is rule://app-native-boundary.

## Commands

Everything runs through the `Makefile` from this directory (`MarshallBluetooth/`);
the Git repository root is the parent directory and holds other projects.

| Need | Command |
|---|---|
| Install | `make install` |
| Unit gates while working | `make lint`, `make typecheck`, `make test`, `make swift-check`, `make swift-test` |
| Run the app as built (Xcode) | `make start` once, then `make relaunch`; `make app-logs` to follow widget → app |
| Talk to the speaker without the app | `make ble-probe ARGS="--target ACTON --raw"` |
| One harness check | `make check-<name>` (listed by `make help`) |
| The whole gate | `make verify` — runs once, at commit, through `make commit` |
| Publish (only when asked) | `make commit m="type(scope): subject"`, `make push` |

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
