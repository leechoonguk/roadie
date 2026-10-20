import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesStrict } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS_NO_BASH as MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Omp-Types Post Hook
 *
 * Type-checks the harness's own TypeScript. `make typecheck` covers the app
 * (`app/tsconfig.json`) and `check-code-layout` reads arrangement; neither reads
 * the harness's types, so a hook or extension whose call site and signature
 * disagree fails only when it runs.
 *
 * Runs `tsc --noEmit` over `.omp/tsconfig.json` with the TypeScript `app/`
 * already depends on: no new dependency, and `.omp/` keeps its no-package.json
 * shape (see `tooling.md`).
 *
 * This is a read-only check — it does NOT block tool calls.
 */
const cwd = process.cwd();
const projectRoot = existsSync(join(cwd, ".omp", "tsconfig.json")) ? cwd : join(cwd, "..");

/** Type-checking the harness costs seconds, so it is throttled like `check-verify`. */
const THROTTLE_MS = 60 * 1000;
const FAILURE_THROTTLE_MS = 10 * 1000;
let lastRunAt = 0;
let lastRunFailed = false;

const MAX_REPORTED = 3;

export default function checkOmpTypes(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: { type: string; text?: string }[] }) => guarded("check-omp-types", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return undefined;
    if (!touchesStrict(event, [".omp/"])) return undefined;
    const now = Date.now();
    const throttle = lastRunFailed ? FAILURE_THROTTLE_MS : THROTTLE_MS;
    if (now - lastRunAt < throttle) return undefined;
    lastRunAt = now;

    const issues = runTypecheck();
    lastRunFailed = issues.length > 0;
    if (issues.length === 0) {
      resetSuppression("check-omp-types");
      return undefined;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-omp-types",
      issues,
      'run "make check-omp-types" for details',
    );
    if (warning === null) return undefined;
    return { content: wrapWarning(warning, event.content, "check-omp-types") };
  }));
}

/**
 * The exit status alone sends every reader back to run the command by hand, so
 * the first few `error TS...` lines are quoted verbatim.
 */
function runTypecheck(): string[] {
  const tsc = join(projectRoot, "app", "node_modules", "typescript", "bin", "tsc");
  const config = join(projectRoot, ".omp", "tsconfig.json");
  if (!existsSync(tsc)) {
    return [`app/node_modules/typescript: not installed — run 'make install' (looked for ${tsc})`];
  }
  if (!existsSync(config)) return [`missing ${config}`];

  const result = spawnSync("node", [tsc, "--noEmit", "-p", config], {
    cwd: projectRoot,
    encoding: "utf-8",
    timeout: 10 * 60 * 1000,
  });
  const output = String(result.stdout ?? "") + String(result.stderr ?? "");
  if (result.status === 0) return [];

  const errors = output
    .split("\n")
    .filter((line: string) => / error TS\d+:/.test(line))
    .map((line: string) => line.trim());
  if (errors.length === 0) {
    return [`tsc failed (exit ${String(result.status)}) with no error line — output: ${output.trim().slice(0, 200)}`];
  }
  const head = errors.slice(0, MAX_REPORTED);
  if (errors.length > MAX_REPORTED) {
    head.push(`... ${String(errors.length - MAX_REPORTED)} more type error(s)`);
  }
  return head;
}

// Direct execution (make check-omp-types): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-omp-types.ts")) {
  const issues = runTypecheck();
  console.log("==> check-omp-types");
  if (issues.length === 0) {
    console.log("    PASS: harness TypeScript type-checks");
  } else {
    for (const issue of issues) console.log(`    FAIL: ${issue}`);
    printRuleHint("check-omp-types");
    console.log(`    ${String(issues.length)} issue(s) found`);
    process.exit(1);
  }
}
