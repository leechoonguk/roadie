/**
 * Check-Release Post Hook
 *
 * Holds the update path to what `make release` publishes (release.md). An
 * installed Roadie updates itself only when every link below holds, and a broken
 * link is silent: the app checks, finds nothing or refuses what it finds, and the
 * user stays on the old version forever.
 *
 *   1. One feed — the app's `SUFeedURL` is the `releases/latest/download` URL of
 *      the feed asset `app-release.ts` publishes, in the repository it publishes to.
 *   2. A usable key — `SUPublicEDKey` is an EdDSA public key (32 bytes, base64).
 *      Sparkle refuses every update whose archive signature it cannot check.
 *   3. A sandboxed installer — a sandboxed app sets
 *      `SUEnableInstallerLauncherService` and holds the `-spks`/`-spki`
 *      mach-lookup exceptions; without them Sparkle downloads the update and
 *      cannot install it.
 *   4. The tag is the version — both Info.plists read `$(MARKETING_VERSION)` and
 *      `$(CURRENT_PROJECT_VERSION)`, the build settings `make dist` sets from the
 *      tag. A literal version ships every release as the same build, and Sparkle
 *      compares `CFBundleVersion` to decide whether an update is newer.
 *   5. Sparkle linked — the Podfile declares the `Sparkle` pod the app imports.
 *
 * Reads files only (no keychain, no network). Dormant (cause `absent`) while the
 * app has no Info.plist.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { dormant, passLine } from "../lib/hook-dormancy.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";
import { FEED_URL } from "../lib/app-release.ts";

declare const process: { argv: string[]; exit(code?: number): never };

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

const APP_PLIST = "app/macos/MarshallBluetooth-macOS/Info.plist";
const WIDGET_PLIST = "app/macos/MarshallWidget/Info.plist";
const APP_ENTITLEMENTS = "app/macos/MarshallBluetooth-macOS/MarshallBluetooth.entitlements";
const PODFILE = "app/macos/Podfile";
const MACH_LOOKUP = "com.apple.security.temporary-exception.mach-lookup.global-name";
const INSTALLER_SERVICES = ["$(PRODUCT_BUNDLE_IDENTIFIER)-spks", "$(PRODUCT_BUNDLE_IDENTIFIER)-spki"];
const VERSION_KEYS: Array<[string, string]> = [
  ["CFBundleShortVersionString", "$(MARKETING_VERSION)"],
  ["CFBundleVersion", "$(CURRENT_PROJECT_VERSION)"],
];

// ============================================================
// Functions
// ============================================================

export default function checkRelease(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-release", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["app/macos/", ".omp/hooks/lib/app-release.ts"])) return;

    const issues = checkReleaseSync();
    if (issues.length === 0) {
      resetSuppression("check-release");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-release",
      issues,
      "keep the feed URL, the Sparkle key, the installer entitlements and the versions in step with app-release.ts",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-release") };
  }));
}

export function checkReleaseSync(): string[] {
  if (!existsSync(join(projectRoot, APP_PLIST))) {
    return dormant("check-release", "absent", "no app Info.plist under app/macos/");
  }
  const plist = read(APP_PLIST);
  const issues: string[] = [];

  const feed = plistString(plist, "SUFeedURL");
  if (feed !== FEED_URL) {
    issues.push(
      `${APP_PLIST}: SUFeedURL is ${feed === undefined ? "missing" : `'${feed}'`}, not ${FEED_URL} — ` +
        "installed copies would never see what make release publishes (RELEASE_REPO/FEED_ASSET in lib/app-release.ts)",
    );
  }

  const key = plistString(plist, "SUPublicEDKey");
  if (key === undefined || !/^[A-Za-z0-9+/]{43}=$/.test(key)) {
    issues.push(
      `${APP_PLIST}: SUPublicEDKey is ${key === undefined ? "missing" : `'${key}'`}, not a 32-byte EdDSA key — ` +
        "print it with app/macos/Pods/Sparkle/bin/generate_keys --account roadie -p",
    );
  }

  if (existsSync(join(projectRoot, APP_ENTITLEMENTS))) {
    const entitlements = read(APP_ENTITLEMENTS);
    if (plistTrue(entitlements, "com.apple.security.app-sandbox")) {
      if (!plistTrue(plist, "SUEnableInstallerLauncherService")) {
        issues.push(
          `${APP_PLIST}: the app is sandboxed (${APP_ENTITLEMENTS}) but SUEnableInstallerLauncherService is not true — ` +
            "Sparkle downloads the update and cannot install it",
        );
      }
      const services = plistArray(entitlements, MACH_LOOKUP);
      for (const service of INSTALLER_SERVICES.filter((name) => !services.includes(name))) {
        issues.push(
          `${APP_ENTITLEMENTS}: ${MACH_LOOKUP} lacks ${service} — the sandbox blocks Sparkle's installer service`,
        );
      }
    }
  }

  for (const path of [APP_PLIST, WIDGET_PLIST]) {
    if (!existsSync(join(projectRoot, path))) continue;
    const content = read(path);
    for (const [plistKey, setting] of VERSION_KEYS) {
      const value = plistString(content, plistKey);
      if (value === setting) continue;
      issues.push(
        `${path}: ${plistKey} is '${value ?? "missing"}', not ${setting} — the tag sets the version through that ` +
          "build setting (make dist), and Sparkle compares CFBundleVersion to find a newer release",
      );
    }
  }

  if (!existsSync(join(projectRoot, PODFILE)) || !/^\s*pod\s+['"]Sparkle['"]/m.test(read(PODFILE))) {
    issues.push(`${PODFILE}: declares no 'Sparkle' pod, yet ${APP_PLIST} configures Sparkle — the app would not link`);
  }

  return issues;
}

function read(path: string): string {
  return readFileSync(join(projectRoot, path), "utf-8");
}

function plistString(content: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(content)?.[1];
}

function plistTrue(content: string, key: string): boolean {
  return new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(content);
}

function plistArray(content: string, key: string): string[] {
  const body = new RegExp(`<key>${key.replace(/\./g, "\\.")}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(content)?.[1] ?? "";
  return [...body.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}

// Direct execution (make check-release): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-release.ts")) {
  const issues = checkReleaseSync();
  console.log("==> check-release");
  if (issues.length === 0) {
    console.log(passLine("check-release", "update feed, Sparkle key, installer entitlements and versions agree"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-release");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
