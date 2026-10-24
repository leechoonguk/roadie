---
description: OMP skills catalog and discovery conventions
globs:
      - .omp/skills/*/SKILL.md
      - .omp/rules/omp-skills.md
alwaysApply: false
---

# OMP Skills Governance

## Runtime Contract vs Project Governance

OMP discovers skills only from `.omp/skills/<name>/SKILL.md`; explicit `name`
and `description` are runtime metadata. The catalog below is **project
governance** for authoring and verification. Its Trigger, Verification, and
Lifecycle columns do not change OMP discovery, prompt exposure, `skill://`, or
`/skill:` behavior.

## Skill Catalog

| Skill | Trigger | Verification | Lifecycle (project metadata) |
|---|---|---|---|
| `commit` | User asks to commit, push, publish, or prepare a verified commit | `make verify` succeeds before `make commit` / `make push`, and the remote branch contains the new commit | active |
| `release` | User asks to release, deploy, ship, tag a version, or undo a release | `make release bump=… DRY_RUN=1` passes its preflight (clean pushed `main`, public repository, green CI); after the release `make app-install` and `make doctor` report no problems | active |

## Skill Harness (`enforced-by`)

A skill's peculiar invariants must answer to a mechanical check that runs in
`make verify` — a skill whose rules live only in prose is a check nobody runs.
The contract is three-way and **name-driven**, held by `check-omp-skills`:

| Leg | Statement | Failure |
|---|---|---|
| Naming | a post hook whose hyphenated name contains the skill's name contiguously **is** that skill's harness — ownership is read off the filename, no marker comment to drift | a hook named after a skill the skill does not declare |
| Declaration | `SKILL.md` frontmatter carries `enforced-by:` listing exactly the name-derived set (`[]` for a procedure skill) | key absent; a declared hook that does not exist or whose name does not carry the skill's |
| Gate membership | every declared hook's `check-*` target is a prerequisite of `verify` | a harness outside the gate |

A **procedure skill** (`commit`) owns no hook: it declares `enforced-by: []` and
must reference at least one `rule://` domain in its body — the rulebook domain
that carries the enforcement it relies on.

## Catalog Conventions

- Every direct child of `.omp/skills/` with a `SKILL.md` has exactly one row.
- Each `SKILL.md` declares an explicit `name` equal to its directory name and a
  non-empty `description` in YAML frontmatter.
- Every row supplies a concrete trigger, verification command or observable,
  and lifecycle (`active` or `deprecated`).
- Lifecycle is documentation-only project metadata. `deprecated` does not hide,
  disable, or remove a discovered skill.
- Add or remove a skill and its catalog row in the same change.

## Adding a New Skill

1. Create `.omp/skills/<name>/SKILL.md` with explicit `name`, `description` and
   `enforced-by` frontmatter. Keep assets under that same skill directory.
2. Add one `active` row to **Skill Catalog** with a precise user trigger and
   verification command or observable outcome; run `make check-omp-skills`.
3. Add the skill-specific workflow to `SKILL.md`; skills document behavior and
   hooks enforce only policies that must run at tool boundaries. Run
   `make check-omp-skills` again, then `make verify` before committing.

## Never Do These

- Create nested skill directories; native discovery scans only one level below
  `.omp/skills/`.
- Add a skill without catalog metadata or a catalog row without its `SKILL.md`.
- Use a catalog row as a replacement for the skill frontmatter description.
- Assume `deprecated` changes a skill's OMP runtime availability.
