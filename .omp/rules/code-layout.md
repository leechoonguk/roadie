---
description: Code layout for every language — comments, TypeScript file layout and class member order, whitespace
globs:
      - app/*.js
      - app/*.tsx
      - app/src/**/*.ts
      - app/src/**/*.tsx
      - app/__tests__/**/*.tsx
      - app/desktop/build.ts
      - app/desktop/src/**/*.ts
      - app/mobile/src/**/*.ts
      - app/mobile/src/**/*.tsx
      - app/macos/**/*.swift
      - app/macos/**/*.m
      - app/ios/MarshallBluetooth/*.swift
      - app/android/app/src/main/java/**/*.kt
      - .omp/hooks/**/*.ts
      - .omp/extensions/**/*.ts
alwaysApply: false
---

# Code Layout

Where a declaration sits and what a comment says are read far more often than
they are written. This rule fixes both so a reader finds the same shape in every
file, and so review spends its attention on behaviour instead of arrangement.

Applies to **all code** in the project — the React Native TypeScript and its
package-root config, the Swift and Objective-C under `app/macos/`, and the
harness's own hooks and extensions. Machine-checked by `check-code-layout.ts`
(`make check-code-layout`).

## Coverage

| Surface | Comments | File layout | Class member order | Whitespace |
|---|---|---|---|---|
| `app/src/**`, `app/__tests__/**`, `app/*.tsx`, `app/*.js` | yes | yes | yes | yes |
| `app/desktop/src/**`, `app/desktop/build.ts`, `app/mobile/src/**` (the Windows/Linux and Android platform files) | yes | yes | yes | yes |
| `.omp/hooks/**`, `.omp/extensions/**` | yes + JSDoc header | yes | yes | yes |
| `app/macos/Shared/`, `MarshallBluetooth-macOS/`, `MarshallWidget/` (`.swift`, `.m`, `.h`) | yes | — (Swift's own conventions; `swift-check` reads it) | — | yes |
| The mobile shells: `app/ios/MarshallBluetooth/` (`.swift`), `app/android/app/src/main/java/` (`.kt`) | yes | — (the React Native template's own layout) | — | yes |
| `.omp/rules`, `.omp/skills`, `AGENTS.md`, `RULES.md`, `README.md`, `Makefile`, `Podfile` | — | — | — | yes |

## Comments (every language)

- **A comment explains why, never what.** The code already states what it does;
  the comment carries the reason, the constraint, or the failure it prevents.
- **No commented-out code.** Dead code in a comment is a claim about what runs
  that the runtime does not honour. Delete it — Git remembers. Swift doc
  comments (`///`) are prose and never read as code.
- **No `TODO` / `FIXME` / `XXX` / `HACK` markers.** An intention parked in a
  comment is never found again. Either do it now, or record it where work is
  actually tracked.
- **Every harness hook and lib opens with a JSDoc header** naming what it
  enforces. A hook whose purpose is undocumented cannot be reviewed against the
  rule it serves.

## File Layout (TypeScript / JavaScript)

- Imports first — no declaration precedes the last import.
- Constants after the imports, before the first function.
- **A module constant is `const`, never `let`.** A reassignable constant is a
  lie: compute the value once (a ternary, a helper call) instead of declaring a
  default and patching it two lines later.
- `export default` (a hook's entry point, a screen's component) precedes the
  plain helper functions it calls, so the file reads top-down from its purpose
  to its details.

## Class Member Order (TypeScript / JavaScript)

**fields → `constructor` → public methods → private methods** (`#name`,
`_name`). A class whose constructor sits below its methods hides what the
instance holds; a private helper above the public surface makes a caller scroll
past implementation to find the API.

## Whitespace (every text asset)

Whitespace at a line's end or a file's edge is invisible in an editor and loud
in a diff: it turns a one-line change into a multi-line one and buries the real
edit.

- **No trailing whitespace** on any line.
- **Exactly one final newline** - a file that does not end with a newline has a
  last line that is not a line; two newlines leave a blank line behind.
- **LF only** - never CRLF.
- **Spaces, not tabs** - the sole exception is a `Makefile` recipe, where a tab
  is the language.

## Review Judgement (not machine-checked)

A hook can see that a comment exists, never whether it earns its line. These are
review concerns, and a violation is a review comment, not a failing check:

- A comment that restates the line below it (`// increment i`).
- A doc comment that is technically present and says nothing.
- Swift member order and `// MARK:` sectioning — Swift's own conventions apply.

## Never Do These

- Leave commented-out code, or a `TODO`/`FIXME`/`XXX`/`HACK` marker
- Ship a hook or lib without a JSDoc header
- Declare a module constant with `let`, or patch it after declaration
- Put a TypeScript `constructor` below the methods, or a `#private` above them
- Put a helper function above a file's `export default`
- Leave trailing whitespace, a tab indent, a CRLF line, or a missing/duplicated
  final newline in any text asset
