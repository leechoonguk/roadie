/**
 * App Xcode Project Reader
 *
 * The parts of a pbxproj and an Info.plist the Xcode-project checks need —
 * shared by `check-app-macos-project` and `check-app-ios-project`, so the two
 * projects are read by one parser and a parser fix lands in both. Objects are
 * matched by id, so formatting (one line or many) does not matter; counts of
 * declared versus resolved entries are kept so a defeated parse can report
 * instead of passing.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { basename } from "node:path";

/** Object ids in a pbxproj are 24 hex digits. */
const ID = "[0-9A-F]{24}";

export const APPLICATION = "com.apple.product-type.application";
export const APP_EXTENSION = "com.apple.product-type.app-extension";

export interface BuildConfig {
  name: string;
  settings: Map<string, string>;
}

export interface Target {
  name: string;
  productType: string;
  /** Project-relative Info.plist of the target, from INFOPLIST_FILE. */
  infoPlist: string | null;
  configs: BuildConfig[];
  /** File names the target's Sources phase compiles. */
  sources: Set<string>;
  /** The same files by their reference's `path` — relative to its group, so a caller resolves it against the tree it expects. */
  sourcePaths: Set<string>;
  sourcesDeclared: number;
  sourcesRead: number;
}

export interface Project {
  targets: Target[];
}

/** Reads a pbxproj; `projectDir` (project-relative) prefixes each target's Info.plist path. */
export function parseProject(text: string, projectDir: string): Project {
  const fileNames = new Map<string, string>();
  const filePaths = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(`(${ID}) /\\*[^*]*\\*/ = \\{isa = PBXFileReference;[^}]*?path = "?([^;"]+)"?;`, "g"))) {
    fileNames.set(m[1], basename(m[2]));
    filePaths.set(m[1], m[2]);
  }
  const buildFiles = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(`(${ID}) /\\*[^*]*\\*/ = \\{isa = PBXBuildFile; fileRef = (${ID})`, "g"))) {
    buildFiles.set(m[1], m[2]);
  }
  const phases = new Map<string, string[]>();
  for (const m of text.matchAll(new RegExp(`(${ID}) /\\* Sources \\*/ = \\{\\s*isa = PBXSourcesBuildPhase;[\\s\\S]*?files = \\(([\\s\\S]*?)\\);`, "g"))) {
    phases.set(m[1], [...m[2].matchAll(new RegExp(ID, "g"))].map((id) => id[0]));
  }
  const configs = new Map<string, BuildConfig>();
  for (const m of text.matchAll(new RegExp(`(${ID}) /\\* (\\w+) \\*/ = \\{\\s*isa = XCBuildConfiguration;[\\s\\S]*?buildSettings = \\{([\\s\\S]*?)\\n\\t\\t\\t\\};`, "g"))) {
    const settings = new Map<string, string>();
    for (const s of m[3].matchAll(/^\s*"?([A-Z_][A-Z0-9_]*(?:\[[^\]]*\])?)"? = "?([^;"\n]*)"?;$/gm)) {
      settings.set(s[1], s[2].trim());
    }
    configs.set(m[1], { name: m[2], settings });
  }
  const configLists = new Map<string, string[]>();
  for (const m of text.matchAll(new RegExp(`/\\* Build configuration list for PBXNativeTarget "([^"]+)" \\*/ = \\{\\s*isa = XCConfigurationList;\\s*buildConfigurations = \\(([\\s\\S]*?)\\);`, "g"))) {
    configLists.set(m[1], [...m[2].matchAll(new RegExp(ID, "g"))].map((id) => id[0]));
  }

  const targets: Target[] = [];
  for (const m of text.matchAll(new RegExp(`(${ID}) /\\* [^*]+ \\*/ = \\{\\s*isa = PBXNativeTarget;([\\s\\S]*?)\\n\\t\\t\\};`, "g"))) {
    const body = m[2];
    const name = /\n\t\t\tname = "?([^;"]+)"?;/.exec(body)?.[1] ?? "";
    const productType = /productType = "([^"]+)";/.exec(body)?.[1] ?? "";
    const phaseIds = [...(/buildPhases = \(([\s\S]*?)\);/.exec(body)?.[1] ?? "").matchAll(new RegExp(ID, "g"))].map((id) => id[0]);
    const files = phaseIds.flatMap((id) => phases.get(id) ?? []);
    const sources = new Set<string>();
    const sourcePaths = new Set<string>();
    for (const file of files) {
      const ref = buildFiles.get(file) ?? "";
      const name = fileNames.get(ref);
      if (name !== undefined) sources.add(name);
      const path = filePaths.get(ref);
      if (path !== undefined) sourcePaths.add(path);
    }
    const targetConfigs = (configLists.get(name) ?? []).map((id) => configs.get(id)).filter((config): config is BuildConfig => config !== undefined);
    const plist = targetConfigs.map((config) => config.settings.get("INFOPLIST_FILE")).find(Boolean);
    targets.push({
      name,
      productType,
      infoPlist: plist === undefined ? null : `${projectDir}/${plist}`,
      configs: targetConfigs,
      sources,
      sourcePaths,
      sourcesDeclared: files.length,
      sourcesRead: [...files].filter((file) => fileNames.has(buildFiles.get(file) ?? "")).length,
    });
  }
  return { targets };
}

export function plistString(content: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(content)?.[1];
}

export function plistTrue(content: string, key: string): boolean {
  return new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(content);
}

export function plistArray(content: string, key: string): string[] {
  const body = new RegExp(`<key>${key.replace(/\./g, "\\.")}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(content)?.[1] ?? "";
  return [...body.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}
