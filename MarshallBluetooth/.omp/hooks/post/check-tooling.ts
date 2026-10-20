import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";

/**
 * Check-Tooling Post Hook
 *
 * Enforces the tooling language policy (tooling.md) on the tree, not just at
 * write time — a file can also arrive by checkout, rename or a tool the pre
 * hook does not see:
 *
 *   1. The project's languages are TypeScript (`app/`, `.omp/`) and Swift with
 *      thin Objective-C bridge files (`app/macos/`). No Python, Ruby or shell
 *      script exists anywhere: each needs a second toolchain to run one check.
 *   2. Native sources (`.swift`, `.m`, `.mm`, `.h`) live under `app/macos/`,
 *      where the Xcode targets and `make swift-check` compile them.
 *   3. `.omp/hooks/` and `.omp/extensions/` are TypeScript only — hooks and
 *      libs import each other.
 *   4. Scripts live in `.omp/hooks/`, `.omp/extensions/` or `app/`; a root
 *      `scripts/`, `tools/`, `bin/` or `utils/` directory hides tooling from
 *      `check-omp-hooks` and from every make target.
 *   5. Every `check-*` target runs `node .omp/hooks/...`, so a check is
 *      executable on any machine with node and nothing else.
 */

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

/** Script languages that need a toolchain this project does not have. */
const FORBIDDEN_SCRIPTS = /\.(py|rb|sh|bash|zsh)$/;

/** Native source extensions, all compiled from `app/macos/`. */
const NATIVE_SOURCES = /\.(swift|m|mm|h)$/;
const NATIVE_ROOT = "app/macos/";

/** Where script code may live at all. */
const SCRIPT_ROOTS = [".omp/hooks/", ".omp/extensions/", "app/"];

const ADHOC_SCRIPT_DIRS: Record<string, true> = {
  scripts: true,
  tools: true,
  bin: true,
  utils: true,
};

const SCRIPT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Version control and the harness's runtime state are not source. */
const SKIPPED_PATHS: Record<string, true> = { ".git": true, ".omp/state": true };

// ============================================================
// Functions
// ============================================================

export default function checkTooling(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-tooling", event, () => {
    // Read-only tools never change files — running the check after them wastes context.
    // hook-scope: global — the tooling policy applies to a script in any path
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkToolingSync();
    if (issues.length === 0) {
      resetSuppression("check-tooling");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-tooling",
      issues,
      "move the script to .omp/hooks/ (a check) or .omp/extensions/ (session behaviour)",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-tooling") };
  }));
}

export function checkToolingSync(): string[] {
  const issues: string[] = [];

  for (const path of walk(projectRoot)) {
    if (FORBIDDEN_SCRIPTS.test(path)) {
      issues.push(
        `${path}: Python/Ruby/shell script — this project is TypeScript and Swift; automation ` +
          "belongs in .omp/hooks/ as TypeScript behind a make target (tooling.md)",
      );
    }
    if (NATIVE_SOURCES.test(path) && !path.startsWith(NATIVE_ROOT)) {
      issues.push(`${path}: native source outside app/macos/ — no Xcode target or make swift-check compiles it`);
    }
    if (/^\.omp\/(hooks|extensions)\//.test(path) && !path.endsWith(".ts")) {
      issues.push(`${path}: .omp/hooks/ and .omp/extensions/ are TypeScript only — the modules import each other`);
    }
    if (ADHOC_SCRIPT_DIRS[path.split("/")[0]] === true) {
      issues.push(
        `${path}: project-root script directory — tooling that is not under ` +
          ".omp/hooks/ is invisible to check-omp-hooks and to every make target",
      );
    }
    if (SCRIPT_EXTENSIONS.test(path) && !SCRIPT_ROOTS.some((root) => path.startsWith(root))) {
      issues.push(`${path}: script outside .omp/hooks/, .omp/extensions/ and app/ (tooling.md)`);
    }
  }

  issues.push(...checkCheckTargets());
  // --- Extensions: a detached rejection tears the session down ---
  // Measured: `void ctx.compact()` rejected with "Nothing to compact (session
  // too small)", escaped handler dispatch, and the postmortem handler killed the
  // whole session (exit 1). Runtime actions that return a promise must have
  // their rejection handled, so the failure stays inside the extension.
  const extensionsDir = join(projectRoot, ".omp", "extensions");
  if (existsSync(extensionsDir)) {
    for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
      const files = entry.isDirectory()
        ? readdirSync(join(extensionsDir, entry.name))
            .filter((file: string) => file.endsWith(".ts"))
            .map((file: string) => join(entry.name, file))
        : entry.name.endsWith(".ts")
          ? [entry.name]
          : [];
      for (const file of files) {
        const source = readFileSync(join(extensionsDir, file), "utf-8");
        const lines = source.split("\n");
        lines.forEach((line: string, index: number) => {
          const call = /\bctx\.(compact|shutdown|abort)(?:\?\.)?\(/.exec(line);
          if (call === null) return;
          if (/^\s*(?:\/\/|\*)/.test(line)) return;
          // `void` is an explicit discard: there is nothing left to handle it.
          if (!/\bvoid\s+ctx\./.test(line)) {
            // The handler may sit on the following lines (assign, then .catch).
            const window = lines.slice(index, index + 5).join("\n");
            if (/\bawait\b/.test(window) || /\.catch\(/.test(window)) return;
          }
          issues.push(
            `.omp/extensions/${file}:${index + 1}: ctx.${call[1]}() without await or .catch — ` +
              "a detached rejection escapes handler dispatch and kills the session",
          );
        });
      }
    }
  }

  return issues;
}

/** A check must be one `node` invocation — no interpreter, no virtualenv. */
function checkCheckTargets(): string[] {
  const issues: string[] = [];
  const makefilePath = join(projectRoot, "Makefile");
  if (!existsSync(makefilePath)) return issues;

  const lines = readFileSync(makefilePath, "utf-8").split("\n");
  lines.forEach((line: string, index: number) => {
    const target = /^(check-[\w-]+):/.exec(line);
    if (target === null) return;
    const recipe = lines[index + 1] ?? "";
    if (!recipe.startsWith("\t")) return; // aggregate target: dependencies only
    if (recipe.includes("node .omp/hooks/")) return;
    issues.push(
      `Makefile ${target[1]}: runs '${recipe.trim()}' — a check target must run ` +
        "node .omp/hooks/... so it needs nothing but node (tooling.md)",
    );
  });
  return issues;
}

// ============================================================
// Helpers
// ============================================================

/** Every source-looking file in the project, as a project-relative path. */
function walk(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (WALK_EXCLUDES.has(entry.name) || SKIPPED_PATHS[path] === true) continue;
    if (entry.isDirectory()) {
      found.push(...walk(join(dir, entry.name), path));
      continue;
    }
    found.push(path);
  }
  return found;
}

// Direct execution (make check-tooling): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-tooling.ts")) {
  const issues = checkToolingSync();
  console.log("==> check-tooling");
  if (issues.length === 0) {
    console.log("    PASS: tooling language policy valid");
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-tooling");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
