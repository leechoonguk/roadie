---
description: Project Git workflow — verified, consented commits and pushes scoped to this project's directory
globs:
      - Makefile
      - .omp/skills/commit/SKILL.md
      - .omp/hooks/pre/strict-verified-git.ts
      - .omp/hooks/pre/strict-publish-consent.ts
      - .omp/hooks/lib/hook-publish-consent.ts
alwaysApply: false
---

# Project Git Workflow

## Consent Comes First

A green tree is not a reason to publish. Two different failures:

| Question | Owner |
|---|---|
| Is this tree green? | `strict-verified-git.ts` — reruns `make verify` before the Git command |
| Did the user ask for this publish? | `strict-publish-consent.ts` — reads the session's own entries |

Consent is the **current** user turn, read from `sessionManager.getBranch()`. A
request three turns ago, followed by other instructions, is not permission to
publish now, and a turn that names the verb while forbidding it - "커밋하고 푸쉬
하지말도록" - is not a request. The hook fails closed: an unreadable history
blocks the publish.

What it cannot decide is whether the *word* was meant as an instruction: "커밋
메시지 초안 써줘" grants consent under this rule. The gate is a permission check,
not a promise that every match was an order.

## The Repository Is the Project

The project directory is the Git repository root: `Makefile`, `app/`, `.omp/`,
`docs/` and the CI in `.github/workflows/` sit side by side. Everything that
publishes runs from there with the `-- .` pathspec:

- `make commit` stages and commits `-- .` — the whole tree the gate read,
  workflows included.
- `strict-verified-git.ts` asks `git status --porcelain -- .` whether the commit
  is the verified tree.

## Verified Commit and Push

- `make commit m="type(scope): subject"` and `make push` are the publish path.
  `verify` is a prerequisite of both, so the tree that is published is the tree
  the gate read. Use them instead of hand-rolled `git commit` pipelines.
- Use the `commit` skill for user-requested commits or pushes.
- Before staging, inspect the project's worktree and keep unrelated user changes
  out of the commit unless the user explicitly approves them.
- `make verify` must pass before a commit or push. Capture its actual status:

  ```bash
  make verify; status=$?; printf 'MAKE_VERIFY_EXIT=%s\n' "$status"
  ```

- `MAKE_VERIFY_EXIT=0` is the pass condition. If a wrapper reports a conflicting
  status, report the harness issue; do not change project code to satisfy it.
- `strict-verified-git.ts` reruns `make verify` immediately before every
  OMP-mediated `git commit` or `git push` and blocks the Git command on failure.
- **The commit must be the verified tree.** `make verify` reads the worktree, so
  a commit with unstaged changes or untracked files publishes a tree that was
  never verified — an untracked new module imported by tracked files is the
  classic case: green verify, broken commit. `strict-verified-git.ts` blocks a
  raw commit while the project's `git status --porcelain -- .` shows either,
  naming both ways out: `git add -A -- .` (commit what was verified) or
  `git stash -k` (move the rest out first, then re-verify).
- Confirm the remote branch and a clean project worktree after push.

## Review Judgement (not machine-checked)

- Whether staged work is *related* - only the author knows what the change is.
- Whether a commit message describes the change honestly.

## Never Do These

- Commit or push unverified changes.
- Include unrelated staged work without explicit user approval.
- Stage by hand around `make commit` — `git add` of a chosen subset publishes a
  tree the gate never read.
- Commit a partial index after verifying the whole worktree — verify the tree you
  are publishing, not a different one.
- Bypass a failed verification gate.
- Commit or push without the user asking in the current turn — the tree being
  green is not the same as the publish being wanted.
