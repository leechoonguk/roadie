---
description: React Native ↔ native boundary — logic in React-free Swift (Native/Core, Shared), adapters and bridge files stay thin, the widget imports no React, screens reach native code through src/native wrappers
globs:
      - app/macos/Shared/*.swift
      - app/macos/MarshallBluetooth-macOS/Native/**/*.swift
      - app/macos/MarshallBluetooth-macOS/Native/*.m
      - app/macos/MarshallWidget/*.swift
      - app/macos/CoreTests/**/*.swift
      - app/src/**/*.ts
      - app/src/**/*.tsx
      - app/App.tsx
alwaysApply: false
---

# App Native Boundary

## Why The Line Exists

The `make verify` gate runs without Xcode, so the React Native adapters and the
app target are compiled only by `make build`, never by the gate. The native
gates in `verify` are `make swift-check`, which type-checks the Swift that needs
neither React nor CocoaPods, and `make swift-test`, which runs Swift Testing
over the same code. Logic placed in an adapter is therefore logic the gate
never compiles; the boundary keeps everything that can break inside what those
gates read. The Xcode project itself is checked as files by rule://app-macos-project.

## Layers

| Layer | Path | Holds | May import |
|---|---|---|---|
| Shared store | `app/macos/Shared/*.swift` | Types and the App Group store compiled into both the app and the widget | Foundation, WidgetKit — never React |
| BLE core | `app/macos/MarshallBluetooth-macOS/Native/Core/*.swift` | CoreBluetooth scanning/connection and widget publishing | Foundation, CoreBluetooth, WidgetKit — never React |
| RN adapters | `app/macos/MarshallBluetooth-macOS/Native/*.swift` | Methods in, events out: translate between React Native and the core | React, Foundation — never CoreBluetooth |
| Bridge files | `app/macos/MarshallBluetooth-macOS/Native/*.m` | `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` declarations of the adapter of the same stem | `<React/...>` headers |
| Widget | `app/macos/MarshallWidget/*.swift` | The WidgetKit extension, reading the shared store | SwiftUI, WidgetKit — never React, never CoreBluetooth |
| Core tests | `app/macos/CoreTests/` | `Package.swift`, `Sources/MarshallCore/` (symlinks to `Shared/` and `Native/Core/`), `Tests/*.swift` — the Swift Testing suite `make swift-test` runs | Foundation, Testing, `@testable import MarshallCore` — never React, never CoreBluetooth |
| JS wrappers | `app/src/native/*.ts` | One typed wrapper per native module (`MarshallBle`, `WidgetBridge`) | `react-native` (`NativeModules`, `NativeEventEmitter`) |
| Screens | `app/src/screens/*.tsx`, `app/App.tsx` | UI | the wrappers in `app/src/native/` — never `NativeModules` |

## Conventions

- **React-free means compiled here.** `Shared/`, `Native/Core/`,
  `MarshallWidget/` and `CoreTests/` import no React module and name no `RCT`
  symbol; a React type in them breaks `make swift-check`, `make swift-test` and
  the widget extension's link.
- **One central.** `import CoreBluetooth` appears only under `Native/Core/`. An
  adapter that scans is untested logic; a widget that scans is a second central
  fighting the app for the speaker.
- **Bridge files declare, never implement.** A `Native/*.m` holds `#import`,
  comments, `RCT_EXTERN_MODULE`, `RCT_EXTERN_METHOD` (a signature may wrap
  across lines) and `@end` — no `@implementation`, no `{` body — and its stem
  matches the Swift adapter it exposes (`MarshallBleModule.m` →
  `MarshallBleModule.swift`).
- **Selectors agree both ways.** Every `@objc` instance method of an adapter
  has an `RCT_EXTERN_METHOD` with the same selector, and every declared
  selector has its `@objc` method. A method with arguments names its selector
  explicitly (`@objc(setVolume:level:)`) so the two can be compared. A missing
  declaration leaves the method unreachable from JavaScript; a declaration
  without a method crashes at call time — and without Xcode neither fails a
  build here.
- **One door per native module.** Screens import the typed wrapper from
  `app/src/native/`; only the wrappers read `NativeModules`, so a renamed
  native method fails `make typecheck` in one file instead of at runtime in
  every screen. Tests in `app/__tests__/` may mock `NativeModules` — that is
  how a wrapper is tested without a native runtime.
- **App and widget share files, not defaults.** State crossing from the app to
  the widget (the snapshot) and back (the widget's requests) goes through
  `SharedStore` — JSON files in the App Group container — never
  `UserDefaults(suiteName:)`. cfprefsd refuses a suite shared between two
  sandboxed processes, and its change notifications never reach the other
  process; both fail silently.
- **Protocol extensions only default declared requirements.** A method that
  exists only in a protocol extension is statically dispatched: a conformer's
  own implementation is never called through the protocol, and nothing warns.
  Declare the method in the protocol, then give it a default in the extension.
- **Device facts are measured, not guessed.** A service UUID, characteristic,
  byte layout or value range comes from a `make ble-probe` capture of a real
  speaker (`--raw` to watch values move as a knob turns, `--write` to confirm a
  value sticks) and is pinned in `CoreTests/Tests/` with the captured bytes. A
  constant with no capture behind it is a guess the speaker will refuse.

## Adding a Native Capability

1. If the capability talks to the speaker, capture the characteristic with
   `make ble-probe ARGS="--target <name> --raw"` first (and `--write` to confirm
   a value sticks). Write the behaviour in `Native/Core/` (or the type in
   `Shared/`), pin the captured bytes in `CoreTests/Tests/`, and run
   `make swift-check` and `make swift-test` — it must compile and pass without React.
2. Expose it from the adapter in `Native/<Module>Module.swift` as a pure
   translation with an explicit `@objc(selector:)`, and declare the same
   selector in `Native/<Module>Module.m` with `RCT_EXTERN_METHOD`; run
   `make check-app-native-boundary`.
3. Add the typed function to `app/src/native/<Module>.ts`, call it from the
   screen, and run `make typecheck` and `make test`.
4. If the widget shows it, read it from the shared store in
   `MarshallWidget/` and run `make swift-check` again.

## Enforcement

`check-app-native-boundary` (`make check-app-native-boundary`, part of
`make verify`) checks the first seven conventions on code lines only — comments that
explain the boundary may name what it forbids. It is dormant (cause `absent`)
while `app/macos/` does not exist.

## Never Do These

- Import React, or use an `RCT…` type, in `Shared/`, `Native/Core/`, `MarshallWidget/` or `CoreTests/`
- Import CoreBluetooth outside `Native/Core/`
- Put an `@implementation` or a method body in a `Native/*.m` file
- Add an adapter `@objc` method without its `RCT_EXTERN_METHOD`, or the reverse
- Read `NativeModules` in a screen or in `App.tsx`
- Share app ↔ widget state through `UserDefaults(suiteName:)`
- Define a method in a protocol extension that the protocol does not declare
- Encode a device constant that no `make ble-probe` capture backs
