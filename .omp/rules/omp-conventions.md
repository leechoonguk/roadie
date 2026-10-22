---
description: Rule conventions — how to write .omp/rules files, frontmatter, content structure, naming
globs:
      - .omp/rules/*.md
alwaysApply: false
---

# Rule File Conventions

## OMP Runtime Behavior

Rules load **dynamically** — never import them into `AGENTS.md`. OMP buckets
`.omp/rules/*.md` at session start:

| Bucket | OMP condition | Loading |
|---|---|---|
| Rulebook | `description` present; not accepted as TTSR; not always-apply | Name + `globs` + description listed in the system prompt; content read on demand via `rule://<name>` |
| Always-apply | `alwaysApply: true`; not accepted as TTSR | Full content injected into every session |
| TTSR | Accepted `condition` or `astCondition` | Activated only while the text/tool stream matches the trigger |

**TTSR globs trap**: on a TTSR rule, `globs` is a **runtime path gate** — the
match context must include at least one file path. `bash` tool calls never
carry file paths, so a globbed TTSR rule **never triggers on shell commands**.
For workflow rules triggered by bash, omit `globs` entirely and rely on
`condition` alone.

**Every scope stream carries a liveness sample.** A TTSR rule's body declares,
per glob (one sample covers its edit/write pair) and per bare stream:

    <!-- fires-on tool:bash: npx jest --watch -->
    <!-- fires-on app/src/screens/*.tsx: NativeModules.MarshallBle -->

`check-omp-rules` tests the condition against each sample. A dead stream cannot
be detected mechanically in general (a forbidden-token rule *should* match
nothing in the tree), but an author who cannot write a sample for a stream has
just discovered that the condition can never fire there. Measured in the
harness this was ported from: an edit narrowed `condition` to command shapes
while adding a file-writing stream the regex could not match; every other
frontmatter check passed, and the sample requirement is what stops it.

**Quoted conditions must tolerate JSON escaping.** Tool arguments may reach the
stream serialized — measured: `pi.on("tool_result"` fired the crash-guard while
`pi.on(\"tool_result\"` did not, until the condition gained `\\?` before each
quote. Any condition containing `"` or `'` needs the same. `check-omp-rules`
runs the proof itself: each glob's sample goes through `omp ttsr test --rule`
(the real engine — glob routing, source selection, and the serialized variant
when the condition carries a quote), cached by rule-content hash in
`.omp/state/` so an unchanged rule costs zero engine calls. A failure prints the
exact repro command. Hosts without the omp CLI fall back to the regex floor.

**How-to sections follow the ordered-verified structure.** `check-omp-rules`
enforces the mechanical half on every `##` section titled as a procedure
(Add/Create/Build/New):

- **Ordered steps**, not an artifact list — say *when*, not only *what*.
- **Each step names its own verification** (a make target, or the owning
  `rule://`) — never one pile of checking at the end.
- **Apply what you generate immediately** — an unapplied artifact makes every
  later verification fail on it instead of on the actual work.
- **No task hints** — a rule teaches the general principle; task briefs point
  here instead of carrying answers.

**A rulebook entry delivers nothing but its description line.** `globs` are not
used to select rulebook content: editing a matching file injects no body, so a
rulebook rule is the *documentation* of an invariant that a hook enforces
mechanically. When an invariant must reach the model at the moment it is about
to be broken, that is a TTSR trigger — not a longer rulebook entry.

**The harness carries no dated history.** A rule states an invariant; a hook
comment states the reason a constant or branch exists. The dated incident that
produced either belongs in the commit message that changed it.
`check-omp-rules` refuses a `YYYY-MM-DD` anywhere under `.omp/` (rules, hooks,
skills, extensions, `AGENTS.md`, `RULES.md`); a line that must show a dated
*format* marks itself `history-ok`.

## TTSR Trigger Rules

A TTSR trigger is a small rule whose whole body is injected mid-stream, so it is
written to be read once, under interruption: state the construct, the
replacement, the enforcing hook, and `rule://<full-rule>` for the rest.

| Frontmatter | Required | Why |
|---|---|---|
| `condition` | yes | Regex, **quoted string** (a YAML list registers at runtime but reads as a rulebook rule to `check-omp-rules`, so the two disagree) |
| `scope` | yes | The default watches assistant prose and every tool argument — a code-token trigger would fire on *writing about* the token. Code triggers cover every file-writing tool with the same glob — `tool:edit(<glob>), tool:write(<glob>)` |
| `interruptMode` | yes | Otherwise the machine-global default decides whether an edit is aborted |
| `globs` | no | Redundant once `scope` carries path globs, and fatal for bash-triggered rules (see the globs trap above) |

**Match the construct, not the word.** A comment that exists to explain a ban
must not fire the ban; require the call, the import, or the statement shape.

**Prove it before trusting it.** `omp ttsr test --source tool --tool edit --path
<file> '<snippet>'` must fire on the violating construct and stay quiet on the
comment, on the legal location, and on prose; the condition must match nothing
in the files its scope selects (`check-omp-rules` scans them), or every
legitimate rewrite of those lines interrupts a turn.

**Register the trigger.** Add a mapping row in `omp-hooks.md` pointing at the
post hook that already owns the invariant. A trigger adds no validation domain:
it delivers early what the hook proves late.

## Project Rule File Policy

The following structure is project governance layered over OMP's runtime; OMP
itself permits optional `globs` and does not require this exact layout.
`RULES.md` (top level of `.omp/`, not `rules/`) is this project's sticky rule;
do not duplicate it under `.omp/rules/`.

## Rule File Structure

Every rule file in `.omp/rules/` follows this exact format:

```
---
description: <short description>
globs:
      - <relative path patterns>
alwaysApply: false
---

# <Title>

<content sections follow>
```

### Frontmatter

| Field | Project requirement | Format | OMP runtime note |
|---|---|---|---|
| `description` | Yes | Sentence fragment | Required for rulebook visibility |
| `globs` | Yes for rulebook rules | Indented list | Optional metadata in OMP; runtime path gate only for TTSR |
| `alwaysApply` | Yes, set to `false` | `false` | OMP supports `true`; this project reserves sticky guidance for `.omp/RULES.md` |

**Indentation:** globs use 6-space indent from the `globs:` line.

### Content Sections

| Section | Purpose | Pattern |
|---|---|---|
| `# <Title>` | Main topic | Matches rule name: `app-native-boundary.md` → `# App Native Boundary` |
| `## Adding a New <Thing>` | How-to | Numbered steps, each naming its verification |
| `## <Topic> Conventions` | Rules | Bullet lists |
| `## Never Do These` | Anti-patterns | Negative bullet list |

### Directory Naming

Prefix with the scope:

| Prefix | Scope | Examples |
|---|---|---|
| `app-` | The React Native app and its native code (`app/`) | `app-native-boundary.md`, `app-duplicate-blocks.md` |
| `omp-` | Harness (`.omp/`) | `omp-conventions.md`, `omp-hooks.md` |
| `root-` | Project-root files (`Makefile`) | `root-makefile.md`, `root-git-workflow.md` |
| *(none)* | Cross-cutting (globs span ≥2 top-level dirs) | `tooling.md`, `code-layout.md` — `.omp/` + `app/` (+ `Makefile`) |

`check-omp-rules.ts` allows a prefix-less filename only for a rule whose `globs`
span more than one top-level directory.

## File Naming

- **lowercase**, hyphen-separated: `app-native-boundary.md`
- New rules: create `.omp/rules/<scope>-<name>.md` — nothing else. The rulebook
  picks it up automatically; do **not** add any `@rules/` entry to `AGENTS.md`.
- Set `globs` to the paths the rule governs — they gate TTSR matching and are
  shown in the rulebook listing.

## Extensions (`.omp/extensions/*.ts`)

Workspace-local extensions auto-load into every omp session started in this
project.

- Entry point first: `export default function` before helper functions
  (`check-code-layout` enforces top-down reading order on these files too).
- Node builtins (`node:fs`, `node:path`) need `// @ts-expect-error — Node
  builtin, not project-compiled` above the import (`check-omp-types`).
- Prefer triggers that fire **only when the session is unhealthy** (red
  finishes, unverified finishes). Triggers that cannot tell health from
  sickness fire during productive work and cost re-reads.

## Before the Hook Is Written

A rule states an invariant; the hook makes it mechanical. Before writing the
hook, walk `omp-hooks.md` → *The Measured Failure Classes*: the ways a check
kept reporting PASS after it stopped looking. A rule whose hook can go silently
blind documents an invariant nobody holds.

## Never Do These

- Add rules outside `.omp/rules/` directory
- Import rules into `AGENTS.md` via `@rules/...` — rules load dynamically (rulebook + `rule://<name>`)
- Use `alwaysApply: true` — all rules use `false`; sticky needs belong in `RULES.md`
- Name a rule file `RULES.md` — it shadows the sticky `RULES.md`
- Skip `description` field — it must match the rule's scope
- Use 4-space indent for globs — use 6 spaces
- Merge unrelated topics into one rule file
- Forget to update `globs` when changing the rule's scope
- Scope a workflow-mandating TTSR to `tool:bash` only — a model that hand-writes
  the protected files never triggers it; cover every tool path that can bypass
  the workflow, or enforce it in a pre hook
