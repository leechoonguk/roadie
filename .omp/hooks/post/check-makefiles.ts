import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesStrict } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Makefiles Post Hook
 *
 * After tool execution, verifies that the project Makefile is consistent with
 * root-makefile.md:
 *   - Documented targets exist in the actual Makefile, and actual targets are
 *     documented
 *   - Every target carries a `## <description>` (the `make help` index)
 *   - Every post hook in .omp/hooks/post/ has a corresponding
 *     check-<name> target registered in the Makefile
 *   - `make verify` runs every post-hook target: a `check-*` target whose
 *     recipe is `node .omp/hooks/post/...` must be a prerequisite of `verify`
 *     (except `check-verify`, which runs `verify` itself), and the
 *     prerequisite list must equal the membership documented in
 *     root-makefile.md (both directions). In the harness this was ported from,
 *     three targets existed, passed, and were never run by the gate — a check
 *     that is not in `verify` is a claim nobody tests.
 *   - Every `make <target>` the harness text writes as a command exists.
 *
 * This is a read-only check — it does NOT block tool calls.
 * To fix inconsistencies: update .PHONY, ## documentation, or target implementations.
 */
const cwd = process.cwd();
const ompDir = join(cwd, ".omp");
const rulesDir = join(ompDir, "rules");

/**
 * Read-only tools never change files — running the check after them wastes
 * context. Only run after tools that can modify the workspace.
 */

const makefileRules: Array<{ ruleFile: string; makefilePath: string; label: string }> = [
  { ruleFile: "root-makefile.md", makefilePath: "Makefile", label: "root" },
];

/**
 * The one post-hook target that runs the gate itself. As a prerequisite of
 * `verify` it would run `verify` from inside `verify` — so it is the single
 * exemption from verify membership, named here rather than inferred.
 */
const GATE_RUNNER = "check-verify";

/**
 * 하네스 텍스트가 부르는 `make <target>` 은 실재해야 한다.
 *
 * 실측된 충돌 부류 "실행 불가능한 지시"(원 하네스): 마감 게이트가 제거된 타깃을 지시했고,
 * 문서가 제거된 리포트 타깃을 안내했다 — 둘 다 사람이 우연히 발견했다.
 * 규칙·훅·확장·스킬의 make 참조를 Makefile 의 실타깃과 대조한다. "존재하지 않는다" 고
 * 경고하는 문장 자신은 제외한다.
 */
const projectRoot = process.cwd();

export function checkMakeTargetReferences(): string[] {
  const issues: string[] = [];
  const targetsOf = (rel: string): Set<string> => {
    const path = join(projectRoot, rel);
    if (!existsSync(path)) return new Set();
    return new Set([...readFileSync(path, "utf-8").matchAll(/^([a-z][\w-]*):/gm)].map((m) => m[1]));
  };
  const targets = targetsOf("Makefile");
// Names a doc writes *as* a command while meaning "any target": `make <target>`
// renders as `make target` once the angle brackets are stripped. The English
// words this set used to carry ("the", "two", "sure", ...) are gone with the
// prose scan that needed them - a code span is a command, and a sentence is not.
const PLACEHOLDER = new Set(["check-", "check-x", "check-anything", "definitely-not-a-target", "target", "targets", "command", "commands"]);
  const roots = [".omp/rules", ".omp/hooks", ".omp/extensions", ".omp/skills"];
  const files: string[] = [join(projectRoot, ".omp", "RULES.md"), join(projectRoot, ".omp", "AGENTS.md")];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(md|ts)$/.test(e.name)) files.push(full);
    }
  };
  for (const r of roots) if (existsSync(join(projectRoot, r))) walk(join(projectRoot, r));
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf-8");
    // Only what is written as code is an instruction. Scanned over raw prose,
    // this reported "would make one of them fail every night" as a call to a
    // missing `one` target - and every English sentence that pairs "make" with
    // a word was one PLACEHOLDER entry away from the same false positive.
    let inFence = false;
    for (const rawLine of text.split("\n")) {
      if (/^\s*```/.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (/do not exist|없다|not-a-target|존재하지 않|제거|removed|지시했고|안내했다/.test(rawLine)) continue; // 부재·제거를 말하는 문장 자신은 지시가 아니다
      // Separated by a character `\s` cannot cross: joined by whitespace, the two
      // spans of "`make` targets, a bare `uvicorn`" read as one call to a target
      // named by the second span - which is how this check first reported itself.
      const line = inFence
        ? rawLine
        : [...rawLine.matchAll(/`([^`\n]+)`/g)].map((span) => span[1]).join(" ; ");
      for (const m of line.matchAll(/\bmake\s+([a-z][\w-]{2,})/g)) {
        const t = m[1].toLowerCase();
        if (PLACEHOLDER.has(t)) continue;
        if (!targets.has(t)) issues.push(`${file.replace(projectRoot + "/", "")}: \`make ${t}\` 를 부르는데 그 타깃이 없다 — 실행 불가능한 지시다. 타깃을 만들거나 참조를 고쳐라`);
      }
    }
  }
  return issues;
}

export default function checkMakefiles(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-makefiles", event, () => {
    // Skip read-only tools — they cannot change Makefiles.
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesStrict(event, ["Makefile", "makefile"])) return;

    const issues = checkMakefileConsistency();
    if (issues.length === 0) {
      resetSuppression("check-makefiles"); // resolved — allow re-warning on new violations
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-makefiles",
      issues,
      "update .PHONY, documented targets, or Makefile implementations",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-makefiles") };
  }));
}

function checkMakefileConsistency(): string[] {
  const issues: string[] = [];

  for (const { ruleFile, makefilePath, label } of makefileRules) {
    const rulePath = join(rulesDir, ruleFile);
    if (!existsSync(rulePath)) {
      issues.push(`${label}: rule file ${ruleFile} not found in .omp/rules/`);
      continue;
    }

    const ruleContent = readFileSync(rulePath, "utf-8");
    const ruleTargets = parseMarkdownTable(ruleContent);

    const makefilePathFull = join(cwd, makefilePath);
    if (!existsSync(makefilePathFull)) {
      issues.push(`${label}: Makefile ${makefilePath} not found`);
      continue;
    }

    const actualTargets = parseMakefileTargets(makefilePathFull);
    // A pattern rule with an empty recipe answers *every* unknown target with
    // success, so `make check-anything` passes and the whole gate reads green.
    // Measured: an unattended local model, told its acceptance was
    // `make definitely-not-a-target`, added exactly this to make the predicate
    // pass. A gate that can be satisfied by editing the gate is not a gate.
    for (const hit of catchAllRules(readFileSync(makefilePathFull, "utf-8"))) {
      issues.push(
        `${label}: ${makefilePath} declares a catch-all rule '${hit}' — it answers every unknown ` +
          "target with success, so every check-* gate would pass without running",
      );
    }

    // Check: documented targets not in actual Makefile
    for (const target of ruleTargets) {
      if (!actualTargets.has(target)) {
        issues.push(`${label}: target '${target}' documented in ${ruleFile} but not in actual Makefile`);
      }
    }

    // Check: actual targets not documented
    for (const target of actualTargets) {
      if (!ruleTargets.has(target)) {
        issues.push(`${label}: target '${target}' in Makefile but not documented in ${ruleFile}`);
      }
    }
    // Check: check-* targets must have an executable recipe, not just a
    // documented target header. A blank recipe silently makes verification
    // skip the intended hook.
    issues.push(...checkTargetRecipes(makefilePathFull, label));
    issues.push(...checkTargetHelp(makefilePathFull, label));
  }

  issues.push(...checkMakeTargetReferences());

  // Check: Makefile targets that reference .ts/.sh files must point to
  // existing files. A missing file means the target silently fails.
  for (const { makefilePath, label } of makefileRules) {
    const makefilePathFull = join(cwd, makefilePath);
    if (!existsSync(makefilePathFull)) continue;
    const content = readFileSync(makefilePathFull, "utf-8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      // Match recipe lines: node <path> or bash <path> or ./<path>
      const fileMatch = line.match(/(?:node|bash|\.\/)\s+(\S+\.(?:ts|sh|mjs))\b/);
      if (!fileMatch) continue;
      const refPath = fileMatch[1];
      const fullPath = refPath.startsWith("./") ? join(cwd, refPath) : join(cwd, refPath);
      if (!existsSync(fullPath)) {
        issues.push(`${label}: target references missing file '${refPath}'`);
      }
    }
  }

  // Check: every post hook has a matching check-<name> target in root Makefile
  issues.push(...checkHooksRegisteredInMakefile());

  // Check: every post-hook target is actually run by `make verify`, and the
  // Makefile's prerequisite list matches what root-makefile.md documents.
  issues.push(...checkVerifyMembership());

  return issues;
}

/**
 * A `check-*` target that exists but is not a prerequisite of `verify` passes
 * on its own and is never run by the gate — the harness reports green while one
 * standard goes unproven. Two sources must agree:
 *
 *   1. Makefile: every `check-<name>` whose recipe runs
 *      `node .omp/hooks/post/check-<name>.ts` is in `verify`'s prerequisites,
 *      except `GATE_RUNNER`, which runs `verify` and would recurse.
 *   2. root-makefile.md: the `make verify` row lists exactly the prerequisites
 *      the Makefile declares — the doc is the reviewable contract, the Makefile
 *      is the executed one; they drift the moment only one is edited.
 */
function checkVerifyMembership(): string[] {
  const issues: string[] = [];
  const rootMakefilePath = join(cwd, "Makefile");
  const rulePath = join(rulesDir, "root-makefile.md");
  if (!existsSync(rootMakefilePath) || !existsSync(rulePath)) return issues;

  const makefile = readFileSync(rootMakefilePath, "utf-8");
  const actual = parseVerifyPrerequisites(makefile);
  if (actual === null) {
    issues.push("./Makefile: no `verify:` target — the hermetic gate is missing");
    return issues;
  }

  // 1. Every post-hook-backed check-* target must be gated.
  for (const target of parsePostHookTargets(makefile)) {
    if (target === GATE_RUNNER) {
      if (actual.has(target)) {
        issues.push(`root: '${target}' is a prerequisite of 'verify' but runs 'make verify' itself — the gate would recurse`);
      }
      continue;
    }
    if (!actual.has(target)) {
      issues.push(
        `root: target '${target}' runs a post hook but is not a prerequisite of 'verify' — ` +
          "a check outside the gate is never run; add it to verify (and to the root-makefile.md row)",
      );
    }
  }

  // 2. Makefile prerequisites ↔ documented membership, both directions.
  const documented = parseDocumentedVerifyMembers(readFileSync(rulePath, "utf-8"));
  if (documented === null) {
    issues.push("root: root-makefile.md has no `make verify` row listing its members");
    return issues;
  }
  for (const target of actual) {
    if (!documented.has(target)) {
      issues.push(`root: 'verify' runs '${target}' but root-makefile.md's \`make verify\` row does not list it`);
    }
  }
  for (const target of documented) {
    if (!actual.has(target)) {
      issues.push(`root: root-makefile.md documents '${target}' under \`make verify\` but the Makefile does not run it`);
    }
  }
  return issues;
}

/** Prerequisites of `verify:` — backslash continuations joined, `##` help stripped. */
function parseVerifyPrerequisites(makefile: string): Set<string> | null {
  const logical = makefile.replace(/\\\r?\n/g, " ");
  const match = /^verify:[ \t]*([^\n]*)$/m.exec(logical);
  if (match === null) return null;
  const deps = match[1].split("##")[0].trim();
  return new Set(deps.split(/\s+/).filter((token: string) => token.length > 0));
}

/** `check-*` targets whose recipe runs a `.omp/hooks/post/` hook. */
function parsePostHookTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  let current = "";
  for (const line of makefile.split(/\r?\n/)) {
    const header = /^(check-[A-Za-z0-9_-]+):/.exec(line);
    if (header !== null) {
      current = header[1];
      continue;
    }
    if (current !== "" && /^\t.*node\s+\.omp\/hooks\/post\//.test(line)) {
      targets.add(current);
    }
  }
  return targets;
}

/** Members listed in root-makefile.md's `make verify` row, split on `+`. */
function parseDocumentedVerifyMembers(rule: string): Set<string> | null {
  const row = rule
    .split(/\r?\n/)
    .find((line: string) => /^\|\s*`make verify`\s*\|/.test(line.trim()));
  if (row === undefined) return null;
  const cells = row.split("|").map((cell: string) => cell.trim());
  const command = cells[2] ?? "";
  const members = command
    .replace(/`/g, "")
    .split("+")
    .map((token: string) => token.trim())
    .filter((token: string) => token.length > 0);
  return new Set(members);
}

/**
 * `make help` greps `##` descriptions, so a target without one is invisible: it
 * exists, it is the documented way to do something, and no reader can find it.
 */
function checkTargetHelp(makefilePath: string, label: string): string[] {
  const issues: string[] = [];
  if (!existsSync(makefilePath)) return issues;
  for (const line of readFileSync(makefilePath, "utf-8").split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):(?!=)/.exec(line);
    if (match === null || match[1] === ".PHONY") continue;
    if (!line.includes("##")) {
      issues.push(`${label}: target '${match[1]}' has no '## <description>' — it cannot appear in \`make help\``);
    }
  }
  return issues;
}

function checkHooksRegisteredInMakefile(): string[] {
  const issues: string[] = [];
  const postHooksDir = join(ompDir, "hooks", "post");
  const rootMakefilePath = join(cwd, "Makefile");

  if (!existsSync(postHooksDir)) {
    issues.push(".omp/hooks/post/ directory not found");
    return issues;
  }
  if (!existsSync(rootMakefilePath)) {
    issues.push("./Makefile: root Makefile not found");
    return issues;
  }

  const rootTargets = parseMakefileTargets(rootMakefilePath);

  for (const hookFile of readdirSync(postHooksDir)) {
    if (!hookFile.endsWith(".ts")) continue;

    // check-<name>.ts → make target <name>
    const targetName = hookFile.replace(/\.ts$/, "");
    if (!rootTargets.has(targetName)) {
      issues.push(`hook: '${hookFile}' not registered as make target '${targetName}' in root Makefile`);
    }
  }

  return issues;
}

function parseMarkdownTable(content: string): Set<string> {
  const targets = new Set<string>();
  const lines = content.split(/\r?\n/);
  let inMakefileTargets = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers — only parse the "Makefile Targets" section
    if (trimmed.startsWith("## ")) {
      inMakefileTargets = trimmed === "## Makefile Targets";
      continue;
    }

    // Only parse in the Makefile Targets section
    if (!inMakefileTargets) continue;

    // Match table rows: | `make target` | ... |
    const rowMatch = trimmed.match(/^\|.*?`make\s+(\S+?)`.*?\|/);
    if (rowMatch) {
      targets.add(rowMatch[1]);
      continue;
    }
  }

  return targets;
}

/**
 * Rules whose target is a bare pattern: `%:`, `%.o:`, `.DEFAULT:`. Each one
 * answers targets nobody wrote, which is indistinguishable from a check that
 * ran and passed.
 */
function catchAllRules(content: string): string[] {
  const found: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^(%[^\s:=]*|\.DEFAULT)\s*:(?!=)/.exec(line);
    if (match !== null) found.push(match[1]);
  }
  return found;
}

function parseMakefileTargets(makefilePath: string): Set<string> {
  const content = readFileSync(makefilePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const targets = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip .PHONY, comments, variable assignments
    if (trimmed.startsWith(".PHONY") || trimmed.startsWith("#") || trimmed.includes(":=")) {
      continue;
    }

    const targetMatch = trimmed.match(/^(\S+):\s*(.*)$/);
    if (targetMatch) {
      const targetName = targetMatch[1];
      // Skip special targets and variables
      if (!targetName.startsWith(".") && !targetName.includes("=")) {
        targets.add(targetName);
      }
      continue;
    }
  }

  return targets;
}

function checkTargetRecipes(makefilePath: string, label: string): string[] {
  const issues: string[] = [];
  const lines = readFileSync(makefilePath, "utf-8").split(/\r?\n/);
  let currentTarget = "";
  let hasRecipe = false;

  const flush = (): void => {
    if (currentTarget.startsWith("check-") && !hasRecipe) {
      issues.push(`${label}: target '${currentTarget}' has no recipe`);
    }
  };

  for (const line of lines) {
    const targetMatch = line.trim().match(/^(\S+):\s*(.*)$/);
    if (targetMatch && !targetMatch[1].startsWith(".")) {
      flush();
      currentTarget = targetMatch[1];
      hasRecipe = false;
      continue;
    }

    // Make recipes are tab-indented; ignore blank lines and comments.
    if (currentTarget && /^\s+\S/.test(line) && !line.trimStart().startsWith("#")) {
      hasRecipe = true;
    }
  }
  flush();
  return issues;
}

// Direct execution (make check-makefiles): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-makefiles.ts")) {
  const issues = checkMakefileConsistency();
  console.log("==> check-makefiles");
  if (issues.length === 0) {
    console.log("    PASS: Makefile consistent with root-makefile.md and the post hooks");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-makefiles");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
