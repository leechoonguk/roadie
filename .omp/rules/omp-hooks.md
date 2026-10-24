---
description: OMP hook conventions - pre/post hooks, rule↔hook mapping, the post-hook contract, rule update workflow
globs:
      - .omp/hooks/**/*.ts
alwaysApply: false
---

# OMP Hooks

## Rule ↔ Hook Mapping

**Project governance contract — not an OMP runtime requirement.** OMP discovers
rules and hooks as separate capabilities. This project additionally requires
every rule in `.omp/rules/` to map to at least one enforcing hook and every
hook to map back to at least one rule. This table is the single source of truth;
`check-omp-hooks.ts` validates it mechanically.

**Separation principle** — each rule maps to at least one enforcing hook. Post
hooks stay within one validation domain; explicitly cross-cutting hooks and pre
hooks may serve several rules. Do not merge unrelated checks merely to reduce
file count.

- A domain rule normally maps to one post hook, plus one lib module when the
  logic is shared.
- A hook whose name carries no scope prefix is cross-cutting, as are `strict-*`
  pre hooks; both may be shared by multiple rules. Membership follows from the
  absent prefix, not from a list of hook names.
- When a new concern is not cross-cutting, split a new rule and hook pair.
- Example: `app-native-boundary.md` → `check-app-native-boundary.ts`.

**lib module naming** — lib modules are prefixed by their scope so checks never
collide:

| Prefix | Scope | Example |
|---|---|---|
| `app-` | App checks (`app/`) | `lib/app-duplicate-blocks.ts` (the duplicated-run detector and the `app/` scan), `lib/app-xcode-project.ts` (the pbxproj and Info.plist reader both Xcode-project checks share), `lib/app-registry.ts` (which Roadie.app copies Launch Services and the widget host know, and unregistering all but the ones to keep — `make run`, `make clean`, `make app-install`), `lib/app-doctor.ts` (`make doctor`, the read-only report on those registrations, the signing environment, the toolchain and Metro — every read fail-loud — and `requireMetro`, which `make run` calls first), `lib/app-release.ts` (`make dist`/`release`/`unrelease`/`app-install`, including `staleDemoNote`, the release-time note that what draws a README picture changed and the picture did not) |
| `hook-` | Cross-cutting guard shared by every hook | `lib/hook-safety-guard.ts`, `lib/hook-dormancy.ts`, `lib/hook-visibility.ts`, `lib/hook-tool-paths.ts`, `lib/hook-scope.ts`, `lib/hook-rule-hint.ts`, `lib/hook-mutating-tools.ts`, `lib/hook-project-root.ts`, `lib/hook-publish-consent.ts`, `lib/hook-metrics.ts` |

`lib/harness-env.d.ts` declares the few runtime globals and the host module the
hooks use; it exports nothing and carries no scope.

**Payload shapes are read in one place.** `lib/hook-tool-paths.ts` answers "which
files is this call about to write": `write` carries `input.path`, while `edit`
names its files in `[path#TAG]` section headers (and `MV` targets) inside the
patch body. Every write-path guard that read only `input.path` ignored `edit`
entirely — measured in the harness this was ported from, where an immutable
file was rewritten with `edit` while its guard stayed silent. The question has
one answer now.

**The project root is the hook's own location.** `lib/hook-project-root.ts`
(the same file, with the same exported names, in ficus, Roadie, Juice and blescope)
derives `projectRoot` from where the hook file lives (three levels above
`.omp/hooks/<lib|pre|post>/`, realpath'd), never from the session's working directory: an
agent session can run in a sibling project of the workspace while this
project's hooks are loaded, and a root taken from `process.cwd()` then judges
the sibling's files by this project's policy — about 40 blocked writes over two
days, each worked around by writing a `.staged` file and moving it. Three
consequences:

- A pre hook that judges a path first asks `isInsideProject(toolPath(path, where))`,
  with `where = eventWithCwd(event, ctx)`; a path outside the project is not this
  harness's business and is never a violation. Relative paths resolve against the
  event's own cwd when it carries one (else the context's, else the project root),
  never `process.cwd()`. A shell or eval command whose `input.cwd` or event cwd is
  outside the project (`commandRunsOutsideProject`) is skipped the same way.
- Containment is `path.relative` over `canonical()` operands (realpath of the
  deepest existing parent plus the rest): `/tmp` → `/private/tmp` and a symlinked
  checkout are inside or outside by where they really are, and a string prefix
  (`…/roadie-x`) is never mistaken for the root.
- `touchesPath`/`touchesStrict` (`lib/hook-scope.ts`) treat an absolute path in
  another project as out of scope even when it contains `app/macos/`.
- `check-omp-hooks` (`checkProjectRootDerivation`) fails any hook, lib or extension
  that reads `process.cwd()` or `ctx.cwd` to derive a path, and requires
  `lib/hook-project-root.ts` itself to use `import.meta.url`. `eventWithCwd` is the only
  reader of the context's cwd. The state directory of `extensions/continuity` is
  `join(projectRoot, ".omp", "state")`, so a sibling's session never writes into this tree.

| Rule (`.omp/rules/`) | Pre Hook | Post Hook |
|---|---|---|
| `app-native-boundary.md` | — | `check-app-native-boundary.ts` |
| `app-duplicate-blocks.md` | — | `check-app-duplicate-blocks.ts` |
| `app-ios-project.md` | — | `check-app-ios-project.ts` |
| `app-macos-project.md` | — | `check-app-macos-project.ts` |
| `app-protocol-parity.md` | — | `check-app-protocol-parity.ts` |
| `code-layout.md` | — | `check-code-layout.ts` |
| `tooling.md` | `strict-tooling.ts` | `check-tooling.ts` + `check-omp-types.ts` (its TypeScript type-checks) |
| `root-makefile.md` | `strict-command-routing.ts` | `check-makefiles.ts` + `check-verify.ts` (runs the gate the table documents) |
| `root-readme.md` | `strict-command-routing.ts` | `check-readme.ts` |
| `root-git-workflow.md` | `strict-verified-git.ts` + `strict-publish-consent.ts` | — |
| `release.md` | `strict-release-route.ts` + `strict-publish-consent.ts` | `check-release.ts` |
| `omp-conventions.md` | — | `check-omp-rules.ts` |
| `omp-naming-consistency.md` | — | `check-omp-rules.ts` (rule prefix↔globs) + `check-omp-hooks.ts` (hook name↔paths) |
| `omp-hooks.md` | — | `check-omp-hooks.ts` + `check-omp-probes.ts` (the pre hooks' verdicts as a table) |
| `omp-skills.md` | — | `check-omp-skills.ts` |
| `RULES.md` (sticky) | `strict-no-subagents.ts` | — |
| `RULES.md` (sticky) | `strict-additive-writes.ts` | — |
| `omp-hook-crash-guard.md` (TTSR trigger) | — | `check-omp-hooks.ts` |

**Project contract:** every rule file must appear in this table (≥1 hook), and
every hook file must appear in this table (≥1 rule). Orphans on either side are
violations.

**TTSR trigger rules** carry a regex `condition` instead of `globs`, so they are
bucketed out of the rulebook and injected at the moment a matching edit is
being streamed. They add no validation domain: each one maps to the post hook
that already owns the invariant, and that hook is therefore exempt from the
one-domain-per-hook split heuristic.

Every trigger is built the same way, and `check-omp-rules` proves it:

| Contract | Failure it prevents |
|---|---|
| `condition` is a quoted string and compiles as a regex | The runtime drops an invalid pattern with a log line nobody reads |
| `scope` is declared | The default also watches assistant prose, so *writing about* a token interrupts the turn |
| `interruptMode` is declared | The machine-global default decides whether an edit is aborted |
| Every ≥4-character identifier in `condition` appears in the body | The injected text does not explain the token that stopped the edit |
| A `## Enforcement` section names the hook that owns the invariant | A trigger becomes a second, undocumented source of truth |
| The condition matches **nothing** in the files its `scope` selects | Rewriting a legitimate line interrupts the turn |
| Every scope stream carries a `fires-on` sample that the real engine fires on | A stream the condition can never match stays registered and silent |

**Splitting workflow** (when a rule/hook grows beyond one domain):

1. Identify the new validation domain
2. Create the rule file `<scope>-<name>.md` with its own globs
3. Create the post hook `check-<scope>-<name>.ts`
4. Move shared logic into `lib/<scope>-<name>.ts` (pure functions,
   scope-prefixed)
5. Register the Makefile target + add the mapping table row
6. Run `make verify` — the split must not change behavior (all checks still pass)

## Unreadable Is a Finding, Never a Pass

A parser that answers "no match" with an empty result retires its whole check
family without a trace — the file exists, compiles, and the comparisons quietly
stop running. Measured twice in one audit of the harness this was ported from:
a reformatted declaration emptied a parser and every comparison behind it
vanished behind a PASS; a renamed constant emptied a set and the CLI crashed on
an index into it.

The rule has two halves. **Tolerate valid formatting** where cheap. **Where the
parser is still defeated, say so**: input the check cannot read is not a clean
state, and the check's own blindness is the finding.

**A parser that reads one half of a pair proves nothing about the other.**
Where two parses must agree, **compare their counts and fail on a mismatch**:
N declared and M read is a file the check misread, whichever of the two is
larger. A check's blindness is discovered by asking it what it saw, never by
watching it pass.

## Scope Equals The Claim

A check must fire on exactly what it asserts. The failure is silent in both
directions: a check that reaches further decides something nobody chose (a
scanner that reads comment prose as code forces a sentence to be reworded), and
a check that reaches less passes while applying to nothing. When writing a
check, state the construct it is about and make the pattern say so — strip
comments before matching code (`check-app-native-boundary` does), and scope by
structure rather than by indentation or line width.

## Directory Structure

```
.omp/hooks/
+-- pre/
| +-- strict-command-routing.ts      # Cross-cutting: blocks direct tool invocations owned by a make target (tsc/eslint/jest/swiftc/pod/xcodebuild/RN CLI, the desktop bundler, the README recorder, electron-builder, electron, gradlew) and truncated gates (`truncatesGate`: a gate redirected to a file passes; the block names both allowed forms); skips a command whose cwd is another project
| +-- strict-no-subagents.ts         # Cross-cutting: blocks task (subagent) creation on an omlx (local) session model; otherwise routes every spawn to Sonnet via before_subagent_spawn
| +-- strict-additive-writes.ts      # Cross-cutting: blocks an edit only when an import/bridge/registration entry would survive nowhere in the file and is still referenced (dedupe, same-patch moves, a cutover that removed every reference, and __tests__/ pass); skips files outside this project
| +-- strict-verified-git.ts         # Cross-cutting: runs make verify before Git commit/push; blocks a commit whose project index differs from its worktree; skips a command running in another project
| +-- strict-publish-consent.ts      # Cross-cutting: blocks a commit/push/release the current user turn did not ask for
| +-- strict-release-route.ts        # Cross-cutting: blocks raw git tag writes, version-tag pushes and gh release writes (make release owns them)
| +-- strict-tooling.ts              # Cross-cutting: blocks writes of Python/Ruby/shell scripts, native sources outside app/macos/ and app/ios/, and root script dirs (write + edit MV); a path outside this project is never a violation
+-- probes.json                        # The pre hooks' verdicts as data: {name?, hook, tool, input, cwd?, turn?, expect} — run by check-omp-probes
+-- post/
  +-- check-app-native-boundary.ts   # Read-only: React-free Swift core/shared/widget, CoreBluetooth only in Native/Core, declaration-only bridge files, NativeModules only in src/native, platform swaps hold, one JS implementation
  +-- check-app-duplicate-blocks.ts  # Read-only: duplicated block runs in app/ sources (delete, don't renumber)
  +-- check-app-ios-project.ts       # Read-only: iOS Xcode project — shared macOS sources in both targets, group. App Group, presses as LiveActivityIntents on iOS 17, background Bluetooth, widget embedded, macOS team
  +-- check-app-macos-project.ts     # Read-only: Xcode target membership, team signing, one App Group, one product name, menu bar residency, Bluetooth declared, one build location (DerivedData.noindex, ESLint ignore), run/clean keep one registered copy
  +-- check-app-protocol-parity.ts   # Read-only: Swift ↔ TypeScript agreement on GATT UUIDs, EQ/volume scales, product-name tokens, press model
  +-- check-code-layout.ts           # Read-only: comments, TS file layout and member order, whitespace (all code), no edit flag left in a file, no Bluetooth address literal in code
  +-- check-tooling.ts               # Read-only: the tooling language policy (TypeScript + Swift only)
  +-- check-readme.ts                # Read-only: README links, make targets and docs/ pictures resolve; the demo speaker stays out of every shipped build
  +-- check-release.ts               # Read-only: Sparkle feed URL, EdDSA key, sandbox installer entitlements, tag-driven versions, Sparkle pod, installer workflows only add assets
  +-- check-makefiles.ts             # Read-only: Makefile ↔ root-makefile.md, verify membership, make targets the harness names
  +-- check-omp-types.ts             # Read-only: tsc --noEmit over .omp/tsconfig.json
  +-- check-omp-hooks.ts             # Read-only: omp-hooks.md directory structure sync + hook contract
  +-- check-omp-probes.ts            # Read-only: every pre hook answers its probe table (.omp/hooks/probes.json)
  +-- check-omp-rules.ts             # Read-only: rule frontmatter, naming, TTSR triggers, no dated history
  +-- check-omp-skills.ts            # Read-only: skills catalog ↔ SKILL.md discovery
  +-- check-verify.ts                # Runs the root make verify (the gate's own runner, outside verify)
```

## Naming Convention

|Type|Prefix|Directory|Pattern|Examples|
|---|---|---|---|---|
|**Pre hooks**|`strict-`|`.omp/hooks/pre/`|`strict-<scope>-<name>.ts`|`strict-command-routing.ts`, `strict-tooling.ts`|
|**Post hooks**|`check-`|`.omp/hooks/post/`|`check-<scope>-<name>.ts`|`check-app-native-boundary.ts`, `check-makefiles.ts` (all scopes), `check-omp-hooks.ts`|

Pre hooks use `strict-<scope>-<name>.ts` — omit `<scope>` when cross-cutting.
Post hooks use `check-<scope>-<name>.ts` — omit `<scope>` when covering all
scopes. Scopes: `app-` (`app/`), `omp-` (`.omp/`).

**The prefix is machine-checked, not stylistic.** Every post-hook contract check
in `check-omp-hooks` is keyed by `check-`, so `post/foo.ts` would be validated by
nothing: no `guarded()` wrapper, no `MUTATING_TOOLS` filter, no safe warning. A
file in `post/` that does not start with `check-` (or in `pre/` without
`strict-`) is a violation on that ground alone.

### The Measured Failure Classes — walk these before writing

Every class below retired a real check in the harness this was ported from
while the gate stayed green. A new hook answers each question **at authoring
time**; the mechanical guard catches the answer you forgot to give.

| Class | The question | Mechanical guard |
|---|---|---|
| **Vanished prerequisite** — `readIfPresent → null → return`, check family retires silently | who owns this file's existence? | `checkSilentPrerequisites` demands `// existence-ok: <reason>` or a reported absence |
| **Defeated parser** — the file exists, the marker regex misses, comparisons run on empty sets | what does my check report when it parses *nothing* from a file that exists? | no general guard — write the sentinel by hand |
| **Vacuous both-ways** — two parsed sets compared, both empty, trivially equal | can both sides of my comparison empty at once, and would I notice? | same sentinel discipline |
| **Skipped-is-passed** — a precondition gate that prints the same PASS either way | does my banner distinguish "checked and clean" from "nothing to check"? | dormancy contract (`dormant()` + `passLine()`) |
| **Silent crash** — a throw in a handler retires the hook for the session | is my body inside `guarded()`? | `checkCrashGuard`, TTSR `omp-hook-crash-guard` |

The common shape: **silence must be earned by looking.** A check may be quiet
because it looked and found nothing — never because a rename, a folder move, a
reformat or a missing file kept it from looking.

### When Adding a New Hook

1. **Determine the hook type:**
   - **Pre hook** — blocks tool execution before it runs (blocking validation)
   - **Post hook** — reports issues after tool execution (read-only check)
2. **Name the file** — `strict-<scope>-<name>.ts` or `check-<scope>-<name>.ts`,
   omitting `<scope>` when cross-cutting.
3. **Create the file** — see the patterns below. A post hook's `tool_result`
   body must run inside `guarded("<hook>", event, () => { ... })` (see *Crash
   Visibility*), or its first exception silently retires the whole check.
4. **Register the target and gate it** — add `check-<name>` to the Makefile,
   add it to the `verify:` prerequisite list, and add it to both the target's
   own row and the `make verify` row in `root-makefile.md`; run
   `make check-makefiles`.
5. **Disable its automatic execution (post hooks only)** — add
   `- hook:post:<file-without-.ts>:<file>.ts` to `disabledExtensions` in
   `.omp/config.yml` (see *Post-Hooks → Execution Model*).
6. **Map it** — add the rule row above and the hook to the directory tree and
   the contract table; run `make check-omp-hooks`.

## Pre-Hooks

Blocking hooks that listen to `tool_call` events and deny specific tool invocations.

- Location: `.omp/hooks/pre/`
- Event: `tool_call` (filtered tools)
- Behavior: denylist pattern matching — first match wins. Patterns are anchored
  to a command boundary (line start, or after `&&` / `||` / `;` / `|` / `(`,
  optional `sudo`), allowing whitespace-free relative-path prefixes (`app/`,
  `./`) but never an argument word — so `ls app/node_modules/.bin/jest` is not
  treated as an invocation.

For hooks that gate an arbitrary tool (like `task`), gate on a fact of the
session, never on a finite `agent` allowlist - omitted, default, or future
agent types bypass it. `strict-no-subagents` gates on the session model's
provider: an `omlx` (local) model blocks the spawn, any other lets it through
and `before_subagent_spawn` pins the child to Sonnet.

### Block recording and probes

A refusal that is wrong costs more than one that is missing, and until it is counted
nobody sees the cost: a stale project root blocked about 40 writes over two days and
left no trace but the transcript. So every pre hook wraps its handler:

```ts
pi.on("tool_call", recordedBlocks("strict-x", (event, ctx) => { … }));
```

`recordedBlocks` (`lib/hook-metrics.ts`) returns the verdict unchanged and, for
`{ block: true }`, appends one line — hook, tool, the head of the reason, milliseconds —
to `.omp/state/hook-metrics.jsonl` (gitignored) through `recordBlock`. `make hook-report`
lists the blocks per hook and the most frequent reasons. The post-hook section of that
report fills in only in a session that enables the post hooks: they are listed in
`disabledExtensions` and run as CLIs through `make verify`, which bypasses `guarded()`.
`check-omp-hooks` requires the wrapper on every pre hook (`checkBlocksRecorded`).

The pre hooks' verdicts are also a table, `.omp/hooks/probes.json`, run by
`check-omp-probes` in `make verify`: a hook change that flips a verdict fails the gate
before a session finds out. A new pre hook ships with a case; a new failure class is a
new case, not a note.

### Reading the edited path (`path-raw-ok`)

An anchored edit does not hand the hook a clean path: it carries a content tag,
`app/App.tsx#0D77`. A guard that matches that string against an allowlist, an
extension test or a directory prefix is matching a path that exists nowhere —
so it either refuses a legitimate edit or waves it through in silence. Strip the
tag where the path is read:

```ts
const path = String(event.input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
```

The field can also be absent. A patch-form edit arrives as
`{ input: "[relative/path#TAG]\nPUT 12.:\n+..." }` with no `path` at all. When
the target matters, read the patch header as a fallback — and when neither is
there, fail open (a pre hook that throws costs the agent the whole tool call).

`check-omp-hooks` requires every `input.path` read under `pre/` to strip the tag
on the spot, or to carry `// path-raw-ok: <reason>` within the five lines above
it.

### Every execution channel (`channel-ok`)

Commands do not only arrive through `bash`. The `eval` tool carries a Python or
JS body in `input.code`, and that body reaches the same binaries through
`subprocess.run([...])` or `execSync(...)`. A guard that inspects a command
string accepts `eval` as well, reads `input.code` next to `input.command`, and
gives the same guidance on both channels. If the policy really is shell-shaped,
say so with `// channel-ok: <reason>`.

### The context parameter is not readable (`ctx-ok`)

A `tool_call` handler's second argument is the extension context. An exception
thrown inside a pre hook is promoted to a **tool failure**: the tool call dies
and the agent receives the crash instead of its result. The decision to block is
made from `event` alone and the parameter is written `_ctx: unknown`. If a hook
genuinely needs it (the session's cwd through `eventWithCwd`, which reads it inside a
`try`, or the session branch for consent), it says why with `// ctx-ok: <reason>`.

## Post-Hooks

Read-only hooks that listen to `tool_result` events. Never block tool calls.

- Location: `.omp/hooks/post/`
- Event: `tool_result`
- Validation: `make verify` (or the individual `make check-*` targets) runs the
  same checks on demand via CLI. Each hook file guards its CLI entry with
  `process.argv[1]` detection — the same code path runs both inline and on
  demand.

### Execution Model — the closing gate, not a per-tool-call tax

Post hooks do **not** run automatically. Every file in `.omp/hooks/post/` is
listed in `disabledExtensions` in `.omp/config.yml`, so the runtime never loads
it as a `tool_result` listener; the checks reach the tree through the root
`make verify` (every post hook but `check-verify` is a `verify:` prerequisite).

Measured in the harness this was ported from: post hooks cost 3.8s per
mutating tool call, against one gate run of ~52s — a break-even of 14 calls in
sessions that averaged ~150.

What this changes for an author:

- A new post hook needs its `hook:post:<tool>:<file>` id in `.omp/config.yml`.
  The id format is the hook capability's `toExtensionId`
  (`hook:<type>:<tool>:<name>`, `<tool>` = filename without its extension) —
  see `omp://extension-loading.md`. `check-omp-hooks` fails when a post hook is
  missing from that list, or when the list names a file that no longer exists.
- A check reports only when the gate runs, so its message must stand alone
  without the tool call that caused it — the *Warning Shape* contract is what
  keeps it readable.
- That single run happens at commit: `make commit` and `make push` depend on
  `verify`. The finish gate in `.omp/extensions/continuity/discipline.ts` only
  requires that *some* verification covering the change — `make test`,
  `make lint`, `make typecheck`, `make swift-check`, a `make check-*` —
  succeeded after the last change.
- Pre hooks (`.omp/hooks/pre/strict-*.ts`) stay loaded. They *block* destructive
  calls before they land, which no after-the-fact gate can undo.

### Post-Hook Validation Scope

Each post hook owns a single concern. `check-omp-hooks.ts` requires every post
hook to appear in this table: a hook whose checks are undocumented cannot be
reviewed.

|Hook File|Validates|Checks|
|---|---|---|
|`check-app-native-boundary.ts`|The React Native ↔ native boundary under `app/`|`Shared/`, `Native/Core/`, `MarshallWidget/`, `CoreTests/` Swift: no `import React*`, no `RCT…` symbol; `import CoreBluetooth` only under `Native/Core/`; `Native/*.m` holds only `#import`/`RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD`/`@end` (no `@implementation`, no `{`) and pairs with `Native/<stem>.swift`; adapter `@objc` instance selectors equal the `.m`'s `RCT_EXTERN_METHOD` selectors both ways (arguments need an explicit `@objc(selector:)`; read counts compared against declared counts); `NativeModules` read only in `app/src/native/*.ts` within `app/src/`, `app/desktop/src/`, `app/mobile/src/` + `App.tsx`/`index.js` (tests may mock it); every swap in `app/desktop/build.ts` and `app/metro.config.js` names an existing wrapper and an existing replacement that exports every runtime name of the wrapper, every wrapper that reads `NativeModules` is swapped in both, and a swap file that parses to no swap is reported; no file under `app/desktop/src/` or `app/mobile/src/` declares a function or constant that `app/src/protocol.ts`, `app/src/controls.ts` or `app/src/ble/client.ts` exports; no `UserDefaults(suiteName:)` in native Swift (app ↔ widget state goes through `SharedStore` files); every method a protocol extension defines is declared by that protocol (matched by name and argument labels, protocols collected across all native trees; an unreadable body is reported); no `ProgressView`, `Toggle`, `Slider`, `TextField` or `Picker` in `MarshallWidget/` (AppKit-backed controls that WidgetKit and `ImageRenderer` draw as placeholders); comments are stripped first; dormant (`absent`) without `app/macos/`|
|`check-app-duplicate-blocks.ts`|Duplicated block runs in `app/` sources (TS, Swift, Objective-C, Kotlin — `app/src`, `app/__tests__`, `app/desktop/src`, `app/mobile/src`, the macOS native trees, the iOS and Android shells; data formats exempt)|A non-overlapping repeat of 24+ identical consecutive lines (≥8 distinct) is a duplicated block — report it and instruct deletion, not renumbering|
|`check-app-macos-project.ts`|The Xcode project for the macOS app (`app/macos/`), the Makefile's `run`/`clean` recipes and `app/.eslintrc.js`|Every `.swift`/`.m` under a target's tree (and `Shared/`) is in that target's Sources phase, no stale or cross-tree reference, no two sources share a file name; every configuration signing with entitlements names a `DEVELOPMENT_TEAM`; both entitlements files and both Info.plists name one `$(TeamIdentifierPrefix)…` App Group; the app's `PRODUCT_NAME` equals every `CFBundleDisplayName`; an `LSUIElement` app returns `false` from `applicationShouldTerminateAfterLastWindowClosed`; a CoreBluetooth app declares `NSBluetoothAlwaysUsageDescription` and, sandboxed, `com.apple.security.device.bluetooth`; one build location — the workspace settings, every `xcodebuild`, `DERIVED_DATA` and the release builder name `app/macos/build/DerivedData.noindex` and ESLint ignores `macos/build/**`; `make run` probes Metro on port 8081 before `$(MAKE) build`, unregisters the Release widget and every other registered copy, and `make clean` unregisters build copies before deleting them; declared-vs-resolved source counts compared so a defeated parse reports; dormant (`absent`) without the project file|
|`check-app-ios-project.ts`|The Xcode project for the iOS app (`app/ios/`), which compiles the macOS sources|The app target compiles its own tree, `Shared/`, `Native/*.swift`+`*.m`, `Native/Core/` less AppKit files, and every widget file declaring an `AppIntent`; the widget target compiles `Shared/`, `MarshallWidget/` and the press core (`MarshallScanner`, `MarshallProtocol`, `OneShotSession`); every compiled reference resolves under `app/ios/` or `app/macos/`; no widget source imports React; both Info.plists and both entitlements name one `group.` App Group; every widget `AppIntent` is a `LiveActivityIntent` under `#if os(iOS)`; every configuration deploys to iOS 17+; the app declares `NSBluetoothAlwaysUsageDescription` and `bluetooth-central`; a PlugIns copy phase embeds an `.appex`; every configuration signs with the macOS project's single team; declared-vs-resolved source counts compared; dormant (`absent`) without the project file|
|`check-app-protocol-parity.ts`|Swift ↔ TypeScript agreement on the speaker protocol and the press model|`UUIDS` (`app/src/protocol.ts`) equal `MarshallScanner`'s `CBUUID(string:)` constants by name (16-bit forms expanded); `EQ_STEPS` and `FALLBACK_MAX_VOLUME` equal `EQScale` and `VolumeScale`; the product-name token sets are equal; `ControlAction`/`ControlChange` kinds (`app/src/controls.ts`) equal the Swift enums' cases (`Shared/ControlStep.swift`); a side that parses to nothing is reported, never compared; a missing file is reported; dormant (`absent`) without `app/src/protocol.ts`|
|`check-code-layout.ts`|Code layout across every code surface (`app/` TS + package-root config, `app/desktop/` and `app/mobile/` TS, `app/macos/` Swift/ObjC, the iOS shell's Swift and the Android shell's Kotlin, `.omp/hooks/`, `.omp/extensions/`)|No commented-out code, no work markers; JSDoc header on every hook/lib; TS/JS imports → constants → `export default` → helpers, never `let` for a module constant; TS class members fields → constructor → public → private; whitespace on every text asset (no trailing whitespace, no tab indent outside the Makefile, LF only, exactly one final newline); no line of any text asset carries the edit flag the write guard accepts (`//`, `#`, `<!-- -->` or `*` followed by the words `intent: replace`) — it is an instruction to one edit, never content; no Bluetooth address literal (six hex bytes joined by `:` or `-`) in any code surface except the documented placeholders (`AA:00:00:00:00:0n`, all-zero)|
|`check-tooling.ts`|Tooling language policy across the project|No `.py`/`.rb`/`.sh`/`.bash`/`.zsh` anywhere; `.swift`/`.m`/`.mm`/`.h` only under `app/macos/` and `app/ios/`; `.omp/hooks/` and `.omp/extensions/` TypeScript only (except `.omp/hooks/probes.json`); no project-root `scripts/`/`tools/`/`bin/`/`utils/`; scripts only under `.omp/hooks/`, `.omp/extensions/`, `app/`; every `check-*` target runs `node .omp/hooks/...`; extension `ctx.compact/shutdown/abort` rejections handled|
|`check-readme.ts`|`README.md` and its pictures (`docs/`) ↔ the code, and the demo speaker that records them (`app/desktop/src/demo/`)|Every relative link and image in the README names an existing file (fenced and inline code is not a link); every `make <target>` the README writes as code is a Makefile target; every file in `docs/` is shown by the README and every picture it shows is in `docs/`; `app/desktop/build.ts` bundles the demo speaker only behind `process.env.ROADIE_DEMO === '1'`, no file under `app/src`, `app/desktop/src`, `app/mobile/src` (or `App.tsx`, `index.js`, `metro.config.js`) outside the demo directory imports it, and neither the Makefile nor a workflow sets `ROADIE_DEMO`; the demo speaker exports every runtime name of `app/src/native/marshallBle.ts`; dormant (`absent`) without `README.md`|
|`check-release.ts`|The in-app update path on every platform (`app/macos/` plists, entitlements, Podfile; `app/desktop/package.json`; `app/src/updates.ts`) ↔ `lib/app-release.ts`, and the installer workflows (`.github/workflows/desktop.yml`, `native.yml`)|App `SUFeedURL` equals `FEED_URL` from `lib/app-release.ts`; `SUPublicEDKey` is a 32-byte base64 EdDSA key; a sandboxed app sets `SUEnableInstallerLauncherService` and holds the `$(PRODUCT_BUNDLE_IDENTIFIER)-spks`/`-spki` mach-lookup exceptions; both Info.plists read `$(MARKETING_VERSION)`/`$(CURRENT_PROJECT_VERSION)`; the Podfile declares the `Sparkle` pod; dormant (`absent`) without the app Info.plist; each installer workflow exists, runs on `release: types: [published]`, limits its push trigger to branches, guards every `gh release upload` step with `if: github.event_name == 'release'`, and uploads no name or glob (the command's and the matrix `assets:` entries) matching a `RELEASE_ASSETS` file; `app/desktop/package.json` `build.publish` is github `RELEASE_REPO`, `desktop.yml` uploads `latest.yml` and `latest-linux.yml`, and `app/src/updates.ts` `RELEASE_REPO` equals `RELEASE_REPO`; `release()` in `lib/app-release.ts` calls `requirePublicRepository()` before it tags|
|`check-makefiles.ts`|Makefile ↔ `root-makefile.md`|Documented targets exist and actual targets are documented; every target has `##` help; no catch-all rule; `node .omp/...` recipes point at existing files; every post hook has its `check-<name>` target; **verify membership** — every post-hook target except `check-verify` is a `verify` prerequisite and `check-verify` is not, and the prerequisite list equals the `make verify` row (both directions); every `make <target>` written as code in the harness exists|
|`check-omp-types.ts`|Harness TypeScript type-checks|`tsc --noEmit` over `.omp/tsconfig.json` with `app/node_modules/typescript`; reports the first 3 `error TS` lines|
|`check-omp-hooks.ts`|`.omp/hooks/` ↔ `omp-hooks.md` + hook contract + rule↔hook mapping|Directory tree ↔ disk both ways; this contract table covers every post hook; `post/check-*` and `pre/strict-*` prefixes; lib names `app-*`/`hook-*`; post hooks call `buildSafeWarning(event.toolName, "<hook>", issues, fixHint)` + `wrapWarning`, never `lastWarning`, never block, route every `tool_result` body through `guarded("<hook>", event, …)`, gate on `MUTATING_TOOLS`, declare a path scope, name an anchor for existence demands, call `printRuleHint` in the CLI tail and resolve a rule; pre hooks return `{ block: true }`, strip the path tag, cover `eval`, and do not read `ctx`; scoped hook names reference their paths; only `check-verify` runs a gate binary; harness guardrails; every post hook listed in `disabledExtensions`; literal warnings name a place; **project root** — no hook, lib or extension reads the session's working directory (`process.cwd` or `ctx.cwd`) to find its root; `lib/hook-project-root.ts` derives it from the hook file's own location|
|`check-omp-probes.ts`|The pre hooks' verdicts (`probes.json` ↔ `pre/`)|Every case `{name?, hook, tool, input, cwd?, turn?, expect}` is fed to the real pre hook through a fake `pi` (event and context carry the case's cwd; `turn` is the latest user message); the verdict equals `expect`; every pre hook has a case; the table holds a `mention` (text that does not run), `dry-run`, `sibling-path`, `sibling-cwd`, `gate-redirect` (redirect then `echo EXIT=$?`) and `gate-piped` case; `OMP_HOOK_PROBE=1` keeps probe blocks out of the metrics|
|`check-omp-rules.ts`|Dynamic rule-loading contract|`AGENTS.md` has no `@rules/` imports; no `rules/RULES.md` shadow; valid frontmatter (`description`, `globs`, `alwaysApply=false`); always-apply set ≤ 2; `app-`/`omp-`/`root-` prefix ↔ globs, prefix-less only when globs span ≥2 top-level dirs; procedure sections ordered and verified; no duplicated line in a code fence; reference snippets match their files; TTSR triggers well-formed, documented, clean against their scope, live per stream (`omp ttsr test`); no dated history under `.omp/`|
|`check-omp-skills.ts`|`.omp/rules/omp-skills.md` ↔ `.omp/skills/` catalog|Every discovered `SKILL.md` has one catalog row and every row a `SKILL.md`; `name` matches its directory; `description`, Trigger, Verification non-empty; Lifecycle `active`/`deprecated`; **skill harness contract** — `enforced-by` equals the name-derived hook set, each declared hook exists and is a `verify` prerequisite, a procedure skill references a `rule://` domain|
|`check-verify.ts`|The root gate|Runs `make verify` (lint, typecheck, test, swift-check and every other harness check) and quotes the last failing lines; skips explicit `make` commands; not a `verify` prerequisite because it runs `verify`|

### Crash Visibility

The extension runner catches a `tool_result` handler's exception, hands it to
`emitError(...)` and continues: the throw never reaches the conversation and the
handler's `{ content }` override is dropped. A hook that dies on its first tool
call therefore enforces nothing for the rest of the session while `make
check-<hook>` still passes by hand — a dead check reads exactly like a passing
one.

So every post hook's handler body runs inside `guarded()` from
`lib/hook-visibility.ts`:

```ts
pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) =>
  guarded("check-omp-rules", event, () => {
    // the check itself, unchanged
  }));
```

A throw is then reported three ways: a one-line `<system-notice>` appended to
the tool result (capped at 2 per hook + message), an uncapped line in
`.omp/state/hook-crash.log` (gitignored, outlives the session), and stderr. The
original tool content is always preserved, and the crash is never rethrown —
one broken hook must not decide what the others get to report.

`check-omp-hooks` rejects a post hook that does not import `guarded`, or whose
`guarded()` name does not match its file name. Wrappers are **counted** against
`pi.on("tool_result")` registrations, so a second handler added later cannot
slip in bare.

**Pre hooks are a documented exception.** The runtime turns a `tool_call`
handler's throw into a block, so a broken pre hook announces itself by refusing
every tool call it filters — loudly, immediately, and without a wrapper.

### Rule Attribution

Every check's CLI tail calls `printRuleHint("check-<self>")` (from
`lib/hook-rule-hint.ts`) before reporting failures, so a red `make verify`
prints `Rule: rule://<name> — <description>` and the agent can read the
governing rule instead of rediscovering its requirements one failure at a
time. The check-name → rule-name mapping lives in `hook-rule-hint.ts`
(`RULE_NAME_EXCEPTIONS` for non-1:1 names, existence-verified);
`check-omp-hooks` requires the call on every CLI tail and a resolving rule for
every check not listed in `NO_RULE_CHECKS`.

### Warning Shape

An issue line names **where**, **what**, and **how**:
`app/src/screens/Home.tsx:12: reads NativeModules — import the wrapper instead`.
The line number belongs there whenever the check has it. A warning that names
no file sends the reader to grep the tree, so `check-omp-hooks` rejects any
literal `issues.push("...")` string that mentions no file or directory.

### Dormant Checks

A check that only asserts something when the feature exists must not print the
same PASS whether the code was compliant or simply absent. A feature-gated hook
returns `dormant("<hook>", <cause>, "<why>")` from `lib/hook-dormancy.ts` and
prints its banner through `passLine(...)`:

```
PASS: React Native ↔ native boundary holds (dormant — absent: no app/macos/ native tree)
```

Dormancy has exactly two causes, and `DormantCause` admits no third:

|Cause|Means|True where|
|---|---|---|
|`absent`|the feature the check guards is not in the code|every environment — nothing to fix|
|`service`|the check compares the code with a running service this environment lacks|a clean clone; the same check runs in full wherever the service is up|

**Anything else is a failure, not dormancy.** A check that could not read the
code it guards is broken, and says so as an issue. `check-omp-hooks` rejects a
hook whose header claims "Optional feature" while it never calls `dormant()`.

### Scope Resolution

Scoped hooks must reference their scope through a direct path (`app/`,
`.omp/`) or delegate through a matching scope-prefixed lib module. Prefix-less
hooks are cross-cutting.

**Never construct notices or deduplication inline** — direct `lastWarning` state
and manual `return { content: [...] }` paths bypass the shared content-length
protection and can hide the tool result, causing an infinite loop.

**Context economy** — three guards keep post hooks from wasting context when
they do run per tool call:

1. **Tool filter**: read-only tools cannot change files, so the check is skipped
   after them. Only mutating tools (`write`, `edit`, `bash`, `eval`,
   `ast_edit`, `lsp`, `browser`, `hub`, `task`) trigger the check.
2. **Shared warning guard**: at most three issue lines; long tool output gets a
   one-line notice; the same hook/issue warning is injected at most twice
   across tools and resets only when the issue set resolves.
3. **Path gate**: a hook runs only when the event touched its domain. Import
   `touchesPath` (path-bearing events only; shells pass) or `touchesStrict`
   (also reads the shell command) from `lib/hook-scope.ts` and gate right after
   the tool filter; a hook that must see everything says so with a
   `// hook-scope: global — <reason>` comment.

```ts
const warning = buildSafeWarning(
  event.toolName,
  "check-omp-rules",
  issues,
  "run make check-omp-rules for details",
);
if (warning === null) return;
console.error(warning);
return { content: wrapWarning(warning, event.content, "check-omp-rules") };
```

### Demand direction (요구는 의존 방향으로)

검사는 **존재하는 하류가 상류를 요구**한다. 작업의 첫 걸음에서 마지막 걸음을 요구하지 않는다.
이 지적들이 도구 결과에 주입되면 작성자는 그 목록을 작업 큐로 읽는다 — 한 계층만 손보려던
작업이 기능 전체로 번지는 경로가 이것이다.

파일이나 등록의 **부재**를 지적하는 문장은 둘 중 하나여야 한다 — `check-omp-hooks` 가 강제한다:

- **앵커 명시**: 무엇 때문에 요구가 생겼는지 메시지가 밝힌다
  (`Native/X.m: exists but Native/X.swift is missing`).
- **`// premature-ok: <사유>`**: 어느 단계에서든 참인 요구다(예: 프로젝트 기반 파일의 부재는
  작업 순서가 아니라 설정 결함이다).

내용 검사(선언·메서드 부재)는 대상이 아니다 — 이미 존재하는 파일의 속성이기 때문이다.

## Break It Once, Before You Trust It

A check that passes proves nothing about a dirty tree; it may be asleep.

**When you add or change a claim, violate it once and paste the failure into the
commit message.** Plant the smallest violation (edit and revert), run the owning
check, and read *which* message fired. Reading the message matters more than the
exit code: a falsification that also trips a neighbouring claim can read as a
pass of the one under test.

A standing mutation suite was built and removed in the harness this was ported
from: its finds were mostly its own bugs, and every real parser defect was found
by an ad-hoc probe written for one question while the check was being written.

## Harness Construction Guardrails

These are correctness constraints, not style preferences. `check-omp-hooks.ts`
enforces the machine-checkable parts.

1. **One policy decision source.** A pre hook and its post checker import the
   same helper for a decision. Do not duplicate path, tag or command parsing in
   each hook (`lib/hook-tool-paths.ts`, `lib/hook-scope.ts`).
2. **Post results preserve evidence.** Post hooks never block. Every warning
   uses `buildSafeWarning()` and `wrapWarning(warning, event.content, ...)`;
   the wrapper appends the original result before its notice.
3. **Suppress by violation, not tool.** A warning's repeat limit is keyed by
   hook and issue set. Changing from `edit` to `bash` must not restart a loop.
4. **Do not nest explicit verification.** `check-verify` detects
   `event.input.command` starting with `make` and returns without nesting.
5. **Accept valid formatting.** Harness validators match syntax flexibly;
   formatting a handler across lines must not turn a working hook into a
   false failure.
6. **A crash is a finding, not silence.** Every post hook's `tool_result` body
   runs inside `guarded()` from `lib/hook-visibility.ts`.

## Rule Update Workflow

When adding/updating rule files in `.omp/rules/`:

1. Edit the rule file (any tool — no pre hook restricts `.omp/rules/`)
2. Run `make check-omp-rules` and `make check-omp-hooks` to validate the
   dynamic-loading contract and the mapping
3. Resolve any discrepancies

## Authoring Invariants (enforced by `check-omp-hooks`)

| Invariant | Why |
|---|---|
| Every post hook gates on `MUTATING_TOOLS` | a check that runs after a read spends context on a turn that changed nothing |
| Every post hook declares a path scope (`touchesPath`/`touchesStrict`) or a `// hook-scope: global — <reason>` | a check that runs on events outside its domain spends the agent's wall clock, not just context |
| Only `post/check-verify.ts` may execute a gate binary (`make`, `npm`, `npx`, `jest`, `tsc`, `eslint`, `swiftc`, `xcodebuild`, `pod`) | the gate is the dominant hook cost, and a second runner races the agent's own `make` |

## Never Do These

- Run the project gate (`make verify`, `make test`, `npx jest`, `swiftc`) from
  any post hook except `check-verify` — read files instead
- Put blocking logic in post hooks — they can't block tool calls
- Mix pre and post hooks in the same directory
- Forget to keep `.omp/hooks/` and `omp-hooks.md` in sync
- Register a `tool_result` handler whose body is not wrapped in `guarded()` — the
  runner swallows the throw and the hook goes quiet for the rest of the session
- Match a raw `input.path` in a pre hook — strip the anchored-edit content tag
  (`#0D77`) first, or the guard judges a path that exists nowhere
- Gate a command policy on `bash` alone — `eval` carries the same command in
  `input.code`
- Read a pre hook's context parameter — a throw there is promoted to a tool
  failure and the agent loses the call
