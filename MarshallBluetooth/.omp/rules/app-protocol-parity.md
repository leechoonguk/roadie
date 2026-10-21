---
description: Protocol parity — the GATT UUIDs, the EQ and volume scales, the product-name tokens and the press model are defined once per language (Swift for macOS/iOS, TypeScript for Windows/Linux/Android) and must agree
globs:
      - app/src/protocol.ts
      - app/src/controls.ts
      - app/macos/MarshallBluetooth-macOS/Native/Core/MarshallScanner.swift
      - app/macos/Shared/DeviceSnapshot.swift
      - app/macos/Shared/ControlStep.swift
alwaysApply: false
---

# App Protocol Parity

## Why There Are Two

Every platform shares one Bluetooth implementation per language
(rule://app-native-boundary, "Platforms"): macOS and iOS run the Swift core,
Windows, Linux and Android run `app/src/ble/client.ts`. Two languages cannot
share a source file, so the facts about the speaker are written twice:

| Fact | TypeScript | Swift |
|---|---|---|
| Service and characteristic UUIDs | `UUIDS` in `app/src/protocol.ts` | `MarshallScanner`'s `CBUUID(string:)` constants, same names |
| EQ range and flat point | `EQ_STEPS` | `EQScale` (`Shared/DeviceSnapshot.swift`) |
| Volume before the speaker reports its maximum | `FALLBACK_MAX_VOLUME` | `VolumeScale.fallbackMaximum` (`Shared/ControlStep.swift`) |
| Advertised-name tokens of a candidate | `PRODUCT_NAME_TOKENS` | `MarshallScanner.productNameTokens` |
| A press and what it writes | `ControlAction`, `ControlChange` in `app/src/controls.ts` | the same enums in `Shared/ControlStep.swift` |

Each half has its own tests (`__tests__/protocol.test.ts`,
`__tests__/controls.test.ts`; `MarshallProtocolTests.swift`,
`ControlStepTests.swift`), written with the same byte values and cases. A value
changed in one half still passes both suites. `check-app-protocol-parity`
reads both halves and fails on any difference, in `make verify`.

## Conventions

- **Change a fact in both languages in one change.** The check names the value
  and both sides.
- **Keep the names.** UUIDs are compared by constant name (`volume`,
  `maxVolume`, …), so a rename on one side reads as one missing and one extra.
- **New press kinds go in both enums,** with the step rule in both
  `stepControl` and `ControlAction.change(from:)`, and a case in both test
  suites.

## Never Do These

- Change a UUID, a scale or a token in one language only
- Add a `ControlAction` or `ControlChange` kind to one language only
- Inline a protocol value elsewhere instead of naming the shared constant
