import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesStrict } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

declare const process: {
  argv: string[];
  cwd(): string;
  exitCode?: number;
};

/**
 * Check-OMP-Skills Post Hook
 *
 * Validates the bidirectional contract between the managed skills catalog in
 * .omp/rules/omp-skills.md and native skill discovery at
 * .omp/skills/<name>/SKILL.md. Runtime discovery remains file-backed; the
 * catalog provides the trigger, verification, and lifecycle metadata.
 *
 * It also holds the **skill harness contract**: a domain skill's mechanical
 * enforcement is the post hooks *named after it* (a skill `pairing` would own
 * `check-app-pairing`), the SKILL.md frontmatter declares that same set
 * under `enforced-by`, and every declared hook must be a prerequisite of the
 * root `make verify`. A procedure skill owns no hook, declares
 * `enforced-by: []`, and must reference at least one `rule://` domain that
 * carries its enforcement instead.
 */
const cwd = process.cwd();
const skillsDir = join(cwd, ".omp", "skills");
const catalogPath = join(cwd, ".omp", "rules", "omp-skills.md");
const hooksPostDir = join(cwd, ".omp", "hooks", "post");
const makefilePath = join(cwd, "Makefile");
const CATALOG_HEADER = "| Skill | Trigger | Verification | Lifecycle (project metadata) |";

/** Read-only tools never change skills or their catalog. */

interface CatalogRow {
  trigger: string;
  verification: string;
  lifecycle: string;
}

export default function checkOmpSkills(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-omp-skills", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesStrict(event, [".omp/"])) return;

    const issues = checkOmpSkillsSync();
    if (issues.length === 0) {
      resetSuppression("check-omp-skills");
      return;
    }

    const warning = buildSafeWarning(
      event.toolName,
      "check-omp-skills",
      issues,
      "update .omp/rules/omp-skills.md and .omp/skills/<name>/SKILL.md together",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-omp-skills") };
  }));
}

export function checkOmpSkillsSync(): string[] {
  const issues: string[] = [];
  const catalog = readCatalog(issues);
  const discovered = readDiscoveredSkills(issues);

  for (const [name, row] of catalog) {
    if (!row.trigger) issues.push(`catalog row '${name}' has an empty Trigger`);
    if (!row.verification) issues.push(`catalog row '${name}' has an empty Verification`);
    if (row.lifecycle !== "active" && row.lifecycle !== "deprecated") {
      issues.push(`catalog row '${name}' has invalid Lifecycle '${row.lifecycle}' (use active or deprecated)`);
    }
    if (!discovered.has(name)) {
      issues.push(`catalog row '${name}' has no matching .omp/skills/${name}/SKILL.md`);
    }
  }

  for (const name of discovered) {
    if (!catalog.has(name)) {
      issues.push(`skill '${name}' is missing from the Skill Catalog table`);
    }
  }

  checkSkillHarness(issues);
  return issues;
}

function readCatalog(issues: string[]): Map<string, CatalogRow> {
  const catalog = new Map<string, CatalogRow>();
  if (!existsSync(catalogPath)) {
    // premature-ok: 프로젝트 기반 파일의 부재는 작업 순서가 아니라 설정 결함이다 — 어느 단계에서든 참이다.
    issues.push(".omp/rules/omp-skills.md not found");
    return catalog;
  }

  const lines = readFileSync(catalogPath, "utf-8").split(/\r?\n/);
  let inCatalog = false;
  let foundSection = false;
  let foundHeader = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      inCatalog = trimmed === "## Skill Catalog";
      foundSection ||= inCatalog;
      continue;
    }
    if (!inCatalog || !trimmed.startsWith("|")) continue;
    if (trimmed === CATALOG_HEADER) {
      foundHeader = true;
      continue;
    }
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue;
    if (/^\|\s*Skill\s*\|/.test(trimmed)) {
      issues.push(`Skill Catalog must use header: ${CATALOG_HEADER}`);
      continue;
    }

    const cells = trimmed.match(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
    if (!cells) {
      issues.push(`invalid Skill Catalog row: ${trimmed}`);
      continue;
    }
    const [, name, trigger, verification, lifecycle] = cells;
    if (catalog.has(name)) {
      issues.push(`Skill Catalog contains duplicate row '${name}'`);
      continue;
    }
    catalog.set(name, { trigger, verification, lifecycle });
  }

  if (!foundSection) issues.push("missing '## Skill Catalog' section in .omp/rules/omp-skills.md");
  if (!foundHeader) issues.push(`.omp/rules/omp-skills.md: Skill Catalog header must be ${CATALOG_HEADER}`);
  return catalog;
}

function readDiscoveredSkills(issues: string[]): Set<string> {
  const discovered = new Set<string>();
  if (!existsSync(skillsDir)) {
    issues.push(".omp/skills/ directory not found");
    return discovered;
  }

  for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort(
    (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    const frontmatter = readFrontmatter(readFileSync(skillPath, "utf-8"));
    if (!frontmatter) {
      issues.push(`skill '${entry.name}' is missing YAML frontmatter`);
      continue;
    }
    const name = fieldValue(frontmatter, "name");
    const description = fieldValue(frontmatter, "description");
    if (!name) {
      issues.push(`skill '${entry.name}' is missing frontmatter name`);
      continue;
    }
    if (name !== entry.name) {
      issues.push(`skill '${entry.name}' frontmatter name must equal directory name (found '${name}')`);
      continue;
    }
    if (!description) issues.push(`skill '${entry.name}' is missing frontmatter description`);
    discovered.add(name);
  }

  return discovered;
}

function readFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] ?? null;
}

function fieldValue(frontmatter: string, field: string): string {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
}

/**
 * The skill harness contract, three-way and name-driven.
 *
 * Ownership is read off the filename — a post hook whose hyphen tokens contain
 * the skill's name contiguously is that skill's harness — so there is no
 * comment marker to drift. The frontmatter's `enforced-by` list must equal the
 * name-derived set, every hook in it must exist, and each must be a
 * prerequisite of the root `make verify`: a skill invariant outside the gate
 * is a check nobody runs.
 */
function checkSkillHarness(issues: string[]): void {
  if (!existsSync(skillsDir) || !existsSync(hooksPostDir)) return;
  const postHooks = readdirSync(hooksPostDir)
    .filter((file: string) => file.endsWith(".ts"))
    .map((file: string) => file.replace(/\.ts$/, ""));
  const verifyTargets = readVerifyTargets();
  for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort(
    (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf-8");
    const frontmatter = readFrontmatter(content);
    if (!frontmatter) continue; // absence already reported by discovery
    const declared = fieldList(frontmatter, "enforced-by");
    const derived = postHooks.filter((stem: string) => nameOwns(entry.name, stem)).sort();
    if (declared === null) {
      issues.push(
        `skill '${entry.name}' has no enforced-by frontmatter — declare its harness ` +
          `(name-derived set today: ${derived.length > 0 ? derived.join(", ") : "[]"})`,
      );
      continue;
    }
    for (const hook of declared) {
      if (!postHooks.includes(hook)) {
        issues.push(`skill '${entry.name}' declares enforced-by '${hook}' but .omp/hooks/post/${hook}.ts does not exist`);
        continue;
      }
      if (!derived.includes(hook)) {
        issues.push(
          `skill '${entry.name}' declares enforced-by '${hook}' but the hook's name does not carry ` +
            "the skill's — ownership is read off the filename, so rename one side until they agree",
        );
      }
      if (!verifyTargets.has(hook)) {
        issues.push(
          `skill '${entry.name}' harness '${hook}' is not a prerequisite of the root 'make verify' — ` +
            "a skill invariant outside the gate is a check nobody runs",
        );
      }
    }
    for (const stem of derived) {
      if (!declared.includes(stem)) {
        issues.push(`post hook '${stem}' is named after skill '${entry.name}' but the skill does not declare it in enforced-by`);
      }
    }
    if (declared.length === 0 && !content.includes("rule://")) {
      issues.push(
        `skill '${entry.name}' owns no harness (enforced-by: []) and references no rule:// domain — ` +
          "its steps answer to no mechanical check",
      );
    }
  }
}

/** Whether a hook stem's hyphen tokens contain the skill's, contiguously. */
function nameOwns(skill: string, stem: string): boolean {
  const skillTokens = skill.split("-");
  const stemTokens = stem.split("-");
  for (let start = 0; start + skillTokens.length <= stemTokens.length; start += 1) {
    if (skillTokens.every((token, offset) => stemTokens[start + offset] === token)) return true;
  }
  return false;
}

/** The root Makefile's `verify:` prerequisite list. */
function readVerifyTargets(): Set<string> {
  if (!existsSync(makefilePath)) return new Set();
  const line = readFileSync(makefilePath, "utf-8")
    .split(/\r?\n/)
    .find((candidate: string) => candidate.startsWith("verify:"));
  if (!line) return new Set();
  const targets = line.replace(/^verify:\s*/, "").split("##")[0].trim();
  return new Set(targets.split(/\s+/).filter(Boolean));
}

/**
 * A frontmatter list field: `field: []` inline, or `- item` lines below the
 * key. `null` means the key is absent — distinct from an empty declaration.
 */
function fieldList(frontmatter: string, field: string): string[] | null {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line: string) => line.startsWith(`${field}:`));
  if (start === -1) return null;
  const inline = lines[start].slice(field.length + 1).trim();
  if (inline === "[]") return [];
  if (inline !== "") {
    return inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
  }
  const items: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const item = lines[index].match(/^\s+-\s+(.+?)\s*$/);
    if (!item) break;
    items.push(item[1]);
  }
  return items;
}

// Direct execution (make check-omp-skills): run the same check on demand.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-omp-skills.ts")) {
  const issues = checkOmpSkillsSync();
  console.log("==> check-omp-skills");
  if (issues.length === 0) {
    console.log("    PASS: skills catalog matches discovered SKILL.md files");
  } else {
    for (const issue of issues) console.error(`    FAIL: ${issue}`);
    printRuleHint("check-omp-skills");
    process.exitCode = 1;
  }
}
