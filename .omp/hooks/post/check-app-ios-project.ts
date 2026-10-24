/**
 * Check-App-iOS-Project Post Hook
 *
 * Holds the iOS Xcode project to what the iOS app is (app-ios-project.md): the
 * macOS Swift compiled a second time, plus a widget whose presses run in the
 * app's process. Every claim below builds cleanly when broken and fails only
 * on a phone, where no other gate looks:
 *
 *   1. Shared sources compiled — the app target compiles its own tree, every
 *      `Shared/` file, the React Native adapters and bridge files, the core
 *      (less the AppKit-only files), and every widget file that declares an
 *      intent; the widget target compiles `Shared/`, `MarshallWidget/` and the
 *      core a press needs. A shared file added on macOS and missed here links
 *      iOS without it. Every compiled reference resolves to a file.
 *   2. No React in the widget — the extension links no React Native, so a
 *      source that imports React fails only when the widget is built.
 *   3. One App Group — both Info.plists and both entitlements name the same
 *      `group.` identifier; iOS refuses a team-prefixed macOS-style group.
 *   4. Presses run in the app — every widget intent is a `LiveActivityIntent`
 *      on iOS (performed in the app's process, which holds Bluetooth), and the
 *      deployment target is iOS 17 or later everywhere (interactive widgets).
 *   5. Bluetooth from the background — the app declares
 *      `NSBluetoothAlwaysUsageDescription` and the `bluetooth-central`
 *      background mode a press launched in the background connects with.
 *   6. Embedded and signed — the app embeds the widget (`.appex` in a
 *      PlugIns copy phase) and every signed configuration names the macOS
 *      project's team, so one team signs every Apple build.
 *
 * Reads files only. Dormant (cause `absent`) while the iOS project does not exist.
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
import { touchesPath } from "../lib/hook-scope.ts";
import { dormant, passLine } from "../lib/hook-dormancy.ts";
import { projectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";
import {
  APP_EXTENSION,
  APPLICATION,
  parseProject,
  plistArray,
  plistString,
  type Project,
  type Target,
} from "../lib/app-xcode-project.ts";

// ============================================================
// Constants
// ============================================================

const IOS_DIR = "app/ios";
const MACOS_DIR = "app/macos";
const PROJECT_FILE = "app/ios/MarshallBluetooth.xcodeproj/project.pbxproj";
const MACOS_PROJECT_FILE = "app/macos/MarshallBluetooth.xcodeproj/project.pbxproj";

/** The app's own tree, relative to `IOS_DIR` — the React Native template's sources. */
const APP_TREE = "MarshallBluetooth";
/** macOS trees the iOS targets compile, relative to `MACOS_DIR` (the project's "Shared with macOS" group). */
const SHARED_TREE = "Shared";
const ADAPTER_TREE = "MarshallBluetooth-macOS/Native";
const CORE_TREE = "MarshallBluetooth-macOS/Native/Core";
const WIDGET_TREE = "MarshallWidget";
/**
 * The core a widget press needs: `OneShotSession` and what it drives. Listed,
 * not derived — the press's closure is a design decision, and a new core file
 * joining it should be a deliberate edit here.
 */
const PRESS_CORE = ["MarshallScanner.swift", "MarshallProtocol.swift", "OneShotSession.swift"];

const SOURCE_EXTENSIONS = [".swift", ".m"];
const MINIMUM_IOS = 17;

// ============================================================
// Functions
// ============================================================

export default function checkAppIosProject(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-app-ios-project", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["app/ios/", "app/macos/Shared/", "app/macos/MarshallBluetooth-macOS/", "app/macos/MarshallWidget/"])) return;

    const issues = checkAppIosProjectSync();
    if (issues.length === 0) {
      resetSuppression("check-app-ios-project");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-app-ios-project",
      issues,
      "compile the shared sources into both iOS targets, keep one App Group, run presses in the app",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-app-ios-project") };
  }));
}

export function checkAppIosProjectSync(): string[] {
  if (!existsSync(join(projectRoot, PROJECT_FILE))) {
    return dormant("check-app-ios-project", "absent", "no Xcode project under app/ios/");
  }
  const text = readFileSync(join(projectRoot, PROJECT_FILE), "utf-8");
  const project = parseProject(text, IOS_DIR);
  const app = project.targets.find((target) => target.productType === APPLICATION);
  const widget = project.targets.find((target) => target.productType === APP_EXTENSION);
  if (app === undefined || widget === undefined) {
    return [
      `${PROJECT_FILE}: read ${project.targets.length} target(s) but not both an app and an app extension — ` +
        "the iOS app and its widget are both required, and every claim below needs them",
    ];
  }

  const issues: string[] = [];
  issues.push(...checkMembership(app, widget));
  issues.push(...checkGroups(project));
  issues.push(...checkPresses(project));
  issues.push(...checkBluetooth(app));
  issues.push(...checkEmbedAndTeam(text, project));
  return issues;
}

/** Claims 1 and 2: each target compiles what it must, everything it compiles exists, the widget has no React. */
function checkMembership(app: Target, widget: Target): string[] {
  const shared = sources(MACOS_DIR, SHARED_TREE);
  const intents = sources(MACOS_DIR, WIDGET_TREE).filter((path) => /:\s*AppIntent\b/.test(read(`${MACOS_DIR}/${path}`) ?? ""));
  const appExpected = [
    ...sources(IOS_DIR, APP_TREE),
    ...shared,
    ...sources(MACOS_DIR, ADAPTER_TREE, false),
    ...sources(MACOS_DIR, CORE_TREE).filter((path) => !/^\s*import\s+AppKit\b/m.test(read(`${MACOS_DIR}/${path}`) ?? "")),
    ...intents,
  ];
  const widgetExpected = [
    ...shared,
    ...sources(MACOS_DIR, WIDGET_TREE),
    ...PRESS_CORE.map((name) => `${CORE_TREE}/${name}`),
  ];
  if (intents.length === 0) {
    return [`${MACOS_DIR}/${WIDGET_TREE}/: declares no AppIntent — the widget's presses have no intent to run, or the declaration moved out of sight of this check`];
  }

  const issues: string[] = [];
  for (const [target, expected] of [[app, appExpected], [widget, widgetExpected]] as const) {
    if (target.sourcesRead !== target.sourcesDeclared) {
      issues.push(`${PROJECT_FILE}: target ${target.name} lists ${target.sourcesDeclared} sources but ${target.sourcesRead} resolved to a file reference — the membership check is blind to the rest`);
    }
    for (const path of expected) {
      if (!target.sourcePaths.has(path)) {
        issues.push(`${resolve(path)}: is not compiled into iOS target ${target.name} — add a reference under "Shared with macOS" (or the target's own group) and a PBXBuildFile in its Sources phase in ${PROJECT_FILE}`);
      }
    }
    for (const path of target.sourcePaths) {
      if (!existsSync(join(projectRoot, resolve(path)))) {
        issues.push(`${PROJECT_FILE}: target ${target.name} compiles ${path}, which exists under neither ${IOS_DIR}/ nor ${MACOS_DIR}/ — remove the stale reference`);
      }
    }
  }
  for (const path of widget.sourcePaths) {
    if (/^\s*import\s+React\b/m.test(read(resolve(path)) ?? "")) {
      issues.push(`${resolve(path)}: imports React but is compiled into the widget extension ${widget.name}, which links no React Native — the widget fails to link`);
    }
  }
  return issues;
}

/** Claim 3: one `group.` App Group across both Info.plists and both entitlements files. */
function checkGroups(project: Project): string[] {
  const issues: string[] = [];
  const groups = new Map<string, string>();
  for (const target of project.targets) {
    const plist = target.infoPlist === null ? null : read(target.infoPlist);
    if (plist === null) {
      issues.push(`${PROJECT_FILE}: target ${target.name} names no readable INFOPLIST_FILE (${target.infoPlist ?? "none"})`);
    } else {
      groups.set(target.infoPlist!, plistString(plist, "AppGroupIdentifier") ?? "");
    }
    const entitlements = target.configs.map((config) => config.settings.get("CODE_SIGN_ENTITLEMENTS")).find(Boolean);
    const content = entitlements === undefined ? null : read(`${IOS_DIR}/${entitlements}`);
    if (content === null) {
      issues.push(`${PROJECT_FILE}: target ${target.name} has no readable CODE_SIGN_ENTITLEMENTS (${entitlements ?? "none"}) — without the App Group entitlement the shared container is nil`);
      continue;
    }
    groups.set(`${IOS_DIR}/${entitlements}`, plistArray(content, "com.apple.security.application-groups")[0] ?? "");
  }
  if (new Set(groups.values()).size > 1) {
    issues.push(
      `${IOS_DIR}/: App Group differs between ${[...groups].map(([path, group]) => `${path}=${group || "(none)"}`).join(", ")} — ` +
        "the app and the widget share a container only when every Info.plist and entitlements file names the same group",
    );
  }
  for (const [path, group] of groups) {
    if (!group.startsWith("group.")) {
      issues.push(`${path}: App Group ${group || "(none)"} does not start with group. — iOS accepts only group. identifiers, so SharedStore finds no container`);
    }
  }
  return issues;
}

/** Claim 4: presses are Live Activity intents on iOS, and every target targets iOS 17+. */
function checkPresses(project: Project): string[] {
  const issues: string[] = [];
  for (const path of sources(MACOS_DIR, WIDGET_TREE)) {
    const code = read(`${MACOS_DIR}/${path}`) ?? "";
    for (const m of code.matchAll(/struct\s+(\w+)\s*:\s*AppIntent\b/g)) {
      if (!new RegExp(`#if\\s+os\\(iOS\\)[\\s\\S]*?extension\\s+${m[1]}\\s*:\\s*LiveActivityIntent\\b`).test(code)) {
        issues.push(
          `${MACOS_DIR}/${path}: ${m[1]} is not a LiveActivityIntent under #if os(iOS) — iOS then performs it in the widget ` +
            "extension, which has no Bluetooth, and the press never reaches the speaker",
        );
      }
    }
  }
  for (const target of project.targets) {
    for (const config of target.configs) {
      const version = Number.parseFloat(config.settings.get("IPHONEOS_DEPLOYMENT_TARGET") ?? "0");
      if (!(version >= MINIMUM_IOS)) {
        issues.push(`${PROJECT_FILE}: target ${target.name} (${config.name}) deploys to iOS ${version || "(unset)"} — interactive widget buttons and LiveActivityIntent need iOS ${MINIMUM_IOS}`);
      }
    }
  }
  return issues;
}

/** Claim 5: Bluetooth is declared, and allowed from the background a press launches into. */
function checkBluetooth(app: Target): string[] {
  const plist = app.infoPlist === null ? null : read(app.infoPlist);
  if (plist === null) return [];
  const issues: string[] = [];
  if (!plistString(plist, "NSBluetoothAlwaysUsageDescription")) {
    issues.push(`${app.infoPlist}: declares no NSBluetoothAlwaysUsageDescription — iOS kills the app at its first Bluetooth call`);
  }
  if (!plistArray(plist, "UIBackgroundModes").includes("bluetooth-central")) {
    issues.push(`${app.infoPlist}: UIBackgroundModes lacks bluetooth-central — a press that launches the app in the background cannot connect`);
  }
  return issues;
}

/** Claim 6: the app embeds the widget, and one team — the macOS one — signs everything. */
function checkEmbedAndTeam(text: string, project: Project): string[] {
  const issues: string[] = [];
  const embeds = [...text.matchAll(/\/\* [^*]+ \*\/ = \{\s*isa = PBXCopyFilesBuildPhase;[\s\S]*?dstSubfolderSpec = 13;[\s\S]*?files = \(([\s\S]*?)\);/g)];
  if (!embeds.some((m) => /\.appex in /.test(m[1]))) {
    issues.push(`${PROJECT_FILE}: no PlugIns copy phase (dstSubfolderSpec = 13) embeds an .appex — the app ships without its widget`);
  }
  const macos = read(MACOS_PROJECT_FILE);
  if (macos === null) {
    issues.push(`${MACOS_PROJECT_FILE}: unreadable — the team every Apple build signs with is read from it`);
    return issues;
  }
  const teams = new Set([...macos.matchAll(/DEVELOPMENT_TEAM = "?(\w+)"?;/g)].map((m) => m[1]));
  if (teams.size !== 1) {
    issues.push(`${MACOS_PROJECT_FILE}: names ${teams.size} DEVELOPMENT_TEAM values — expected exactly one to hold the iOS project to`);
    return issues;
  }
  const [team] = teams;
  for (const target of project.targets) {
    for (const config of target.configs) {
      if (config.settings.get("DEVELOPMENT_TEAM") !== team) {
        issues.push(`${PROJECT_FILE}: target ${target.name} (${config.name}) signs with team ${config.settings.get("DEVELOPMENT_TEAM") ?? "(none)"}, not the macOS project's ${team}`);
      }
    }
  }
  return issues;
}

// ============================================================
// Helpers
// ============================================================

/** Source files under `root/tree`, as paths relative to `root` — the form the project's references use. */
function sources(root: string, tree: string, recursive = true): string[] {
  const found: string[] = [];
  const visit = (relative: string) => {
    const abs = join(projectRoot, root, relative);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs)) {
      if (WALK_EXCLUDES.has(entry)) continue;
      const child = `${relative}/${entry}`;
      if (statSync(join(abs, entry)).isDirectory()) {
        if (recursive) visit(child);
      } else if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        found.push(child);
      }
    }
  };
  visit(tree);
  return found;
}

/** A reference path, project-relative: the iOS tree when the file is there, else the macOS tree it is shared from. */
function resolve(path: string): string {
  return existsSync(join(projectRoot, IOS_DIR, path)) ? `${IOS_DIR}/${path}` : `${MACOS_DIR}/${path}`;
}

/** A project file's text, or null when it does not exist; each caller reports the absence itself. */
function read(path: string): string | null {
  const abs = join(projectRoot, path);
  return existsSync(abs) ? readFileSync(abs, "utf-8") : null;
}

// Direct execution (make check-app-ios-project): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-app-ios-project.ts")) {
  const issues = checkAppIosProjectSync();
  console.log("==> check-app-ios-project");
  if (issues.length === 0) {
    console.log(passLine("check-app-ios-project", "iOS project: shared sources, App Group, presses in the app, Bluetooth, embed and team agree"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-app-ios-project");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
