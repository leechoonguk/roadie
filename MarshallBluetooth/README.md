# Marshall Bluetooth — macOS GUI App

React Native macOS app for Marshall Bluetooth speaker control with Swift native modules and WidgetKit extension.

## Structure

```
MarshallBluetooth/
├── Makefile                          # Build targets (install, start, verify, …)
├── app/                              # React Native app (TypeScript)
│   ├── src/
│   │   ├── native/                   # JS native module wrappers
│   │   │   ├── marshallBle.ts        # BLE scanner + Gaia control bindings
│   │   │   └── widgetBridge.ts       # App Group publish → WidgetKit
│   │   ├── screens/
│   │   │   └── DeviceScreen.tsx      # Device list + control panels
│   │   ├── devices.ts                # Device list state machine
│   │   └── App.tsx                   # Entry point
│   ├── __tests__/                    # Jest tests
│   ├── macos/                        # Xcode project + Swift sources
│   │   ├── MarshallBluetooth-macOS/
│   │   │   ├── Native/               # React Native bridge modules
│   │   │   │   ├── MarshallBleModule.swift  # RN adapter: methods in, events out
│   │   │   │   ├── WidgetBridgeModule.swift # RN adapter for widget publishing
│   │   │   │   └── Core/
│   │   │   │       ├── MarshallScanner.swift  # CoreBluetooth scanner + Gaia protocol
│   │   │   │       └── WidgetPublisher.swift  # App Group UserDefaults publisher
│   │   │   ├── Shared/
│   │   │   │   └── DeviceSnapshot.swift       # Snapshot type + App Group store
│   │   │   ├── MarshallWidget/              # WidgetKit extension
│   │   │   └── MarshallBluetooth.xcodeproj/
│   │   └── Podfile
│   └── package.json
└── .omp/                               # omp harness (CI gates via make verify)
```

## Data Flow

```
BLE Scan → MarshallScanner (CoreBluetooth)
  → MarshallBleModule (RCTEventEmitter)
  → DeviceScreen (React Native)
  → MarshallScanner (control commands back to BLE)

DeviceScreen → WidgetBridge → SnapshotStore (App Group UserDefaults)
  → WidgetKit reads on timeline refresh
```

## Prerequisites

- Node v24+
- CocoaPods 1.17.0 (Homebrew)
- macOS 14.0+ (Command Line Tools for `make swift-check`; full Xcode.app for `pod install` / `xcodebuild`)
- Apple Developer team ID configured in Xcode for WidgetKit App Group

## Make Targets

| Target       | Description                          |
|-------------|--------------------------------------|
| `make help` | List all targets                     |
| `make install` | `npm ci` in app/                  |
| `make pods`   | `pod install` in macos/           |
| `make start`  | `npx react-native start`            |
| `make run`    | `npx react-native run-macos`        |
| `make build`  | `xcodebuild` build + test           |
| `make typecheck` | `tsc --noEmit`                   |
| `make lint`   | `eslint .`                          |
| `make test`   | `jest`                              |
| `make swift-check` | `swiftc -typecheck` on Shared, Core, Widget |
| `make verify` | Full omp harness (lint + tsc + jest + swift-check + 9 check targets) |
| `make clean`  | Remove Pods/, node_modules/, build/ |

## BLE Protocol

The app communicates with Marshall speakers over BLE using:

- **Device Information Service** (`0x180A`) — model, firmware version, serial number
- **Battery Service** (`0x180F` / `0x2A19`) — battery level
- **Vendor service** (`0xFE8F`) — Gaia protocol for EQ, ANC, volume, playback control

## WidgetKit

The widget extension displays device name, connection status, and battery level. The app publishes `DeviceSnapshot` to an App Group `UserDefaults` store; the widget reads it on timeline refresh.

App Group identifier: `$(TeamIdentifierPrefix)marshallbluetooth`

## Bundle IDs

- App: `com.uk.marshallbluetooth`
- Widget: `com.uk.marshallbluetooth.widget`
