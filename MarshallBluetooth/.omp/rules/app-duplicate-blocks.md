---
description: Duplicated block runs — the same run of lines twice in one app/ file means a botched rewrite, not a numbering problem
alwaysApply: false
globs:
      - app/App.tsx
      - app/index.js
      - app/src/**/*.ts
      - app/src/**/*.tsx
      - app/__tests__/**/*.tsx
      - app/macos/Shared/*.swift
      - app/macos/MarshallBluetooth-macOS/**/*.swift
      - app/macos/MarshallBluetooth-macOS/**/*.m
      - app/macos/MarshallWidget/*.swift
---

# App Duplicate Blocks

One file must state each thing once. When 24+ consecutive identical lines appear
twice in the same file (non-overlapping, at least 8 distinct non-blank lines in
the run), the file contains a **duplicated block** — the usual cause is a
full-file rewrite from stale content followed by partial edits layered on top.

## What to do when it fires

1. **Read the whole file first** — the two copies drifted, so decide which copy
   is current before touching anything.
2. **Delete one copy entirely.** Do not renumber, re-title, or patch around the
   duplicate: every downstream symptom (doubled declarations, a second
   `RCT_EXTERN_METHOD`, shadowed exports) disappears with the copy.
3. Re-run the reporting check — `make check-app-duplicate-blocks` — and confirm
   the file is clean before moving on.

## Why this is its own check

Other checks see only the second-order symptoms (a redeclared Swift method, a
duplicate export) and their messages then read as "rename the second one" —
measured in the harness this was ported from: a session spent 15+ minutes
renumbering sections of a file that simply contained the whole run twice. The
duplicate is the cause; this check names it.

Machine check: `make check-app-duplicate-blocks` scans `app/src`,
`app/__tests__`, the entry files and the Swift/Objective-C trees under
`app/macos/`. Data formats (JSON, plists, entitlements, the Xcode project) are
exempt — structural repetition is normal there.
