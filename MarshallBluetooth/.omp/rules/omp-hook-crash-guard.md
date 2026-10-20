---
description: OMP post-hook crash guard — an unwrapped tool_result handler, injected while the hook is being written
condition: "pi\\.on\\(\\s*\\\\?[\"']tool_result\\\\?[\"']\\s*,\\s*\\([^)]*\\)\\s*=>\\s*\\{"
scope: "tool:edit(.omp/hooks/post/*.ts), tool:write(.omp/hooks/post/*.ts)"
interruptMode: always
alwaysApply: false
---

<!-- fires-on .omp/hooks/post/*.ts: pi.on("tool_result", (event) => { -->

# OMP Hook Crash Guard

This text arrives because the post hook currently being written registers a
`tool_result` handler whose body is **not** wrapped in `guarded()`.

The extension runner catches a handler's exception, hands it to `emitError(...)`
and continues: the throw never reaches the conversation, the handler's
`{ content }` override is dropped, and the hook silently enforces nothing for
the rest of the session while `make check-<hook>` still passes by hand. Measured
in the runtime bundle — both the throw path and the handler-timeout path end
that way.

The shape:

```ts
pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) =>
  guarded("check-<hook>", event, () => {
    // the check itself
  }));
```

`guarded` comes from `../lib/hook-visibility.ts`; the name it declares must
equal the file name. Details: `rule://omp-hooks` (§ Crash Visibility).

## Enforcement

`check-omp-hooks` counts one `guarded()` wrapper per `pi.on("tool_result")`
registration and fails when any handler is bare; this injection is the same
invariant delivered before the hook lands.
