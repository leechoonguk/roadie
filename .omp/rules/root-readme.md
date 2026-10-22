---
description: The README — the project's front page, kept true to the code; its pictures in docs/ are made from the app (make demo, make widget-snapshots), and the demo speaker that records them never reaches a shipped build
globs:
      - README.md
      - docs/**
      - app/desktop/demo.ts
      - app/desktop/src/demo/**
      - app/macos/CoreTests/WidgetSnapshots/**
alwaysApply: false
---

# README

`README.md` at the project root is the first thing a visitor reads: what Roadie
is, what it looks like, how to install it, how to build it. Everything it says
is a claim about the code, so it changes in the same change as the code it
describes — a renamed target or a moved file is a README edit too.

## Pictures Are Made, Not Drawn

Every picture lives in `docs/` and is produced from the app itself, so a changed
screen is regenerated with one command instead of redrawn:

| Picture | Command | Where it runs | How |
|---|---|---|---|
| `docs/demo.gif` | `make demo` | any machine with `make desktop-install` and ffmpeg (xvfb-run on Linux without a display) | `app/desktop/demo.ts` builds the desktop app with the demo speaker, presses its buttons through the Chrome DevTools Protocol, records the screencast and has ffmpeg make the GIF |
| `docs/widgets-light.png`, `docs/widgets-dark.png` | `make widget-snapshots` | macOS (SwiftUI) — CI renders them in the `macos` job of `native.yml` and uploads them as the `widget-snapshots` artifact | `app/macos/CoreTests/WidgetSnapshots` renders the real `MarshallWidgetView` in all three families with `ImageRenderer` |

After a change to a screen or the widget, regenerate its picture and commit it
with the change. Never edit a picture by hand: the next regeneration would undo
the edit, and the picture would show a screen the code does not draw.

## The Demo Speaker

`app/desktop/src/demo/marshallBle.ts` is an ACTON III that exists only in
memory: the shared client over a transport answering with the bytes a real one
was measured to send (`__tests__/protocol.test.ts` pins the same values). It is
what lets a recording run without hardware, and it must never reach a user:

- only `app/desktop/build.ts` bundles it, and only when `ROADIE_DEMO=1`;
- only the recorder (`app/desktop/demo.ts`) sets `ROADIE_DEMO`, and it rebuilds
  the production bundle when it is done; `make desktop-dist` rebuilds first too;
- no app source imports it (its test does);
- it exports every runtime name of `app/src/native/marshallBle.ts`, the wrapper
  it stands in for, so the recording runs the screen the installers ship.

## What `check-readme` Holds

| Claim | Fails when |
|---|---|
| Links resolve | a relative link or image in `README.md` names a file that does not exist |
| Commands exist | a `make <target>` written as code in `README.md` is not a Makefile target |
| `docs/` is the README's | a file in `docs/` is not shown by the README, or the README shows a picture from outside `docs/` |
| The demo speaker stays out | `build.ts` does not gate it on `ROADIE_DEMO === '1'`, an app source imports it, or the Makefile or a workflow sets `ROADIE_DEMO` |
| The demo speaker is complete | it does not export a runtime name of the wrapper it replaces |

## Never Do These

- Change a command, a path or a platform without the README line that names it
- Edit or hand-draw a picture in `docs/` — regenerate it
- Put a picture the README does not show in `docs/`, or show one from elsewhere
- Import the demo speaker from app code, or set `ROADIE_DEMO` in a build
