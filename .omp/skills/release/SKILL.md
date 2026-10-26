---
name: release
description: Publish a new Roadie version (tag, signed macOS disk image, Sparkle feed; CI adds the Windows, Linux and Android installers) through make release bump=patch|minor|major, install it with make app-install, or roll one back with make unrelease. Use when the user asks to release, deploy, ship, tag a version, or undo a release.
enforced-by: [check-release]
---

# Release

The git tag is the version; `make release` is the only way to make one
(rule://release). `strict-release-route` blocks raw `git tag`, tag pushes and
`gh release` writes; `strict-publish-consent` blocks `make release` and
`make unrelease` unless the current user turn asks for a release. `check-release`
(part of `make verify`) holds the feed URL, the Sparkle key, the installer
workflows and the versions to what the release script publishes.

## Before

1. The change is committed and pushed (`commit` skill), and CI for that commit is
   green: `gh run list --limit 1`.
2. Pick the bump from what changed since the last tag
   (`git log --oneline $(git describe --tags --abbrev=0)..HEAD`): `patch` fixes,
   `minor` new behaviour or settings, `major` a user must change something. If the
   user did not say, propose one and why — do not guess silently.
3. The README's pictures must match what users will get (rule://root-readme).
   If what draws them changed since the last tag, re-record them:

```bash
git diff --stat $(git describe --tags --abbrev=0)..HEAD -- app/src/screens app/src/components app/src/theme.ts app/desktop/demo.ts app/desktop/src/demo app/desktop/src/renderer
git diff --stat $(git describe --tags --abbrev=0)..HEAD -- app/macos/MarshallWidget app/macos/Shared app/macos/CoreTests/WidgetSnapshots
make demo
make widget-snapshots
```

   Look at the result before committing it — extract frames and view them:
   `ffmpeg -ss 0.2 -i docs/demo.gif -frames:v 1 /tmp/demo-0.png`, and again every few
   seconds; open `docs/widgets-light.png` and `docs/widgets-dark.png`. Every speaker in
   them is made up; a real device name or address must never appear. If a scene no
   longer shows what the app does (a changed layout, a new state), fix the script
   (`app/desktop/demo.ts`, `app/macos/CoreTests/WidgetSnapshots/main.swift`) and record
   again. Commit the pictures (`commit` skill) so they are part of the released commit.
   The dry run below prints a note when what draws a picture changed and the picture did
   not.
4. Independent review for user-facing changes (screens, the menu bar behaviour, the
   widget, controls, the update path, anything a user sees or that touches their Mac's
   registration state). Self-verification covers happy paths. Start a reviewer subagent
   that did not write the change, give it the diff since the last tag, and require each
   finding tagged `REPRODUCED` (shown with a command and its output) or `INFERRED`. Fix
   what is reproduced, rerun `make verify`, and commit before the release. The subagent
   prompt carries the cleanup duty: remove what it installed or started (build copies,
   registrations, temp directories, processes) and nothing else, and use
   `HOME=$(mktemp -d)`, never the real home.
5. Dry run — every check, no tag:

```bash
make release bump=patch DRY_RUN=1
```

## Release

```bash
make release bump=patch
```

It prints each step (`==>`): the version, the commits going out, the Release
build, the signed disk image and feed, the tag push, the GitHub release, and a
read-back of the feed the way installed copies fetch it. It stops before tagging
when the repository is not public — installed copies download anonymously.
Report the release URL it prints. Publishing starts `desktop.yml` and `native.yml`,
which attach the Windows, Linux and Android files a few minutes later; check them
with `gh release view <tag>`.

## After

```bash
make app-install
make app-smoke
make doctor
```

`app-install` installs the published disk image into `/Applications` and
unregisters every build copy, so the widget gallery and Spotlight show one Roadie.
`make app-smoke` then drives that installed copy through Accessibility — open
from the menu bar item, close and reopen three times, the opening and the
minimum size — and every step must print `PASS`. It needs the user's GUI
session and Accessibility permission for the terminal, and acts on elements,
never screen coordinates: run it alone, with nothing else clicking in the menu
bar, and report a missing permission instead of skipping it.
`make doctor` must report no problems.

## When It Fails

Read the `release:` line — it names the step.

- Before the tag (branch, dirty tree, unpushed, private repository, tag exists,
  build or signing failed): nothing was published. Fix it and run again.
- The release is missing a file or the feed read-back does not name the new
  version: the tag is public. `make unrelease v=vX.Y.Z`, fix, and release again —
  only if the user agrees.
- An installer workflow failed after the release: the Mac release is public. Fix the
  workflow and release the next version; `make unrelease` only if the release harms
  users (`latest` then falls back to the previous release).

Never re-tag or move a published version; release the next one.
