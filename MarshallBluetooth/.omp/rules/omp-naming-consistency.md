---
description: Naming consistency — rule/hook names must match their actual scope (prefix ↔ globs ↔ paths)
globs:
      - .omp/rules/*.md
      - .omp/hooks/**/*.ts
alwaysApply: false
---

# Naming Consistency

## Purpose

A rule or hook name must reflect what it actually governs. An `app-*` rule that
reads `.omp/` files, or a `check-omp-*` hook that walks `app/`, is a name–scope
mismatch that misleads maintainers and hides where a change belongs. This rule
defines the machine-checkable half of that contract: **name prefix ↔ path
scope**.

This prefix map is **project governance**. OMP exposes rule globs as metadata
and only uses them as a runtime path gate for TTSR; it does not infer scope
from file-name prefixes.

Semantic drift (a rule named `app-native-boundary` that silently stops covering
the widget) cannot be checked mechanically — that stays a review concern.
Structural drift (name says one scope, globs/paths touch another) is checked
by `check-omp-rules.ts` (rules) and `check-omp-hooks.ts` (hooks).

## Scope Prefix ↔ Path Mapping

| Name prefix | Must govern | Example |
|---|---|---|
| `app-` | `app/` paths | `app-native-boundary.md` → globs `app/macos/**`, `app/src/**` |
| `omp-` | `.omp/` paths | `omp-hooks.md` → globs `.omp/hooks/**` |
| `root-` | project-root files (`Makefile`) | `root-makefile.md` → globs `Makefile` |
| *(none)* | cross-cutting — globs span ≥2 top-level dirs | `tooling.md` → `.omp/hooks/**` + `app/**` + `Makefile` |

## Rule Checks (check-omp-rules.ts)

For every rule file in `.omp/rules/`:

1. **Prefix ↔ globs**: an `app-`/`omp-`/`root-` rule must have at least one glob
   starting with the matching top-level directory (`app/`, `.omp/`, or a
   project-root file for `root-`).
2. **Cross-cutting**: a prefix-less rule must have globs spanning ≥2 top-level
   directories.

## Hook Checks (check-omp-hooks.ts)

For every hook file in `.omp/hooks/`:

1. **Name ↔ paths**: a `check-app-*`/`strict-app-*` hook must reference `app`
   paths in its code; `check-omp-*`/`strict-omp-*` must reference `.omp`.
2. **Cross-cutting**: prefix-less hooks (`check-makefiles`, `check-verify`,
   `check-tooling`, `strict-command-routing`, `strict-no-subagents`) are exempt —
   they span multiple scopes by design.
3. **lib modules** are `app-*` (scoped logic) or `hook-*` (guards shared by
   every hook).

## Skill Ownership Checks (check-omp-skills.ts)

The `<name>` slot of `check-<scope>-<name>.ts` carries a third contract: when
its hyphen tokens contain a **skill's** name contiguously, the hook is that
skill's harness. This is ownership, not scope — the `<scope>` prefix still
follows the paths the hook reads. `check-omp-skills` holds it both ways: a hook
named after a skill must appear in that skill's `enforced-by` frontmatter and
in the `verify` prerequisites (rule://omp-skills, "Skill Harness").

## Adding a New Rule or Hook

1. Pick the prefix that matches the scope you actually govern; if it spans two
   or more top-level dirs, omit the prefix — check with `make check-omp-rules`
2. Keep globs (rules) and path references (hooks) inside that scope — check
   with `make check-omp-hooks`
3. Run `make verify` before committing — the naming checks flag any mismatch

## Never Do These

- Name a rule `app-*` but give it only `.omp/` globs (or vice versa)
- Name a hook `check-app-*` but read only `.omp/` paths
- Add a cross-cutting rule/hook with a scope prefix — omit it instead
- Rename a rule/hook without updating its globs/paths to match
