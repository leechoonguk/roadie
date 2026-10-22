import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS_NO_BASH as MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

/**
 * Check-Verify Post Hook
 *
 * Runs the root `make verify` — eslint, tsc, jest, the Swift type-check and
 * every harness check — after a source-changing tool result, and quotes the
 * lines that say what failed.
 *
 * bash is deliberately NOT a trigger: `make <target>` already runs its own
 * quality gates, and running a competing `make verify` from the hook while the
 * agent's make runs would race jest and tsc and produce transient failures.
 * Source changes happen through write/edit/ast_edit — those are the triggers.
 *
 * `check-verify` is the one post hook that is **not** a prerequisite of
 * `verify`: it runs `verify`, so gating it would recurse. `check-makefiles`
 * holds that exemption to this single target (rule://root-makefile).
 */
const projectRoot = resolveProjectRoot();

/**
 * Success is cheap to re-confirm later; a failure is not. Holding the same
 * 5-minute silence after a red verify meant the next five minutes of edits got
 * no feedback at all, so failure re-checks quickly.
 */
const THROTTLE_MS = 5 * 60 * 1000;
const FAILURE_THROTTLE_MS = 90 * 1000;
let lastRunAt = 0;
let lastRunFailed = false;

/** Lines worth quoting: what failed, not the progress before it. */
const DIAGNOSTIC_LINE = /FAIL\b|FAILED|ERROR|error:|Error:|error TS|✕|✖|make: \*\*\*/;
const MAX_DIAGNOSTIC_LINES = 3;

export default function checkVerify(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: {
    toolName?: string;
    input?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string }>;
  }) => guarded("check-verify", event, () => {
    // hook-scope: global — the whole gate: whatever changed, the project's verification is the subject
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (isMakeCommand(event.input)) return;

    const now = Date.now();
    const throttle = lastRunFailed ? FAILURE_THROTTLE_MS : THROTTLE_MS;
    if (now - lastRunAt < throttle) return;
    lastRunAt = now;

    const issues = runVerify();
    lastRunFailed = issues.length > 0;
    if (issues.length === 0) {
      resetSuppression("check-verify");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-verify",
      issues,
      "run make check-verify for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-verify") };
  }));
}

function isMakeCommand(input: Record<string, unknown> | undefined): boolean {
  if (!input) return false;
  // Defensive: a make command on any triggering tool's input already ran its
  // own gates — never spawn a competing nested verify.
  return /^\s*make(?:\s|$)/.test(String(input.command ?? ""));
}

/**
 * The exit status alone ("make verify failed (exit 2)") sent every reader to
 * run the command by hand. The tail of the gate's own output names the failing
 * test, lint rule, type error or harness check directly.
 */
function runVerify(): string[] {
  const result = spawnSync("make", ["verify"], {
    cwd: projectRoot,
    encoding: "utf-8",
    timeout: 10 * 60 * 1000,
  });
  if (result.status === 0) return [];
  const output = String(result.stdout ?? "") + String(result.stderr ?? "");
  const diagnosis = output
    .split("\n")
    .filter((line: string) => DIAGNOSTIC_LINE.test(line))
    .slice(-MAX_DIAGNOSTIC_LINES)
    .map((line: string) => line.trim())
    .join(" | ");
  return [`Makefile: make verify failed (exit ${String(result.status)})` + (diagnosis === "" ? "" : ` — ${diagnosis}`)];
}

// Direct execution (make check-verify): run the gate and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-verify.ts")) {
  const issues = runVerify();
  console.log("==> check-verify");
  if (issues.length === 0) {
    console.log("    PASS: root make verify passed");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-verify");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
