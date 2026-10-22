---
name: commit
description: Create and push Git commits through the verified project workflow. Use when the user asks to commit, push, publish changes, or prepare a verified commit.
enforced-by: []
---

# Verified Commit and Push

## Only When Asked

A publish needs two facts, and they are different: the tree is green, and the
user asked. `strict-publish-consent.ts` reads the current user turn from the
session and blocks a commit or push it does not find a request in — including a
turn that names the verb while forbidding it. If the work is done and nobody
asked, report it and stop.

This is a procedure skill: the enforcement lives in rule://root-git-workflow
(the `strict-verified-git` and `strict-publish-consent` pre guards, which are
session-wide blockers rather than this skill's own checks).

## Workflow

1. Inspect the worktree (`git status -- .` from the repository root) and
   separate unrelated user changes before staging.
2. Publish through the Make targets — `verify` is a prerequisite of both, so the
   tree that is published is the tree the gate read:

```bash
make commit m="type(scope): subject"
make push
```

3. `make commit` stages this project's whole worktree (`git add -A -- .`) and
   commits it, because a commit with unstaged changes or untracked files
   publishes a tree `make verify` never read. To commit less than the worktree,
   `git stash -k` the rest first and run the target again.
4. Confirm the remote branch contains the new commit and the project worktree
   is clean.

## When The Gate Disagrees

Capture the real status rather than trusting a wrapper:

```bash
make verify; status=$?; printf 'MAKE_VERIFY_EXIT=%s\n' "$status"
```

`MAKE_VERIFY_EXIT=0` is the only pass condition. If a tool wrapper reports
something else, treat the captured Make status as authoritative and report the
harness discrepancy.

## Enforcement

| Gate | Hook | What it blocks |
|---|---|---|
| Consent | `strict-publish-consent.ts` | a commit or push the current user turn did not ask for |
| Verification | `strict-verified-git.ts` | a raw `git commit`/`git push` while `make verify` fails, or a commit whose project index differs from its worktree |

Both read the command at the tool boundary, so `make commit`, `make push` and a
hand-written `git commit` are all covered. A publish the user runs in their own
terminal is their own action and is not gated.

## Never Do These

- Commit or push without a request in the current user turn.
- Commit or push unrelated staged work without explicit user approval.
- Stage a hand-picked subset around `make commit` — it publishes a tree the gate never read.
- Treat a tool-wrapper status as more authoritative than a captured Make status.
- Bypass a failed gate by committing or pushing anyway.
