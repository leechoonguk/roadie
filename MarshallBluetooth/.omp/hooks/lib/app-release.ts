/**
 * Roadie releases (rule://release): build, sign, publish and roll back.
 *
 * The version is the annotated git tag `vMAJOR.MINOR.PATCH`; nothing in the tree
 * stores it. A release is built on this Mac, because both keys it needs live in
 * this Mac's login keychain: the Apple Development identity that signs the app
 * and the Sparkle EdDSA key that signs the update. Installed copies of Roadie read
 * `releases/latest/download/appcast.xml` (the app's `SUFeedURL`), so publishing a
 * GitHub release is what updates them — and an archive signed with a key the app
 * does not carry is a release no installed copy will ever accept.
 *
 *   node app-release.ts dist <x.y.z>               build + package + sign into app/macos/build/dist
 *   node app-release.ts release <patch|minor|major> [--dry-run]
 *   node app-release.ts unrelease <vX.Y.Z>
 *   node app-release.ts install                    the published release → /Applications, the only registered copy
 *
 * Run through `make dist`, `make release`, `make unrelease` and `make app-install`;
 * `check-release` imports the names below so the feed, the assets and the
 * Info.plist stay in step.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { createHash } from "node:crypto";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
// @ts-expect-error — Node builtin, not project-compiled
import { tmpdir } from "node:os";
import { resolveProjectRoot } from "./hook-project-root.ts";

declare const process: { argv: string[]; exit(code?: number): never; env: Record<string, string | undefined> };

// ============================================================
// Constants
// ============================================================

/** The GitHub repository releases are published to. */
export const RELEASE_REPO = "leechoonguk/roadie";
/** The app archive and the feed; no version in either name, so `latest/download/<name>` always resolves. */
export const ARCHIVE_ASSET = "Roadie.zip";
export const FEED_ASSET = "appcast.xml";
export const CHECKSUMS_ASSET = "checksums.txt";
/** Every file a release carries; `make release` refuses a published release missing one. */
export const RELEASE_ASSETS = [ARCHIVE_ASSET, FEED_ASSET, CHECKSUMS_ASSET];
/** What every installed copy reads: the app's `SUFeedURL` must equal it. */
export const FEED_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/${FEED_ASSET}`;
/** The keychain account `generate_keys` stored Roadie's EdDSA key under. */
export const SPARKLE_ACCOUNT = "roadie";
/** Sparkle's command-line tools, shipped inside its pod. */
export const SPARKLE_BIN = "app/macos/Pods/Sparkle/bin";

const WORKSPACE = "app/macos/MarshallBluetooth.xcworkspace";
const SCHEME = "MarshallBluetooth-macOS";
const APP_PLIST = "app/macos/MarshallBluetooth-macOS/Info.plist";
const DERIVED_DATA = "app/macos/build/DerivedData";
const DIST_DIR = "app/macos/build/dist";
const BUILT_APP = `${DERIVED_DATA}/Build/Products/Release/Roadie.app`;
const MINIMUM_SYSTEM = "14.0";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** Commit subjects left out of release notes: they change nothing a user sees. */
const NOTE_EXCLUDE = /^(docs|test|chore\(harness\))(\(|:)/;
/** Where the one copy of Roadie lives; Sparkle replaces this bundle in place. */
const INSTALLED_APP = "/Applications/Roadie.app";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

const root = resolveProjectRoot();

// ============================================================
// Commands
// ============================================================

/** Builds `version` in Release, checks the bundle, and writes the three assets into the dist directory. */
export function dist(version: string | undefined): void {
  if (version === undefined || !VERSION.test(version)) fail("usage: make dist v=x.y.z (no leading v)");
  const publicKey = keychainPublicKey();
  const plistKey = plistValue(APP_PLIST, "SUPublicEDKey");
  if (publicKey !== plistKey) {
    fail(
      `the Sparkle key in the keychain (account '${SPARKLE_ACCOUNT}': ${publicKey}) is not the SUPublicEDKey in ` +
        `${APP_PLIST} (${plistKey}) — installed copies would reject this update; restore the key with ` +
        `${SPARKLE_BIN}/generate_keys --account ${SPARKLE_ACCOUNT} -f <exported key>`,
    );
  }

  say(`building Roadie ${version} (Release)`);
  run("xcodebuild", [
    "-quiet", "-workspace", WORKSPACE, "-scheme", SCHEME, "-configuration", "Release",
    "-derivedDataPath", DERIVED_DATA, `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${version}`, "build",
  ]);
  checkBundle(version);

  rmSync(join(root, DIST_DIR), { recursive: true, force: true });
  mkdirSync(join(root, DIST_DIR), { recursive: true });
  const archive = `${DIST_DIR}/${ARCHIVE_ASSET}`;
  // ditto keeps the bundle's symlinks and extended attributes, which a signed framework needs.
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", BUILT_APP, archive]);

  const signature = output(`${SPARKLE_BIN}/sign_update`, ["--account", SPARKLE_ACCOUNT, "-p", archive]).trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail(`sign_update printed no EdDSA signature: '${signature}'`);
  run(`${SPARKLE_BIN}/sign_update`, ["--account", SPARKLE_ACCOUNT, "--verify", archive, signature]);
  const length = statSync(join(root, archive)).size;
  const url = `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${ARCHIVE_ASSET}`;
  writeFileSync(join(root, DIST_DIR, FEED_ASSET), appcast(version, url, length, signature));

  const sums = [ARCHIVE_ASSET, FEED_ASSET].map((name) => `${sha256(`${DIST_DIR}/${name}`)}  ${name}`);
  writeFileSync(join(root, DIST_DIR, CHECKSUMS_ASSET), `${sums.join("\n")}\n`);
  say(`dist ready: ${RELEASE_ASSETS.map((name) => `${DIST_DIR}/${name}`).join(", ")}`);
}

/** Tags the next version, builds it, publishes the release, and reads it back the way installed copies do. */
export function release(bump: string | undefined, dryRun: boolean): void {
  if (bump !== "patch" && bump !== "minor" && bump !== "major") fail("usage: make release bump=patch|minor|major");
  if (spawnSync("gh", ["auth", "status"], { cwd: root, stdio: "ignore" }).status !== 0) {
    fail("gh (GitHub CLI) is missing or not logged in (gh auth login)");
  }

  // 1. The commit may be released.
  const branch = output("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== "main") fail(`on branch '${branch}'; releases are cut from main`);
  if (output("git", ["status", "--porcelain", "--", "."]).trim() !== "") {
    fail("this project's worktree has changes; commit them first (make commit) — a release is a commit");
  }
  run("git", ["fetch", "-q", "origin", "main", "--tags"]);
  const head = output("git", ["rev-parse", "HEAD"]).trim();
  if (head !== output("git", ["rev-parse", "origin/main"]).trim()) fail("HEAD is not origin/main; push first (make push)");

  // 2. The next version.
  const last = output("git", ["tag", "-l", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"]).split("\n")[0]?.trim() || "v0.0.0";
  const [major, minor, patch] = last.slice(1).split(".").map(Number);
  const next =
    bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  const tag = `v${next}`;
  if (spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: root, stdio: "ignore" }).status === 0) {
    fail(`tag ${tag} already exists`);
  }
  if (last !== "v0.0.0" && output("git", ["rev-list", "-n", "1", last]).trim() === head) {
    fail(`this commit is already released as ${last}`);
  }
  const notes = releaseNotes(last === "v0.0.0" ? null : last);
  say(`${last} -> ${tag} (${bump})`);
  console.log(notes);
  if (dryRun) {
    say("dry run: nothing built, tagged or published");
    return;
  }

  // 3. Build and sign before anything is public: a failed build leaves no tag behind.
  dist(next);

  // 4. Tag and publish.
  run("git", ["tag", "-a", tag, "-m", `Roadie ${tag}`]);
  run("git", ["push", "-q", "origin", tag]);
  run("gh", [
    "release", "create", tag, "-R", RELEASE_REPO, "--verify-tag", "--title", `Roadie ${tag}`, "--notes", notes,
    ...RELEASE_ASSETS.map((name) => `${DIST_DIR}/${name}`),
  ]);

  // 5. Read it back: every asset is attached, and the feed installed copies read names this version.
  const attached = new Set(
    output("gh", ["release", "view", tag, "-R", RELEASE_REPO, "--json", "assets", "--jq", ".assets[].name"]).split("\n"),
  );
  const missing = RELEASE_ASSETS.filter((name) => !attached.has(name));
  if (missing.length > 0) fail(`release ${tag} is missing ${missing.join(", ")} — make unrelease v=${tag}, then release again`);
  const feed = output("curl", ["-fsSL", FEED_URL]);
  if (!feed.includes(`<sparkle:version>${next}</sparkle:version>`)) {
    fail(`${FEED_URL} does not serve ${next} yet — installed copies still see the previous release`);
  }
  say(`released ${tag}: https://github.com/${RELEASE_REPO}/releases/tag/${tag}`);
}

/** Deletes a release and its tag, locally and on GitHub; `latest` falls back to the previous release. */
export function unrelease(tag: string | undefined): void {
  if (tag === undefined || !/^v\d+\.\d+\.\d+$/.test(tag)) fail("usage: make unrelease v=vX.Y.Z");
  run("gh", ["release", "delete", tag, "-R", RELEASE_REPO, "--yes", "--cleanup-tag"]);
  spawnSync("git", ["tag", "-d", tag], { cwd: root, stdio: "ignore" });
  say(`unreleased ${tag}`);
}

/**
 * Installs the published release the way a user gets it, and makes it the only
 * Roadie macOS knows: build copies are unregistered from LaunchServices and the
 * widget host, so the widget, Spotlight and `open -b` all reach `/Applications`.
 * Development builds stay on disk; `make relaunch` registers one again.
 */
export function install(): void {
  const work = mkdtempSync(join(tmpdir(), "roadie-install-"));
  try {
    const base = `https://github.com/${RELEASE_REPO}/releases/latest/download`;
    run("curl", ["-fsSL", "-o", join(work, ARCHIVE_ASSET), `${base}/${ARCHIVE_ASSET}`]);
    const sums = output("curl", ["-fsSL", `${base}/${CHECKSUMS_ASSET}`]);
    const expected = sums.split("\n").find((line) => line.trim().endsWith(`  ${ARCHIVE_ASSET}`))?.split(" ")[0];
    const actual = createHash("sha256").update(readFileSync(join(work, ARCHIVE_ASSET))).digest("hex");
    if (expected !== actual) fail(`${ARCHIVE_ASSET}: sha256 ${actual} does not match ${CHECKSUMS_ASSET} (${expected ?? "no entry"})`);
    run("ditto", ["-x", "-k", join(work, ARCHIVE_ASSET), work]);
    run("codesign", ["--verify", "--deep", "--strict", join(work, "Roadie.app")]);

    spawnSync("pkill", ["-x", "Roadie"], { stdio: "ignore" });
    for (const copy of buildCopies()) {
      spawnSync("pluginkit", ["-r", `${copy}/Contents/PlugIns/MarshallWidget.appex`], { stdio: "ignore" });
      spawnSync(LSREGISTER, ["-u", copy], { stdio: "ignore" });
      say(`unregistered ${copy}`);
    }
    rmSync(INSTALLED_APP, { recursive: true, force: true });
    run("ditto", [join(work, "Roadie.app"), INSTALLED_APP]);
    run(LSREGISTER, ["-f", INSTALLED_APP]);
    run("pluginkit", ["-a", `${INSTALLED_APP}/Contents/PlugIns/MarshallWidget.appex`]);
    run("open", [INSTALLED_APP]);
    spawnSync("killall", ["chronod"], { stdio: "ignore" });
    say(`installed Roadie ${plistValue(`${INSTALLED_APP}/Contents/Info.plist`, "CFBundleShortVersionString")} at ${INSTALLED_APP}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ============================================================
// Helpers
// ============================================================

/** The bundle a user will run: this version, the JS bundled in (no Metro), Sparkle embedded, a valid signature. */
function checkBundle(version: string): void {
  const plist = `${BUILT_APP}/Contents/Info.plist`;
  const widgetPlist = `${BUILT_APP}/Contents/PlugIns/MarshallWidget.appex/Contents/Info.plist`;
  for (const [path, key] of [[plist, "CFBundleShortVersionString"], [plist, "CFBundleVersion"], [widgetPlist, "CFBundleVersion"]]) {
    const value = plistValue(path, key);
    if (value !== version) fail(`${path}: ${key} is '${value}', not ${version}`);
  }
  for (const part of ["Contents/Resources/main.jsbundle", "Contents/Frameworks/Sparkle.framework"]) {
    if (!existsSync(join(root, BUILT_APP, part))) fail(`${BUILT_APP}/${part} is missing from the Release build`);
  }
  run("codesign", ["--verify", "--deep", "--strict", BUILT_APP]);
}

/** Roadie bundles Spotlight finds in a build directory (Xcode's DerivedData or this project's build/). */
function buildCopies(): string[] {
  return output("mdfind", ["kMDItemCFBundleIdentifier == 'com.uk.marshallbluetooth'"])
    .split("\n")
    .filter((path) => path.endsWith(".app") && (path.includes("/DerivedData/") || path.startsWith(join(root, "app/macos/build"))));
}

/** The single-item Sparkle feed for `version`. */
function appcast(version: string, url: string, length: number, signature: string): string {
  const page = `https://github.com/${RELEASE_REPO}/releases/tag/v${version}`;
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">`,
    `  <channel>`,
    `    <title>Roadie</title>`,
    `    <link>https://github.com/${RELEASE_REPO}</link>`,
    `    <item>`,
    `      <title>Roadie ${version}</title>`,
    `      <pubDate>${new Date().toUTCString()}</pubDate>`,
    `      <link>${page}</link>`,
    `      <sparkle:version>${version}</sparkle:version>`,
    `      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>`,
    `      <sparkle:minimumSystemVersion>${MINIMUM_SYSTEM}</sparkle:minimumSystemVersion>`,
    `      <sparkle:fullReleaseNotesLink>${page}</sparkle:fullReleaseNotesLink>`,
    `      <enclosure url="${url}" length="${length}" type="application/octet-stream" sparkle:edSignature="${signature}"/>`,
    `    </item>`,
    `  </channel>`,
    `</rss>`,
    ``,
  ].join("\n");
}

/** Subjects of this project's commits since `last`, minus the ones a user never sees. */
function releaseNotes(last: string | null): string {
  const range = last === null ? ["HEAD"] : [`${last}..HEAD`];
  const subjects = output("git", ["log", "--format=%s", ...range, "--", "."])
    .split("\n")
    .filter((subject) => subject !== "" && !NOTE_EXCLUDE.test(subject));
  return subjects.length === 0 ? "Maintenance release." : subjects.map((subject) => `- ${subject}`).join("\n");
}

function keychainPublicKey(): string {
  const result = spawnSync(`${SPARKLE_BIN}/generate_keys`, ["--account", SPARKLE_ACCOUNT, "-p"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail(
      `no Sparkle key for account '${SPARKLE_ACCOUNT}' in this Mac's keychain — import the exported key with ` +
        `${SPARKLE_BIN}/generate_keys --account ${SPARKLE_ACCOUNT} -f <file> (make pods first if ${SPARKLE_BIN} is missing)`,
    );
  }
  return String(result.stdout).trim();
}

function plistValue(path: string, key: string): string {
  return output("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path]).trim();
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}

/** Runs a command with its output on the terminal; a nonzero exit ends the release. */
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${args.slice(0, 3).join(" ")} … exited ${result.status ?? result.signal}`);
}

/** Runs a command and returns its stdout; a nonzero exit ends the release. */
function output(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) fail(`${command} ${args.slice(0, 3).join(" ")} … exited ${result.status ?? result.signal}`);
  return String(result.stdout);
}

function say(message: string): void {
  console.log(`==> ${message}`);
}

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

// ============================================================
// CLI
// ============================================================

if (typeof process !== "undefined" && process.argv[1]?.endsWith("app-release.ts")) {
  const [command, argument, flag] = process.argv.slice(2);
  try {
    if (command === "dist") dist(argument);
    else if (command === "release") release(argument, flag === "--dry-run");
    else if (command === "unrelease") unrelease(argument);
    else if (command === "install") install();
    else fail("usage: app-release.ts dist <x.y.z> | release <patch|minor|major> [--dry-run] | unrelease <vX.Y.Z> | install");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
