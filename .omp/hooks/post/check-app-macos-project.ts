/**
 * Check-App-macOS-Project Post Hook
 *
 * Holds the Xcode project to the files and the settings the app actually needs
 * (app-macos-project.md). Every claim below is a failure that built cleanly and
 * broke only at run time, where no other gate looks:
 *
 *   1. Target membership — every `.swift`/`.m` under a target's source tree is
 *      compiled into that target (`Shared/` into every native target), no
 *      target compiles a file from another target's tree, and no target
 *      compiles a file that is gone. A source file on disk but outside the
 *      project is invisible to `make build`: the app links without it.
 *   2. Team signing — every target configuration that signs with entitlements
 *      names a `DEVELOPMENT_TEAM`. An ad-hoc signature drops the team prefix
 *      from the App Group, and macOS then refuses the shared container without
 *      ever prompting, so the widget shows a sample and its buttons go grey.
 *   3. One App Group — both entitlements files and both Info.plists name the
 *      same `$(TeamIdentifierPrefix)…` group; the app and the widget agree or
 *      share nothing.
 *   4. One name — the app's `PRODUCT_NAME` and both `CFBundleDisplayName`s are
 *      equal. The widget gallery lists the containing bundle's name, so a
 *      renamed display name with a stale product name hides the widget.
 *   5. Menu bar residency — an `LSUIElement` app keeps running when its last
 *      window closes (`applicationShouldTerminateAfterLastWindowClosed` →
 *      false); otherwise closing the window quits the process the widget
 *      relies on.
 *   6. Bluetooth declared — when the app target compiles CoreBluetooth, its
 *      Info.plist carries `NSBluetoothAlwaysUsageDescription` and a sandboxed
 *      app holds `com.apple.security.device.bluetooth`; without either the
 *      process is killed or the central never powers on.
 *
 * Reads files only. Dormant (cause `absent`) while the project file does not exist.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { basename, join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { dormant, passLine } from "../lib/hook-dormancy.ts";
import { resolveProjectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";
import { APPLICATION, parseProject, plistArray, plistString, plistTrue, type Project } from "../lib/app-xcode-project.ts";

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

const MACOS_DIR = "app/macos";
const PROJECT_FILE = "app/macos/MarshallBluetooth.xcodeproj/project.pbxproj";

/** Source trees compiled into every native target rather than one. */
const SHARED_DIR = "app/macos/Shared";

const SOURCE_EXTENSIONS = [".swift", ".m"];

// ============================================================
// Functions
// ============================================================

export default function checkAppMacosProject(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-app-macos-project", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["app/macos/"])) return;

    const issues = checkAppMacosProjectSync();
    if (issues.length === 0) {
      resetSuppression("check-app-macos-project");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-app-macos-project",
      issues,
      "register sources in their target, sign with a team, keep App Group and names in agreement",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-app-macos-project") };
  }));
}

export function checkAppMacosProjectSync(): string[] {
  if (!existsSync(join(projectRoot, PROJECT_FILE))) {
    return dormant("check-app-macos-project", "absent", "no Xcode project under app/macos/");
  }
  const project = parseProject(readFileSync(join(projectRoot, PROJECT_FILE), "utf-8"), MACOS_DIR);
  if (project.targets.length === 0) {
    return [`${PROJECT_FILE}: read no PBXNativeTarget — the project parser is blind, every claim below would pass on nothing`];
  }

  const issues: string[] = [];
  issues.push(...checkMembership(project));
  issues.push(...checkSigningAndGroups(project));
  issues.push(...checkIdentity(project));
  issues.push(...checkResidencyAndBluetooth(project));
  return issues;
}

/** Claim 1: each target compiles exactly the sources of its own tree plus `Shared/`. */
function checkMembership(project: Project): string[] {
  const issues: string[] = [];
  const onDisk = new Map<string, string>();
  const trees = [SHARED_DIR, ...project.targets.map((target) => `${MACOS_DIR}/${target.name}`)];
  for (const tree of trees) {
    for (const path of walk(tree)) {
      const name = basename(path);
      const earlier = onDisk.get(name);
      if (earlier !== undefined) {
        issues.push(`${path}: shares its file name with ${earlier} — the project references files by name, so one of them cannot be told apart`);
        continue;
      }
      onDisk.set(name, path);
    }
  }

  for (const target of project.targets) {
    if (target.sourcesRead !== target.sourcesDeclared) {
      issues.push(`${PROJECT_FILE}: target ${target.name} lists ${target.sourcesDeclared} sources but ${target.sourcesRead} resolved to a file reference — the membership check is blind to the rest`);
    }
    const ownTree = `${MACOS_DIR}/${target.name}/`;
    const expected = [...onDisk.values()].filter(
      (path) => path.startsWith(ownTree) || path.startsWith(`${SHARED_DIR}/`),
    );
    for (const path of expected) {
      if (target.sources.has(basename(path))) continue;
      issues.push(
        `${path}: exists but is not compiled into target ${target.name} — add it to the target in ${PROJECT_FILE} (PBXFileReference, PBXBuildFile, the target's Sources phase), or \`make build\` links without it`,
      );
    }
    for (const name of target.sources) {
      const path = onDisk.get(name);
      if (path === undefined) {
        issues.push(`${PROJECT_FILE}: target ${target.name} compiles ${name}, which no longer exists under ${MACOS_DIR}/ — remove the stale reference`);
      } else if (!path.startsWith(ownTree) && !path.startsWith(`${SHARED_DIR}/`)) {
        issues.push(`${PROJECT_FILE}: target ${target.name} compiles ${path}, which belongs to another target's tree — share it through ${SHARED_DIR}/ instead`);
      }
    }
  }
  return issues;
}

/** Claims 2 and 3: a team on every signed configuration, one App Group everywhere. */
function checkSigningAndGroups(project: Project): string[] {
  const issues: string[] = [];
  const groups = new Map<string, string>();
  for (const target of project.targets) {
    for (const config of target.configs) {
      const entitlements = config.settings.get("CODE_SIGN_ENTITLEMENTS");
      if (entitlements === undefined) continue;
      if (!config.settings.get("DEVELOPMENT_TEAM")) {
        issues.push(
          `${PROJECT_FILE}: target ${target.name} (${config.name}) signs with entitlements but names no DEVELOPMENT_TEAM — ` +
            "an ad-hoc signature drops the team prefix from the App Group and macOS refuses the shared container without a prompt",
        );
      }
      const path = `${MACOS_DIR}/${entitlements}`;
      const content = readProjectFile(path);
      if (content === null) {
        issues.push(`${PROJECT_FILE}: target ${target.name} names ${path} as CODE_SIGN_ENTITLEMENTS but no such file exists`);
        continue;
      }
      for (const group of plistArray(content, "com.apple.security.application-groups")) {
        groups.set(`${path}`, group);
      }
    }
    const plist = target.infoPlist === null ? null : readProjectFile(target.infoPlist);
    const declared = plist === null ? undefined : plistString(plist, "AppGroupIdentifier");
    if (declared !== undefined && target.infoPlist !== null) groups.set(target.infoPlist, declared);
  }

  const distinct = new Set(groups.values());
  if (distinct.size > 1) {
    issues.push(
      `${MACOS_DIR}/: App Group differs between ${[...groups].map(([path, group]) => `${path}=${group}`).join(", ")} — ` +
        "the app and the widget share a container only when every entitlements file and Info.plist names the same group",
    );
  }
  for (const [path, group] of groups) {
    if (!group.startsWith("$(TeamIdentifierPrefix)")) {
      issues.push(`${path}: App Group ${group} does not start with $(TeamIdentifierPrefix) — the signed group then differs per machine and per team`);
    }
  }
  return issues;
}

/** Claim 4: the product name and every display name agree. */
function checkIdentity(project: Project): string[] {
  const issues: string[] = [];
  const app = project.targets.find((target) => target.productType === APPLICATION);
  if (app === undefined) {
    return [`${PROJECT_FILE}: no target has product type ${APPLICATION} — the identity and residency checks have no app to read`];
  }
  const names = new Map<string, string>();
  for (const config of app.configs) {
    const product = config.settings.get("PRODUCT_NAME");
    if (product !== undefined) names.set(`${app.name} PRODUCT_NAME (${config.name})`, product);
  }
  for (const target of project.targets) {
    const plist = target.infoPlist === null ? null : readProjectFile(target.infoPlist);
    const display = plist === null ? undefined : plistString(plist, "CFBundleDisplayName");
    if (display !== undefined && target.infoPlist !== null) {
      names.set(`${target.infoPlist} CFBundleDisplayName`, display);
    } else if (target.infoPlist !== null) {
      issues.push(`${target.infoPlist}: has no CFBundleDisplayName — the widget gallery and the menu bar fall back to the bundle name`);
    }
  }
  if (new Set(names.values()).size > 1) {
    issues.push(
      `${MACOS_DIR}/: product and display names disagree (${[...names].map(([where, name]) => `${where}=${name}`).join(", ")}) — ` +
        "the widget gallery lists the containing bundle's name, so a stale one hides the widget",
    );
  }
  return issues;
}

/** Claims 5 and 6: a menu bar app outlives its window; a Bluetooth app declares Bluetooth. */
function checkResidencyAndBluetooth(project: Project): string[] {
  const issues: string[] = [];
  const app = project.targets.find((target) => target.productType === APPLICATION);
  if (app === undefined || app.infoPlist === null) return issues;
  const plist = readProjectFile(app.infoPlist);
  if (plist === null) {
    return [`${PROJECT_FILE}: target ${app.name} names ${app.infoPlist} as INFOPLIST_FILE but no such file exists`];
  }
  const appTree = walk(`${MACOS_DIR}/${app.name}`);

  if (plistTrue(plist, "LSUIElement")) {
    const delegate = appTree.find((path) => basename(path) === "AppDelegate.swift");
    const code = delegate === undefined ? "" : readProjectFile(delegate) ?? "";
    if (!/applicationShouldTerminateAfterLastWindowClosed[^{]*\{\s*(?:return\s+)?false\s*\}/.test(code)) {
      issues.push(
        `${app.infoPlist}: LSUIElement is set but ${delegate ?? `${MACOS_DIR}/${app.name}/AppDelegate.swift`} does not return false from ` +
          "applicationShouldTerminateAfterLastWindowClosed — closing the window quits the menu bar app the widget relies on",
      );
    }
  }

  const usesBluetooth = appTree.some(
    (path) => path.endsWith(".swift") && /^\s*import\s+CoreBluetooth\b/m.test(readProjectFile(path) ?? ""),
  );
  if (!usesBluetooth) return issues;
  if (!plistString(plist, "NSBluetoothAlwaysUsageDescription")) {
    issues.push(`${app.infoPlist}: target ${app.name} imports CoreBluetooth but declares no NSBluetoothAlwaysUsageDescription — macOS kills the process at the first Bluetooth call`);
  }
  const entitlementsPath = app.configs.map((config) => config.settings.get("CODE_SIGN_ENTITLEMENTS")).find(Boolean);
  const entitlements = entitlementsPath === undefined ? null : readProjectFile(`${MACOS_DIR}/${entitlementsPath}`);
  if (entitlements !== null && plistTrue(entitlements, "com.apple.security.app-sandbox") &&
    !plistTrue(entitlements, "com.apple.security.device.bluetooth")) {
    issues.push(`${MACOS_DIR}/${entitlementsPath}: the sandboxed app imports CoreBluetooth but lacks com.apple.security.device.bluetooth — the central never powers on`);
  }
  return issues;
}

// ============================================================
// Helpers
// ============================================================

/** Project-relative source files under `dir`, or none when the tree does not exist. */
function walk(dir: string): string[] {
  const abs = join(projectRoot, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (WALK_EXCLUDES.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walk(path));
    } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

/** A project file's text, or null when it does not exist; each caller reports the absence itself. */
function readProjectFile(path: string): string | null {
  const abs = join(projectRoot, path);
  return existsSync(abs) ? readFileSync(abs, "utf-8") : null;
}

// Direct execution (make check-app-macos-project): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-app-macos-project.ts")) {
  const issues = checkAppMacosProjectSync();
  console.log("==> check-app-macos-project");
  if (issues.length === 0) {
    console.log(passLine("check-app-macos-project", "Xcode project: sources, signing, App Group, names and residency agree"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-app-macos-project");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
