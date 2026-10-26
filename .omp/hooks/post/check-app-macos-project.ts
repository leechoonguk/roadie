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
 *   7. One build location — Xcode (through the workspace's shared
 *      WorkspaceSettings.xcsettings), every `xcodebuild` in the root Makefile
 *      and the release builder all build into `app/macos/build/DerivedData.noindex`.
 *      Xcode's default DerivedData is keyed by the repository's path, so every
 *      move or clone left one more Roadie.app that Spotlight, Launchpad and the
 *      widget gallery list beside the installed one; the `.noindex` suffix keeps
 *      Spotlight out of the one that remains. ESLint ignores `macos/build/**`:
 *      the build output holds generated and vendored JS that is not a source.
 *   8. One registered copy, Metro first — `make run` probes Metro (`app-doctor.ts metro`,
 *      port 8081) before the slow build (Debug loads its JS from Metro: without it the
 *      window is empty), drops every other registered Roadie.app and the Release
 *      widget registration (the widget host prefers a Release copy's higher
 *      version over the Debug build being developed); `make clean` unregisters
 *      every build copy before deleting it.
 *   9. A main window the menu can reopen — an `LSUIElement` app opens its window
 *      from the menu bar item, and SwiftUI drops the NSWindow of a `Window(` or
 *      `WindowGroup(` scene once it is closed, so "Open Roadie" then opens nothing.
 *      The app owns an `NSWindow` and keeps it (`isReleasedWhenClosed = false`);
 *      its scenes are `Settings { EmptyView() }` only.
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
import { projectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";
import { APPLICATION, parseProject, plistArray, plistString, plistTrue, type Project } from "../lib/app-xcode-project.ts";

// ============================================================
// Constants
// ============================================================

const MACOS_DIR = "app/macos";
const PROJECT_FILE = "app/macos/MarshallBluetooth.xcodeproj/project.pbxproj";

/** Source trees compiled into every native target rather than one. */
const SHARED_DIR = "app/macos/Shared";

const SOURCE_EXTENSIONS = [".swift", ".m"];

/** The one directory every macOS build lands in (claim 7). */
const DERIVED_DATA = "app/macos/build/DerivedData.noindex";
const WORKSPACE_SETTINGS = "app/macos/MarshallBluetooth.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings";
const RELEASE_BUILDER = ".omp/hooks/lib/app-release.ts";
const ESLINT_CONFIG = "app/.eslintrc.js";

// ============================================================
// Functions
// ============================================================

export default function checkAppMacosProject(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-app-macos-project", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["app/macos/", "Makefile", RELEASE_BUILDER, ESLINT_CONFIG])) return;

    const issues = checkAppMacosProjectSync();
    if (issues.length === 0) {
      resetSuppression("check-app-macos-project");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-app-macos-project",
      issues,
      "register sources in their target, sign with a team, keep App Group and names in agreement, own the main window in AppKit, build only into app/macos/build/DerivedData.noindex",
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
  issues.push(...checkMainWindow(project));
  issues.push(...checkBuildLocation());
  issues.push(...checkRunAndCleanRecipes());
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

/** Claim 7: Xcode, the Makefile and the release builder share one DerivedData inside the project. */
function checkBuildLocation(): string[] {
  const issues: string[] = [];
  const scattered = "Xcode then builds into ~/Library/Developer/Xcode/DerivedData/<path hash>, and each move or clone leaves another Roadie.app listed beside the installed one";
  const settings = readProjectFile(WORKSPACE_SETTINGS);
  if (settings === null) {
    issues.push(`${WORKSPACE_SETTINGS}: missing — ${scattered}`);
  } else if (
    plistString(settings, "DerivedDataLocationStyle") !== "WorkspaceRelativePath" ||
    plistString(settings, "DerivedDataCustomLocation") !== "build/DerivedData.noindex"
  ) {
    issues.push(`${WORKSPACE_SETTINGS}: DerivedData is not WorkspaceRelativePath build/DerivedData.noindex — ${scattered}`);
  }

  const makefile = readProjectFile("Makefile") ?? "";
  makefile.split("\n").forEach((line, index) => {
    if (!line.startsWith("\t")) return;
    if (/\bxcodebuild\b/.test(line) && !/-showBuildSettings\b/.test(line) && !/-derivedDataPath\s+\S/.test(line)) {
      issues.push(`Makefile:${index + 1}: xcodebuild without -derivedDataPath — ${scattered}`);
    }
    if (/react-native\s+run-macos\b/.test(line)) {
      issues.push(`Makefile:${index + 1}: react-native run-macos builds into Xcode's default DerivedData — build with xcodebuild -derivedDataPath (make run)`);
    }
  });
  if (makefile !== "" && !/^DERIVED_DATA\s*:?=\s*\$\(MACOS\)\/build\/DerivedData\.noindex\s*$/m.test(makefile)) {
    issues.push(`Makefile: DERIVED_DATA is not $(MACOS)/build/DerivedData.noindex — Debug and Release builds must share ${DERIVED_DATA}`);
  }

  const release = readProjectFile(RELEASE_BUILDER);
  if (release !== null && !release.includes(`const DERIVED_DATA = "${DERIVED_DATA}"`)) {
    issues.push(`${RELEASE_BUILDER}: the Release build does not use ${DERIVED_DATA}`);
  }

  const eslint = readProjectFile(ESLINT_CONFIG);
  if (eslint !== null && !/ignorePatterns:[^\]]*['"]macos\/build\/\*\*['"]/.test(eslint)) {
    issues.push(`${ESLINT_CONFIG}: ignorePatterns omit 'macos/build/**' — eslint walks the DerivedData output (generated and vendored JS) as if it were source`);
  }
  return issues;
}

/** The recipe lines of a Makefile target: the tab-indented lines right below `target:`. */
function recipeOf(makefile: string, target: string): string | null {
  const lines = makefile.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${target}:`));
  if (start < 0) return null;
  const recipe: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("\t")) break;
    recipe.push(line);
  }
  return recipe.join("\n");
}

/** Claim 8: `make run` and `make clean` keep exactly one registered copy, and run needs Metro first. */
function checkRunAndCleanRecipes(): string[] {
  const issues: string[] = [];
  const makefile = readProjectFile("Makefile") ?? "";
  const run = recipeOf(makefile, "run");
  if (run !== null) {
    const metro = run.indexOf("app-doctor.ts metro");
    const build = run.indexOf("$(MAKE) build");
    if (metro < 0 || build < 0 || metro > build) {
      issues.push("Makefile: `run` does not call `node .omp/hooks/lib/app-doctor.ts metro` (the Metro probe on port 8081) before `$(MAKE) build` — Debug loads its JS from Metro, so a missing Metro shows an empty window after a slow build");
    }
    if (!run.includes("app-registry.ts unregister-others")) {
      issues.push("Makefile: `run` does not drop the other registered copies (node .omp/hooks/lib/app-registry.ts unregister-others) — the widget host and `open -b` pick a copy that is not the Debug build");
    }
    if (!/pluginkit -r [^\n]*Products\/Release\//.test(run)) {
      issues.push("Makefile: `run` does not unregister the Release widget — the widget host prefers a Release copy's higher version over the Debug build");
    }
  }
  const clean = recipeOf(makefile, "clean");
  if (clean !== null && !clean.includes("app-registry.ts unregister-others")) {
    issues.push("Makefile: `clean` deletes build copies without unregistering them (node .omp/hooks/lib/app-registry.ts unregister-others) — Launch Services keeps listing the deleted Roadie.app");
  }
  return issues;
}

/** Claim 9: a menu bar app's main window is an NSWindow it keeps, not a SwiftUI `Window`/`WindowGroup` scene. */
function checkMainWindow(project: Project): string[] {
  const app = project.targets.find((target) => target.productType === APPLICATION);
  if (app === undefined || app.infoPlist === null) return [];
  const plist = readProjectFile(app.infoPlist);
  if (plist === null || !plistTrue(plist, "LSUIElement")) return [];

  const issues: string[] = [];
  const sources = walk(`${MACOS_DIR}/${app.name}`)
    .filter((path) => path.endsWith(".swift"))
    // Comments are dropped first, so a comment that names `Window(` is not a scene.
    .map((path) => ({ path, code: (readProjectFile(path) ?? "").replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, "$1") }));
  for (const { path, code } of sources) {
    const scene = /(?<![\w.])(Window|WindowGroup)\s*[({]/.exec(code);
    if (scene !== null) {
      issues.push(
        `${path}: ${scene[1]} is a SwiftUI window scene, and SwiftUI drops its NSWindow once the user closes it — the menu bar item's "Open" then opens nothing. ` +
          "Own an NSWindow in AppDelegate (isReleasedWhenClosed = false) and leave `Settings { EmptyView() }` as the only scene",
      );
    }
  }
  const owners = sources.filter(({ code }) => /\bNSWindow\s*\(/.test(code));
  if (owners.length === 0) {
    issues.push(
      `${MACOS_DIR}/${app.name}: LSUIElement is set but no source creates an NSWindow — the menu bar item has no main window to open; ` +
        "own one in AppDelegate with isReleasedWhenClosed = false",
    );
  }
  for (const { path, code } of owners) {
    if (!/\bisReleasedWhenClosed\s*=\s*false\b/.test(code)) {
      issues.push(
        `${path}: creates an NSWindow without isReleasedWhenClosed = false — closing it releases the window, and reopening it from the menu crashes or opens nothing; set it right after creating the window`,
      );
    }
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
    console.log(passLine("check-app-macos-project", "Xcode project: sources, signing, App Group, names, residency and build location agree"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-app-macos-project");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
