import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesStrict } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
// @ts-expect-error — Node builtin, not project-compiled
import { pathToFileURL } from "node:url";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { projectRoot } from "../lib/hook-project-root.ts";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

/**
 * Check-OMP-Probes Post Hook
 *
 * The pre hooks are the harness's refusals, and a refusal that is wrong costs
 * more than one that is missing: a stale project root once blocked about forty
 * writes over two days. "Break it once by hand" does not scale to that, so every
 * pre hook's verdicts are a table, `.omp/hooks/probes.json`, and this check runs it.
 *
 * Each case is `{ name?, hook, tool, input, cwd?, turn?, expect }`: `hook` is a
 * `hooks/pre/` file stem, `tool` and `input` form the tool call, `cwd` is where the
 * call runs (set as the event's and the context's cwd), `turn` is the latest user
 * message the session would show, `expect` is `"block"` or `"allow"`. The check
 * imports the hook, hands it a fake `pi` that keeps the `tool_call` handler, feeds
 * it the call and compares the verdict. The table must carry, for the project's own
 * failure classes: a mention that does not run, a dry run, a sibling-project path,
 * a sibling cwd, the allowed redirect-then-echo gate form and the piped gate.
 * Every pre hook has at least one case, so a new hook cannot ship unprobed.
 *
 * Probe blocks are test verdicts, not friction: `OMP_HOOK_PROBE=1` keeps them out of hook-metrics.
 *
 * A probe never runs a gate: a case that would make `strict-verified-git` run
 * `make verify` is an `allow` case that stops before it (a mention, a sibling cwd).
 */
const ompDir = join(projectRoot, ".omp");
const probesPath = join(ompDir, "hooks", "probes.json");
const preDir = join(ompDir, "hooks", "pre");

/** The failure classes every project's table covers — each is a tag in a case's `name` prefix. */
const REQUIRED_CASES = ["mention", "dry-run", "sibling-path", "sibling-cwd", "gate-redirect", "gate-piped"];

interface Probe {
  name?: string;
  hook: string;
  tool: string;
  input: Record<string, unknown>;
  cwd?: string;
  turn?: string;
  expect: "block" | "allow";
}

type ToolCallHandler = (event: unknown, ctx: unknown) => unknown;

export default function checkOmpProbes(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-omp-probes", event, async () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesStrict(event, [".omp/"])) return;

    const issues = await checkOmpProbesSync();
    if (issues.length === 0) {
      resetSuppression("check-omp-probes");
      return;
    }

    const warning = buildSafeWarning(
      event.toolName,
      "check-omp-probes",
      issues,
      "fix the pre hook or the case in .omp/hooks/probes.json — whichever is wrong",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-omp-probes") };
  }));
}

export async function checkOmpProbesSync(): Promise<string[]> {
  const issues: string[] = [];
  if (!existsSync(probesPath)) return [".omp/hooks/probes.json: not found — the pre hooks' verdicts are unprobed"];

  let probes: Probe[];
  try {
    probes = JSON.parse(readFileSync(probesPath, "utf-8")) as Probe[];
  } catch (error: unknown) {
    return [`.omp/hooks/probes.json: not valid JSON — ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!Array.isArray(probes)) return [".omp/hooks/probes.json: must be a JSON array of cases"];

  const hooks = existsSync(preDir)
    ? readdirSync(preDir).filter((file: string) => file.endsWith(".ts")).map((file: string) => file.slice(0, -3))
    : [];
  const handlers = new Map<string, ToolCallHandler>();
  for (const hook of hooks) {
    const handler = await loadHandler(hook, issues);
    if (handler !== null) handlers.set(hook, handler);
  }

  const probed = new Set<string>();
  for (const [index, probe] of probes.entries()) {
    const label = `.omp/hooks/probes.json case ${index + 1}${probe.name ? ` (${probe.name})` : ""}`;
    if (probe.expect !== "block" && probe.expect !== "allow") {
      issues.push(`${label}: expect must be "block" or "allow"`);
      continue;
    }
    if (!hooks.includes(probe.hook)) {
      issues.push(`${label}: no pre hook '${probe.hook}' in .omp/hooks/pre/`);
      continue;
    }
    probed.add(probe.hook);
    const handler = handlers.get(probe.hook);
    if (handler === undefined) continue;
    const verdict = await verdictOf(handler, probe, label, issues);
    if (verdict !== null && verdict !== probe.expect) {
      issues.push(`${label}: ${probe.hook} answered ${verdict} for ${probe.tool} ${briefInput(probe.input)} — expected ${probe.expect}`);
    }
  }

  for (const hook of hooks) {
    if (!probed.has(hook)) issues.push(`.omp/hooks/probes.json: pre hook '${hook}' has no case — add one that blocks or allows it`);
  }
  for (const required of REQUIRED_CASES) {
    if (!probes.some((probe: Probe) => String(probe.name ?? "").startsWith(required))) {
      issues.push(`.omp/hooks/probes.json: no case named '${required}…' — the table must cover ${REQUIRED_CASES.join(", ")}`);
    }
  }
  return issues;
}

/** The `tool_call` handler a pre hook registers, found by handing it a fake `pi`. */
async function loadHandler(hook: string, issues: string[]): Promise<ToolCallHandler | null> {
  try {
    const module = (await import(pathToFileURL(join(preDir, `${hook}.ts`)).href)) as { default?: (pi: unknown) => void };
    if (typeof module.default !== "function") {
      issues.push(`hooks/pre/${hook}.ts: no default-exported function to probe`);
      return null;
    }
    let handler: ToolCallHandler | null = null;
    module.default({
      on(event: string, registered: ToolCallHandler): void {
        if (event === "tool_call") handler = registered;
      },
    });
    if (handler === null) issues.push(`hooks/pre/${hook}.ts: registers no tool_call handler to probe`);
    return handler;
  } catch (error: unknown) {
    issues.push(`hooks/pre/${hook}.ts: cannot be loaded to probe — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** What the handler answers for one case; a throw is a finding, not a verdict. */
async function verdictOf(handler: ToolCallHandler, probe: Probe, label: string, issues: string[]): Promise<"block" | "allow" | null> {
  const event = { toolName: probe.tool, input: probe.input, ...(probe.cwd === undefined ? {} : { cwd: probe.cwd }) };
  const entries = probe.turn === undefined ? [] : [{ role: "user", content: probe.turn }];
  const ctx = { ...(probe.cwd === undefined ? {} : { cwd: probe.cwd }), sessionManager: { getBranch: () => entries } };
  const was = process.env.OMP_HOOK_PROBE;
  process.env.OMP_HOOK_PROBE = "1";
  try {
    const result = (await handler(event, ctx)) as { block?: unknown } | null | undefined;
    return result?.block === true ? "block" : "allow";
  } catch (error: unknown) {
    issues.push(`${label}: ${probe.hook} threw — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    if (was === undefined) delete process.env.OMP_HOOK_PROBE;
    else process.env.OMP_HOOK_PROBE = was;
  }
}

function briefInput(input: Record<string, unknown>): string {
  const text = String(input.command ?? input.code ?? input.path ?? JSON.stringify(input));
  return `\`${text.slice(0, 60)}\``;
}

// Direct execution (make check-omp-probes): run the table on demand.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-omp-probes.ts")) {
  const issues = await checkOmpProbesSync();
  console.log("==> check-omp-probes");
  if (issues.length === 0) {
    console.log("    PASS: every pre hook answers its probe table");
  } else {
    for (const issue of issues) console.error(`    FAIL: ${issue}`);
    printRuleHint("check-omp-probes");
    process.exitCode = 1;
  }
}
