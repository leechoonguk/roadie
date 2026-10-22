/**
 * Check-App-Duplicate-Blocks Post Hook
 *
 * Validates app-duplicate-blocks.md: 편집 직후, 방금 쓴 파일에 같은 줄 묶음이 두 벌이면
 * 즉시 알린다 — 게이트까지 기다리면 도메인 검사의 2차 증상(순번 어긋남 등)이 먼저 보여
 * 원인을 가린다(재번호 루프 실측).
 *
 * This is a read-only check — it does NOT block tool calls.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { isAbsolute, join, relative } from "node:path";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { FILE_EDIT_TOOLS } from "../lib/hook-mutating-tools.ts";
import { writtenPaths } from "../lib/hook-tool-paths.ts";
import { checkFileForDuplicates, scanTree } from "../lib/app-duplicate-blocks.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";
import { touchesPath } from "../lib/hook-scope.ts";

const projectRoot = resolveProjectRoot();
// 파일을 쓰는 툴만 본다(bash 는 writtenPaths 가 어차피 빈 배열) — read-only 필터 계약상 이름은 MUTATING_TOOLS.
const MUTATING_TOOLS = new Set<string>(FILE_EDIT_TOOLS);

export default function checkAppDuplicateBlocks(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-app-duplicate-blocks", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!event.toolName) return;
    if (!touchesPath(event, ["app/"])) return;
    const issues: string[] = [];
    for (const p of writtenPaths(String(event.toolName ?? ""), event.input ?? {})) {
      if (!p.includes("app/")) continue;
      const abs = isAbsolute(p) ? p : join(projectRoot, p);
      const display = isAbsolute(p) ? relative(projectRoot, p) : p;
      issues.push(...checkFileForDuplicates(abs, display));
    }
    if (issues.length === 0) { resetSuppression("check-app-duplicate-blocks"); return; }
    const warning = buildSafeWarning(event.toolName, "check-app-duplicate-blocks", issues,
      "run make check-app-duplicate-blocks for details");
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-app-duplicate-blocks") };
  }));
}

// Direct execution (make check-app-duplicate-blocks): scan the tree and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-app-duplicate-blocks.ts")) {
  const issues = scanTree(projectRoot);
  console.log("==> check-app-duplicate-blocks");
  if (issues.length === 0) {
    console.log("    PASS: no duplicated block runs in app/ source files");
  } else {
    for (const issue of issues) console.log(`    FAIL: ${issue}`);
    printRuleHint("check-app-duplicate-blocks");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
