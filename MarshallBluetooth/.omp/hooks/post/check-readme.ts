/**
 * Check-Readme Post Hook
 *
 * The README is the project's front page (root-readme.md). It goes stale in
 * ways no test notices: a renamed target, a moved file, a picture nobody
 * regenerates. And its recording runs the app against an in-memory speaker
 * that must never reach a user. This check holds both:
 *
 *   1. Every relative link and image in `README.md` resolves to a file.
 *   2. Every `make <target>` the README writes as code is a Makefile target.
 *   3. `docs/` holds only what the README shows, and the README shows pictures
 *      only from `docs/` — a picture elsewhere has no command that regenerates it.
 *   4. The demo speaker (`app/desktop/src/demo/`) is bundled only by
 *      `app/desktop/build.ts` under `ROADIE_DEMO`, imported by no app source,
 *      and `ROADIE_DEMO` is set by no Makefile recipe or workflow — only by the
 *      recorder, so no installer can carry it.
 *   5. The demo speaker exports every runtime name of the wrapper it stands in
 *      for (`app/src/native/marshallBle.ts`), so the recording runs the screen
 *      the installers ship.
 *
 * Reads files only; dormant (`absent`) without `README.md`.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join, normalize } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { dormant, passLine } from "../lib/hook-dormancy.ts";
import { resolveProjectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

const README = "README.md";
const DOCS = "docs";
const DEMO_DIR = "app/desktop/src/demo";
const DEMO_SPEAKER = `${DEMO_DIR}/marshallBle.ts`;
const DEMO_BUNDLER = "app/desktop/build.ts";
const DEMO_RECORDER = "app/desktop/demo.ts";
const WRAPPER = "app/src/native/marshallBle.ts";
const SCOPE = [README, `${DOCS}/`, DEMO_DIR, DEMO_BUNDLER, DEMO_RECORDER, WRAPPER, "Makefile", ".github/workflows/"];

/** App sources that could import the demo speaker; tests may, to test it. */
const SOURCE_DIRS = ["app/src", "app/desktop/src", "app/mobile/src"];
const SOURCE_FILES = ["app/App.tsx", "app/index.js", "app/metro.config.js"];
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
/** Where a build is configured: none may switch the demo speaker on. */
const BUILD_CONFIG = ["Makefile", "../.github/workflows"];

const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_SOURCE = /\b(?:src|srcset|href)="([^"]+)"/g;
const PICTURE = /\.(?:png|gif|jpe?g|svg|webp|mp4)$/i;
const RUNTIME_EXPORT = /^export\s+(?:async\s+)?(?:const|function|class|let)\s+(\w+)/gm;

// ============================================================
// Functions
// ============================================================

export default function checkReadme(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-readme", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, SCOPE)) return;

    const issues = checkReadmeSync();
    if (issues.length === 0) {
      resetSuppression("check-readme");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-readme",
      issues,
      "fix the README's reference, or regenerate its pictures with `make demo` / `make widget-snapshots`",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-readme") };
  }));
}

export function checkReadmeSync(): string[] {
  if (!existsSync(join(projectRoot, README))) {
    return dormant("check-readme", "absent", `no ${README} — no front page to hold to the code`);
  }
  const readme = readFileSync(join(projectRoot, README), "utf-8");
  const references = referencesOf(readme);

  const issues: string[] = [];
  issues.push(...checkReferences(references));
  issues.push(...checkMakeTargets(readme));
  issues.push(...checkDocs(references));
  issues.push(...checkDemoIsolation());
  issues.push(...checkDemoExports());
  return issues;
}

/** Every relative target the README links or shows, without its `#fragment`; prose in code is not a link. */
function referencesOf(readme: string): string[] {
  const prose = readme.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const targets = [...prose.matchAll(MARKDOWN_LINK), ...prose.matchAll(HTML_SOURCE)].map((m) => m[1]);
  return [...new Set(targets)]
    .filter((target) => !/^(?:[a-z]+:|#|\/\/)/i.test(target))
    .map((target) => target.split("#")[0])
    .filter((target) => target !== "");
}

/** Claim 1. */
function checkReferences(references: string[]): string[] {
  return references
    .filter((target) => !existsSync(join(projectRoot, decodeURIComponent(target))))
    .map((target) => `${README}: links ${target}, which does not exist — a reader follows it to a 404`);
}

/** Claim 2: the same reading `check-makefiles` gives the harness docs — only code is a command. */
function checkMakeTargets(readme: string): string[] {
  const makefile = join(projectRoot, "Makefile");
  if (!existsSync(makefile)) return [];
  const targets = new Set([...readFileSync(makefile, "utf-8").matchAll(/^([a-z][\w-]*):/gm)].map((m) => m[1]));
  const code = [...readme.matchAll(/```[\s\S]*?```/g), ...readme.matchAll(/`[^`\n]+`/g)].map((m) => m[0]).join("\n");
  const named = new Set([...code.matchAll(/\bmake\s+([a-z][\w-]{2,})/g)].map((m) => m[1]));
  return [...named]
    .filter((target) => !targets.has(target))
    .map((target) => `${README}: tells the reader to run \`make ${target}\`, which is not a Makefile target`);
}

/** Claim 3. */
function checkDocs(references: string[]): string[] {
  const issues: string[] = [];
  const shown = new Set(references.map((target) => normalize(decodeURIComponent(target))));
  for (const file of walk(DOCS, null)) {
    if (!shown.has(file)) {
      issues.push(`${file}: in ${DOCS}/ but not shown by ${README} — delete it, or show it`);
    }
  }
  for (const target of shown) {
    if (PICTURE.test(target) && !target.startsWith(`${DOCS}/`)) {
      issues.push(`${README}: shows ${target} from outside ${DOCS}/ — keep its pictures in ${DOCS}/, made by \`make demo\` or \`make widget-snapshots\``);
    }
  }
  return issues;
}

/** Claim 4. */
function checkDemoIsolation(): string[] {
  if (!existsSync(join(projectRoot, DEMO_DIR))) return [];
  const issues: string[] = [];
  const bundler = existsSync(join(projectRoot, DEMO_BUNDLER)) ? readFileSync(join(projectRoot, DEMO_BUNDLER), "utf-8") : "";
  if (!bundler.includes("'demo'") || !/process\.env\.ROADIE_DEMO\s*===\s*'1'/.test(bundler)) {
    issues.push(`${DEMO_BUNDLER}: does not bundle ${DEMO_DIR}/ behind \`process.env.ROADIE_DEMO === '1'\` — the demo speaker has no one gate, or no way in`);
  }
  const sources = [...SOURCE_DIRS.flatMap((dir) => walk(dir, SCRIPT_EXTENSIONS)), ...SOURCE_FILES.filter((file) => existsSync(join(projectRoot, file)))];
  for (const file of sources) {
    if (file.startsWith(`${DEMO_DIR}/`)) continue;
    const text = readFileSync(join(projectRoot, file), "utf-8");
    if (/from\s+'[^']*\/demo\/[^']*'|require\('[^']*\/demo\//.test(text)) {
      issues.push(`${file}: imports the demo speaker — every build would ship it; only ${DEMO_BUNDLER} swaps it in, for \`make demo\``);
    }
  }
  for (const config of BUILD_CONFIG) {
    for (const file of existsSync(join(projectRoot, config)) && statSync(join(projectRoot, config)).isDirectory() ? walk(config, [".yml", ".yaml"]) : [config]) {
      if (existsSync(join(projectRoot, file)) && readFileSync(join(projectRoot, file), "utf-8").includes("ROADIE_DEMO")) {
        issues.push(`${file}: sets ROADIE_DEMO — a build it configures would carry the demo speaker; only ${DEMO_RECORDER} sets it`);
      }
    }
  }
  return issues;
}

/** Claim 5. */
function checkDemoExports(): string[] {
  if (!existsSync(join(projectRoot, DEMO_SPEAKER)) || !existsSync(join(projectRoot, WRAPPER))) return [];
  const provided = runtimeExports(DEMO_SPEAKER);
  return [...runtimeExports(WRAPPER)]
    .filter((name) => !provided.has(name))
    .map((name) => `${DEMO_SPEAKER}: stands in for ${WRAPPER} but does not export ${name} — the recording would show a screen that fails`);
}

function runtimeExports(path: string): Set<string> {
  return new Set([...readFileSync(join(projectRoot, path), "utf-8").matchAll(RUNTIME_EXPORT)].map((m) => m[1]));
}

/** Project-relative files under `dir`; `extensions` null takes every file. */
function walk(dir: string, extensions: string[] | null): string[] {
  const abs = join(projectRoot, dir);
  if (!existsSync(abs)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (WALK_EXCLUDES.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walk(rel, extensions));
    else if (extensions === null || extensions.some((extension) => entry.name.endsWith(extension))) files.push(normalize(rel));
  }
  return files;
}

// Direct execution (make check-readme): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-readme.ts")) {
  const issues = checkReadmeSync();
  console.log("==> check-readme");
  if (issues.length === 0) {
    console.log(passLine("check-readme", "README links, make targets and pictures resolve; the demo speaker reaches no shipped build"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-readme");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
