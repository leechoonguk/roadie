/**
 * Check-Code-Layout Post Hook
 *
 * After tool execution, validates the layout standard in
 * .omp/rules/code-layout.md across **every** code surface — the React Native
 * TypeScript app and its package-root config, the Swift native core, adapters
 * and widget, the Objective-C bridge files, and the harness's own hooks:
 *
 *   1. comments: no commented-out code, no parked-work markers (WORK_MARKER),
 *      a JSDoc header on every hook and lib
 *   2. TypeScript/JavaScript file layout: imports, then constants, then
 *      export default, then the helpers it calls; a module constant is never
 *      declared with `let`
 *   3. TypeScript class member order: fields → constructor → public → private
 *   4. whitespace: no trailing whitespace, no tab indent outside Makefile
 *      recipes, LF only, exactly one final newline
 *
 * Arrangement drift is invisible in review but makes every file a new puzzle,
 * so it is checked rather than asked for.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

/** Text assets held to the whitespace standard. */
const HYGIENE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".swift", ".m", ".h", ".md", ".yml", ".yaml", ".css"];

/** An intention parked in a comment is never found again. */
const WORK_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;

/**
 * Comment lines that are really statements — dead code pretending to be prose.
 * `///` doc comments are prose by construction: the third slash keeps them
 * from matching, because the statement must follow `//` and whitespace only.
 */
const COMMENTED_CODE_TS =
  /^\s*\/\/\s*(?:import\s+[\w{*][^;]*from\s|export\s+(?:default|function|const)\s|function\s+\w+\s*\(|const\s+\w+\s*=\s*[^=]|return\s+\S)/;
const COMMENTED_CODE_NATIVE =
  /^\s*\/\/\s*(?:import\s+\w+\s*$|#import\s+[<"]|func\s+\w+\s*[(<]|(?:let|var)\s+\w+\s*(?::[^=]+)?=\s*\S|return\s+\S|(?:final\s+)?(?:class|struct|enum|protocol)\s+\w+\s*[:{]|RCT_EXTERN_\w+\()/;

/** TypeScript class members: state before behaviour. */
const TS_MEMBER_RANK: Record<string, number> = { field: 0, constructor: 1, method: 2 };
const TS_MEMBER_ORDER_TEXT = "fields → constructor → methods";

const TS_CLASS_OPEN = /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/;
const TS_CONSTRUCTOR = /^\s{2,}(?:private\s+|protected\s+|public\s+)?constructor\s*\(/;
const TS_METHOD =
  /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+|override\s+)*([#\w]+)\s*(?:<[^>]*>)?\(/;
const TS_FIELD = /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*([#\w]+)\s*[?!]?\s*[:=]/;

/** Every executable source extension of the JS side. */
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Native source extensions: Swift and the Objective-C bridge files. */
const NATIVE_EXTENSIONS = [".swift", ".m", ".h"];

/** Native source roots: the shared store, the app target (core + adapters), the widget. */
const NATIVE_ROOTS = ["app/macos/Shared", "app/macos/MarshallBluetooth-macOS", "app/macos/MarshallWidget"];

interface ClassBlock {
  name: string;
  body: string;
  line: number;
}

interface ClassMember {
  kind: string;
  name: string;
  line: number;
}

// ============================================================
// Functions
// ============================================================

export default function checkCodeLayout(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-code-layout", event, () => {
    // Read-only tools never change files — running the check after them wastes context.
    // hook-scope: global — layout applies wherever a new file appears
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkCodeLayoutSync();
    if (issues.length === 0) {
      resetSuppression("check-code-layout");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-code-layout",
      issues,
      "make check-code-layout",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-code-layout") };
  }));
}

export function checkCodeLayoutSync(): string[] {
  const issues: string[] = [];

  const scriptRoots = [
    join(projectRoot, ".omp", "hooks"),
    join(projectRoot, ".omp", "extensions"),
    join(projectRoot, "app", "src"),
    join(projectRoot, "app", "__tests__"),
  ];
  // Package-root files are code too: the entry points and the tool config
  // (babel, metro, jest, eslint, prettier). They are not walked recursively —
  // node_modules and macos/ are not script trees.
  const scriptPaths = [
    ...scriptRoots.flatMap((root) => walk(root, SCRIPT_EXTENSIONS)),
    ...walk(join(projectRoot, "app"), SCRIPT_EXTENSIONS, false),
  ];
  for (const path of scriptPaths) {
    const source = readFileSync(path, "utf-8");
    const label = relative(path);
    issues.push(...checkComments(label, source, COMMENTED_CODE_TS));
    issues.push(...checkScriptLayout(label, source, /\.omp[\\/](hooks|extensions)[\\/]/.test(path)));
    issues.push(...checkScriptClassOrder(label, source));
  }

  for (const path of NATIVE_ROOTS.flatMap((root) => walk(join(projectRoot, root), NATIVE_EXTENSIONS))) {
    issues.push(...checkComments(relative(path), readFileSync(path, "utf-8"), COMMENTED_CODE_NATIVE));
  }

  issues.push(...checkWhitespaceHygiene());

  return issues;
}

/**
 * Every text asset the project owns. Directories that belong to a tool
 * (`node_modules`, `Pods`, build output) are excluded, and so is the prior
 * reverse-engineering report (`README.md`), which is kept verbatim.
 */
function hygieneFiles(): string[] {
  const roots = [
    join(projectRoot, "app", "src"),
    join(projectRoot, "app", "__tests__"),
    ...NATIVE_ROOTS.map((root) => join(projectRoot, root)),
    join(projectRoot, ".omp", "rules"),
    join(projectRoot, ".omp", "hooks"),
    join(projectRoot, ".omp", "extensions"),
    join(projectRoot, ".omp", "skills"),
  ];
  const singles = [
    join(projectRoot, "Makefile"),
    join(projectRoot, "app", "App.tsx"),
    join(projectRoot, "app", "index.js"),
    join(projectRoot, "app", "macos", "Podfile"),
    join(projectRoot, ".omp", "AGENTS.md"),
    join(projectRoot, ".omp", "RULES.md"),
    join(projectRoot, ".omp", "config.yml"),
  ];
  return [
    ...roots.flatMap((root) => walk(root, HYGIENE_EXTENSIONS)),
    ...singles.filter((path) => existsSync(path)),
  ];
}

/**
 * Whitespace at a line's end or a file's edge is invisible in an editor and
 * loud in a diff: it turns a one-line change into a multi-line one and hides
 * the real edit. Every text asset in the project is held to the same shape.
 */
function checkWhitespaceHygiene(): string[] {
  const issues: string[] = [];
  for (const path of hygieneFiles()) {
    const source = readFileSync(path, "utf-8");
    if (source === "") continue;
    const label = relative(path);
    const isMakefile = path.endsWith("Makefile");

    if (source.includes("\r\n")) {
      issues.push(`${label}: CRLF line endings — the project is LF only`);
    }
    if (!source.endsWith("\n")) {
      issues.push(`${label}: no final newline — the last line is not a line`);
    } else if (source.endsWith("\n\n")) {
      issues.push(`${label}: blank line at end of file — keep exactly one final newline`);
    }

    source.split("\n").forEach((line: string, index: number) => {
      if (/[ \t]+$/.test(line)) {
        issues.push(`${label}:${index + 1}: trailing whitespace`);
      }
      if (!isMakefile && /^\t/.test(line)) {
        issues.push(`${label}:${index + 1}: tab indentation — spaces everywhere but Makefile recipes`);
      }
    });
  }
  return issues;
}

/** Comment hygiene — identical in every language. */
function checkComments(label: string, source: string, commentedCode: RegExp): string[] {
  const issues: string[] = [];
  source.split("\n").forEach((line, index) => {
    const position = `${label}:${index + 1}`;
    if (WORK_MARKER.test(line) && /(^|\s)(\/\/|\*)/.test(line)) {
      issues.push(
        `${position}: work marker in a comment — do it now or track it outside the code`,
      );
    }
    if (commentedCode.test(line)) {
      issues.push(
        `${position}: commented-out code — delete it, Git remembers (${line.trim().slice(0, 60)})`,
      );
    }
  });
  return issues;
}

/** Imports, then constants, then the entry point, then its helpers. */
function checkScriptLayout(label: string, source: string, isHook: boolean): string[] {
  const issues: string[] = [];
  const lines = source.split("\n");

  if (isHook && !source.slice(0, 2000).includes("/**")) {
    issues.push(
      `${label}: missing JSDoc header — a hook or lib whose purpose is undocumented ` +
        "cannot be reviewed against the rule it serves",
    );
  }

  lines.forEach((line, index) => {
    if (/^let\s+[A-Z][A-Z0-9_]*\s*[:=]/.test(line)) {
      issues.push(
        `${label}:${index + 1}: module constant declared with let — a reassignable ` +
          "constant is a lie; compute the value once and use const",
      );
    }
  });

  const lastImport = lines.reduce(
    (last, line, index) => (/^import\s/.test(line) ? index : last),
    -1,
  );
  if (lastImport === -1) return issues;

  const firstConstant = lines.findIndex((line) => /^const\s+[A-Za-z_]/.test(line));
  if (firstConstant !== -1 && firstConstant < lastImport) {
    issues.push(`${label}: a const is declared before the last import`);
  }
  const exportDefault = lines.findIndex((line) => /^export default function/.test(line));
  const firstFunction = lines.findIndex((line) => /^function\s/.test(line));
  if (exportDefault !== -1 && firstFunction !== -1 && firstFunction < exportDefault) {
    issues.push(
      `${label}: a helper function precedes "export default" — the file reads ` +
        "top-down from its entry point to its details",
    );
  }
  return issues;
}

/** TypeScript/JavaScript classes: state before behaviour, public before private. */
function checkScriptClassOrder(label: string, source: string): string[] {
  const issues: string[] = [];
  for (const block of splitScriptClasses(source)) {
    const members = scriptMembers(block.body);
    issues.push(...checkMemberRanks(label, block, members));

    const methods = members.filter((member) => member.kind === "method");
    const lastPublic = methods.filter((member) => !isPrivateName(member.name)).pop();
    const firstPrivate = methods.find((member) => isPrivateName(member.name));
    if (lastPublic !== undefined && firstPrivate !== undefined && firstPrivate.line < lastPublic.line) {
      issues.push(
        `${label}:${block.line + firstPrivate.line}: ${block.name}.${firstPrivate.name}() is ` +
          `private but precedes public ${lastPublic.name}() — helpers belong below the ` +
          "public surface",
      );
    }
  }
  return issues;
}

// ============================================================
// Helpers
// ============================================================

function walk(dir: string, extensions: string[], recursive = true): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_EXCLUDES.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) found.push(...walk(path, extensions));
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

/** Members must appear in rank order; the first regression names both sides. */
function checkMemberRanks(label: string, block: ClassBlock, members: ClassMember[]): string[] {
  const issues: string[] = [];
  let highest = -1;
  let highestKind = "";
  for (const member of members) {
    const rank = TS_MEMBER_RANK[member.kind];
    if (rank < highest) {
      issues.push(
        `${label}:${block.line + member.line}: ${block.name}.${member.name} — ` +
          `${member.kind} declared after ${highestKind}; members run ${TS_MEMBER_ORDER_TEXT}`,
      );
      continue;
    }
    highest = rank;
    highestKind = member.kind;
  }
  return issues;
}

/** Class bodies in TS/JS, delimited by brace depth. */
function splitScriptClasses(source: string): ClassBlock[] {
  const lines = source.split("\n");
  const classes: ClassBlock[] = [];
  lines.forEach((line, index) => {
    const start = TS_CLASS_OPEN.exec(line);
    if (start === null) return;
    let depth = 0;
    let end = index;
    while (end < lines.length) {
      for (const character of lines[end]) {
        if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
      }
      if (depth === 0 && end > index) break;
      end += 1;
    }
    classes.push({ name: start[1], body: lines.slice(index, end + 1).join("\n"), line: index + 1 });
  });
  return classes;
}

/**
 * Members declared directly in a TS/JS class body. Parentheses are tracked as
 * well as braces: a constructor signature that wraps keeps the brace depth at
 * 1, and every parameter line (`status: number,`) would otherwise read as a
 * field declared after the constructor.
 */
function scriptMembers(body: string): ClassMember[] {
  const members: ClassMember[] = [];
  let depth = 0;
  let paren = 0;
  body.split("\n").forEach((line, index) => {
    if (depth === 1 && paren === 0) {
      const method = TS_METHOD.exec(line);
      const field = TS_FIELD.exec(line);
      if (TS_CONSTRUCTOR.test(line)) members.push({ kind: "constructor", name: "constructor", line: index });
      else if (method !== null) members.push({ kind: "method", name: method[1], line: index });
      else if (field !== null) members.push({ kind: "field", name: field[1], line: index });
    }
    for (const character of line) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === "(") paren += 1;
      else if (character === ")") paren -= 1;
    }
  });
  return members;
}

function isPrivateName(name: string): boolean {
  return name.startsWith("#") || name.startsWith("_");
}

function relative(path: string): string {
  return path.startsWith(projectRoot) ? path.slice(projectRoot.length + 1) : path;
}

// Direct execution (make check-code-layout): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-code-layout.ts")) {
  const issues = checkCodeLayoutSync();
  console.log("==> check-code-layout");
  if (issues.length === 0) {
    console.log("    PASS: code layout standard valid");
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-code-layout");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
