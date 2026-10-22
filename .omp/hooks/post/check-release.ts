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
 *   6. CI only adds — each workflow that attaches installers to a release
 *      (`.github/workflows/desktop.yml`, `native.yml`) runs on a published
 *      release, uploads only behind `github.event_name == 'release'`, builds
 *      branch pushes only (the version tag `make release` pushes would build
 *      twice), and never uploads a file named like one of the release's own
 *      assets — a clobbered `appcast.xml` or `Roadie-<v>-macos.dmg` ships a broken
 *      update to every installed Mac.
 *   7. Every platform's feed — Windows and Linux update from the GitHub
 *      release named by `publish` in `app/desktop/package.json`, and only when
 *      `desktop.yml` uploads the `latest.yml` / `latest-linux.yml` electron-updater
 *      reads; Android reads `RELEASE_REPO` in `app/src/updates.ts`. Each names
 *      the repository `app-release.ts` publishes to, or that platform's copies
 *      look somewhere no release ever arrives.
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
import { FEED_URL, RELEASE_REPO, releaseAssets } from "../lib/app-release.ts";
import { plistArray, plistString, plistTrue } from "../lib/app-xcode-project.ts";

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
/** The workflows `release.md` names as attaching installers. */
const WORKFLOWS = ["desktop.yml", "native.yml"];
const WORKFLOW_DIR = ".github/workflows";
const DESKTOP_PACKAGE = "app/desktop/package.json";
const SHARED_UPDATES = "app/src/updates.ts";
/** The feeds electron-updater reads, per platform; `desktop.yml` must upload both. */
const DESKTOP_FEEDS = ["latest.yml", "latest-linux.yml"];
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
    if (!touchesPath(event, ["app/macos/", ".omp/hooks/lib/app-release.ts", ".github/workflows/"])) return;

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

  issues.push(...checkWorkflows());
  issues.push(...checkPlatformFeeds());
  return issues;
}

/** Claim 7: the Windows, Linux and Android update paths name the repository releases go to. */
function checkPlatformFeeds(): string[] {
  const issues: string[] = [];
  if (existsSync(join(projectRoot, DESKTOP_PACKAGE))) {
    const publish = desktopPublish(JSON.parse(read(DESKTOP_PACKAGE)));
    if (publish === null || publish.provider !== "github" || `${publish.owner}/${publish.repo}` !== RELEASE_REPO) {
      const named = publish === null ? "unset" : `${publish.provider} ${publish.owner}/${publish.repo}`;
      issues.push(
        `${DESKTOP_PACKAGE}: build.publish is ${named}, not github ${RELEASE_REPO} — ` +
          "the packaged app's app-update.yml would point Windows and Linux copies away from the releases",
      );
    }
    const workflow = `${WORKFLOW_DIR}/desktop.yml`;
    if (existsSync(join(projectRoot, workflow))) {
      const assets = [...read(workflow).matchAll(/^\s+assets:\s*(.+)$/gm)].flatMap((m) => m[1].split(/\s+/));
      for (const feed of DESKTOP_FEEDS.filter((name) => !assets.some((token) => token.split("/").pop() === name))) {
        issues.push(`${workflow}: uploads no ${feed} — installed copies on that OS exist but never see a release`);
      }
    }
  }
  if (existsSync(join(projectRoot, SHARED_UPDATES))) {
    const repo = /export const RELEASE_REPO = '([^']+)'/.exec(read(SHARED_UPDATES))?.[1];
    if (repo !== RELEASE_REPO) {
      issues.push(
        `${SHARED_UPDATES}: RELEASE_REPO is ${repo === undefined ? "unreadable" : `'${repo}'`}, not ${RELEASE_REPO} — ` +
          "Android would check a repository releases are never published to",
      );
    }
  }
  return issues;
}

/** `build.publish` of the desktop package.json, when it is one provider object. */
function desktopPublish(manifest: unknown): { provider: unknown; owner: unknown; repo: unknown } | null {
  if (typeof manifest !== "object" || manifest === null || !("build" in manifest)) return null;
  const build = manifest.build;
  if (typeof build !== "object" || build === null || !("publish" in build)) return null;
  const publish = build.publish;
  if (typeof publish !== "object" || publish === null) return null;
  return {
    provider: "provider" in publish ? publish.provider : undefined,
    owner: "owner" in publish ? publish.owner : undefined,
    repo: "repo" in publish ? publish.repo : undefined,
  };
}

/** Claim 6: the installer workflows run on a published release and add only their own files. */
function checkWorkflows(): string[] {
  const issues: string[] = [];
  for (const name of WORKFLOWS) {
    const path = `${WORKFLOW_DIR}/${name}`;
    if (!existsSync(join(projectRoot, path))) {
      issues.push(`${path}: missing — release.md promises it attaches installers to every release`);
      continue;
    }
    const text = read(path);
    if (!/\n {2}release:\s*\n {4}types:\s*\[\s*published\s*\]/.test(text)) {
      issues.push(`${path}: does not run on release: types: [published] — make release publishes and nothing attaches the installers`);
    }
    if (/\n {2}push:/.test(text) && !/\n {2}push:\s*\n(?: {4}#.*\n)* {4}branches:/.test(text)) {
      issues.push(`${path}: its push trigger is not limited to branches — the version tag make release pushes builds a second time`);
    }
    const steps = text.split(/\n(?= +- (?:name|uses):)/);
    const uploads = steps.filter((step) => /gh release upload\b/.test(step));
    if (uploads.length === 0) {
      issues.push(`${path}: runs no gh release upload — the release would carry no installer from this workflow`);
    }
    // Uploaded names come from the command and from the matrix's `assets:` entries it expands.
    const uploaded = [
      ...uploads.flatMap((step) => [.../gh release upload\s+\S+\s+(.*?)\s+--/.exec(step)?.[1].split(/\s+/) ?? []]),
      ...[...text.matchAll(/^\s+assets:\s*(.+)$/gm)].flatMap((m) => m[1].split(/\s+/)),
    ].filter((token) => !token.startsWith("${{"));
    for (const step of uploads) {
      if (!/if:\s*github\.event_name\s*==\s*'release'/.test(step)) {
        issues.push(`${path}: a gh release upload step is not guarded by if: github.event_name == 'release' — a branch build would try to upload`);
      }
    }
    for (const token of uploaded) {
      const file = token.split("/").pop() ?? token;
      const pattern = new RegExp(`^${file.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      for (const asset of releaseAssets("0.0.0").filter((own: string) => pattern.test(own))) {
        issues.push(`${path}: uploads ${token}, which matches the release's own ${asset} — --clobber would replace what every installed Mac updates from`);
      }
    }
  }
  return issues;
}

function read(path: string): string {
  return readFileSync(join(projectRoot, path), "utf-8");
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
