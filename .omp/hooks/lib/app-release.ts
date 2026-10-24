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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
// @ts-expect-error — Node builtin, not project-compiled
import { tmpdir } from "node:os";
import { projectRoot } from "./hook-project-root.ts";
import { INSTALLED_APP, LSREGISTER, unregisterOthers } from "./app-registry.ts";

declare const process: { argv: string[]; exit(code?: number): never; env: Record<string, string | undefined> };

// ============================================================
// Constants
// ============================================================

/** The GitHub repository releases are published to. */
export const RELEASE_REPO = "leechoonguk/roadie";
/** The feed and its checksums; no version in either name, so `latest/download/<name>` always resolves. */
export const FEED_ASSET = "appcast.xml";
export const CHECKSUMS_ASSET = "checksums.txt";
/** What every installed copy reads: the app's `SUFeedURL` must equal it. */
export const FEED_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/${FEED_ASSET}`;
/** The keychain account `generate_keys` stored Roadie's EdDSA key under. */
export const SPARKLE_ACCOUNT = "roadie";
/** Sparkle's command-line tools, shipped inside its pod. */
export const SPARKLE_BIN = "app/macos/Pods/Sparkle/bin";

/**
 * The Mac's file on the release, named per OS like the others: a disk image a
 * person opens and drags Roadie from into Applications, and the archive Sparkle
 * downloads and installs from (the appcast names this file for its version).
 */
export function macAsset(version: string): string {
  return `Roadie-${version}-macos.dmg`;
}

/** Every file `make release` publishes for `version`; it refuses a published release missing one. */
export function releaseAssets(version: string): string[] {
  return [macAsset(version), FEED_ASSET, CHECKSUMS_ASSET];
}

const WORKSPACE = "app/macos/MarshallBluetooth.xcworkspace";
const SCHEME = "MarshallBluetooth-macOS";
const APP_PLIST = "app/macos/MarshallBluetooth-macOS/Info.plist";
const DERIVED_DATA = "app/macos/build/DerivedData.noindex";
const DIST_DIR = "app/macos/build/dist";
const BUILT_APP = `${DERIVED_DATA}/Build/Products/Release/Roadie.app`;
const MINIMUM_SYSTEM = "14.0";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** Commit subjects left out of release notes: they change nothing a user sees. */
const NOTE_EXCLUDE = /^(docs|test|chore\(harness\))(\(|:)/;

/**
 * The README's pictures and what draws them: the demo recording is the desktop app's React screens
 * (and the in-memory speaker) driven by `app/desktop/demo.ts`; the widget pictures are the widget's
 * own SwiftUI views rendered by the snapshot tool. A source from the list changing while none of its
 * pictures did leaves the front page showing something the release no longer draws.
 */
const PICTURES: Array<{ files: string[]; drawnBy: string[]; remake: string }> = [
  {
    files: ["docs/demo.gif"],
    drawnBy: [
      "app/src/screens", "app/src/components", "app/src/theme.ts", "app/src/controls.ts", "app/src/devices.ts", "app/src/protocol.ts",
      "app/desktop/demo.ts", "app/desktop/src/demo", "app/desktop/src/renderer",
    ],
    remake: "make demo",
  },
  {
    files: ["docs/widgets-light.png", "docs/widgets-dark.png"],
    drawnBy: ["app/macos/MarshallWidget", "app/macos/Shared", "app/macos/CoreTests/WidgetSnapshots"],
    remake: "make widget-snapshots",
  },
];

const root = projectRoot;

// ============================================================
// Commands
// ============================================================

/** Builds `version` in Release, checks the bundle, and writes the disk image, the feed and the checksums into the dist directory. */
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
  const image = `${DIST_DIR}/${macAsset(version)}`;
  diskImage(image);

  const signature = output(`${SPARKLE_BIN}/sign_update`, ["--account", SPARKLE_ACCOUNT, "-p", image]).trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail(`sign_update printed no EdDSA signature: '${signature}'`);
  run(`${SPARKLE_BIN}/sign_update`, ["--account", SPARKLE_ACCOUNT, "--verify", image, signature]);
  const length = statSync(join(root, image)).size;
  const url = `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${macAsset(version)}`;
  writeFileSync(join(root, DIST_DIR, FEED_ASSET), appcast(version, url, length, signature));

  const sums = [macAsset(version), FEED_ASSET].map((name) => `${sha256(`${DIST_DIR}/${name}`)}  ${name}`);
  writeFileSync(join(root, DIST_DIR, CHECKSUMS_ASSET), `${sums.join("\n")}\n`);
  say(`dist ready: ${releaseAssets(version).map((name) => `${DIST_DIR}/${name}`).join(", ")}`);
}

/** Tags the next version, builds it, publishes the release, and reads it back the way installed copies do. */
export function release(bump: string | undefined, dryRun: boolean): void {
  if (bump !== "patch" && bump !== "minor" && bump !== "major") fail("usage: make release bump=patch|minor|major");
  if (spawnSync("gh", ["auth", "status"], { cwd: root, stdio: "ignore" }).status !== 0) {
    fail("gh (GitHub CLI) is missing or not logged in (gh auth login)");
  }
  requirePublicRepository();

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
  if (last !== "v0.0.0") staleDemoNote(last);
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
    ...releaseAssets(next).map((name) => `${DIST_DIR}/${name}`),
  ]);

  // 5. Read it back: every asset is attached, and the latest release's feed names this version.
  const attached = new Set(
    output("gh", ["release", "view", tag, "-R", RELEASE_REPO, "--json", "assets", "--jq", ".assets[].name"]).split("\n"),
  );
  const missing = releaseAssets(next).filter((name) => !attached.has(name));
  if (missing.length > 0) fail(`release ${tag} is missing ${missing.join(", ")} — make unrelease v=${tag}, then release again`);
  const feed = output("gh", ["release", "download", "-R", RELEASE_REPO, "--pattern", FEED_ASSET, "--output", "-"]);
  if (!feed.includes(`<sparkle:version>${next}</sparkle:version>`)) {
    fail(`the latest release's ${FEED_ASSET} does not name ${next} — installed copies still see the previous release`);
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
 * Installs the latest published release the way a user gets it — its disk image —
 * and makes it the only Roadie macOS knows: build copies are unregistered from
 * LaunchServices and the widget host, so the widget, Spotlight and `open -b` all
 * reach `/Applications`. Downloads through `gh`, which also reaches a private
 * repository. Development builds stay on disk; `make run` registers one again.
 */
export function install(): void {
  const work = mkdtempSync(join(tmpdir(), "roadie-install-"));
  const mount = join(work, "mount");
  let attached = false;
  try {
    run("gh", ["release", "download", "-R", RELEASE_REPO, "--pattern", "*-macos.dmg", "--pattern", CHECKSUMS_ASSET, "--dir", work]);
    const sums: string = readFileSync(join(work, CHECKSUMS_ASSET), "utf-8");
    const [expected, image] = sums.split("\n").find((line: string) => line.trim().endsWith("-macos.dmg"))?.split(/\s+/) ?? [];
    if (image === undefined) fail(`${CHECKSUMS_ASSET} of the latest release names no -macos.dmg`);
    const actual = createHash("sha256").update(readFileSync(join(work, image))).digest("hex");
    if (expected !== actual) fail(`${image}: sha256 ${actual} does not match ${CHECKSUMS_ASSET} (${expected})`);
    run("hdiutil", ["attach", "-quiet", "-nobrowse", "-readonly", "-mountpoint", mount, join(work, image)]);
    attached = true;
    run("codesign", ["--verify", "--deep", "--strict", join(mount, "Roadie.app")]);

    spawnSync("pkill", ["-x", "Roadie"], { stdio: "ignore" });
    for (const copy of unregisterOthers([])) say(`unregistered ${copy.app}`);
    rmSync(INSTALLED_APP, { recursive: true, force: true });
    run("ditto", [join(mount, "Roadie.app"), INSTALLED_APP]);
    run(LSREGISTER, ["-f", INSTALLED_APP]);
    run("pluginkit", ["-a", `${INSTALLED_APP}/Contents/PlugIns/MarshallWidget.appex`]);
    run("open", [INSTALLED_APP]);
    spawnSync("killall", ["chronod"], { stdio: "ignore" });
    say(`installed Roadie ${plistValue(`${INSTALLED_APP}/Contents/Info.plist`, "CFBundleShortVersionString")} at ${INSTALLED_APP}`);
  } finally {
    if (attached) spawnSync("hdiutil", ["detach", "-quiet", mount], { stdio: "ignore" });
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

/**
 * The installer a Mac user opens: Roadie.app beside a link to /Applications, so
 * installing is one drag. Signed with the identity that signed the app, then
 * verified — a damaged image is what Sparkle and the user would both get.
 */
function diskImage(image: string): void {
  const stage = mkdtempSync(join(tmpdir(), "roadie-dmg-"));
  try {
    run("ditto", [join(root, BUILT_APP), join(stage, "Roadie.app")]);
    symlinkSync("/Applications", join(stage, "Applications"));
    run("hdiutil", ["create", "-quiet", "-volname", "Roadie", "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", image]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  run("codesign", ["--sign", signingIdentity(), "--timestamp=none", image]);
  run("codesign", ["--verify", "--strict", image]);
  run("hdiutil", ["verify", "-quiet", image]);
}

/** The certificate that signed the Release build (`codesign` prints it to stderr). */
function signingIdentity(): string {
  const details = spawnSync("codesign", ["-dvv", BUILT_APP], { cwd: root, encoding: "utf8" });
  const identity = /^Authority=(.+)$/m.exec(String(details.stderr))?.[1];
  if (identity === undefined) fail(`${BUILT_APP} carries no signing authority — the Release build was not signed`);
  return identity;
}

/**
 * Installed copies download the feed and the archive without logging in, so a release in a
 * private repository is a release none of them can reach (`releases/latest/download/…` is a 404
 * for them). Checked before anything is tagged or built.
 */
function requirePublicRepository(): void {
  const visibility = output("gh", ["repo", "view", RELEASE_REPO, "--json", "visibility", "--jq", ".visibility"]).trim();
  if (visibility !== "PUBLIC") {
    fail(
      `${RELEASE_REPO} is ${visibility.toLowerCase()} — installed copies download ${FEED_URL} without logging in, so a release ` +
        "published from it is unreachable (404) for every installed copy; make the repository public first " +
        `(gh repo edit ${RELEASE_REPO} --visibility public --accept-visibility-change-consequences)`,
    );
  }
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

/**
 * The README's pictures are re-recorded by hand (`make demo`, `make widget-snapshots`): note, do
 * not block, when what draws a picture changed since `last` and the picture did not — the front page
 * would show a screen or a widget the release no longer draws (rule://root-readme).
 */
function staleDemoNote(last: string): void {
  const changed = (paths: string[]): boolean =>
    spawnSync("git", ["diff", "--quiet", last, "HEAD", "--", ...paths], { cwd: root }).status === 1;
  for (const picture of PICTURES) {
    if (!changed(picture.drawnBy) || changed(picture.files)) continue;
    say(`note: what draws ${picture.files.join(", ")} changed since ${last}, the picture did not;`);
    say(`      if it looks different now, run ${picture.remake}, look at the result, and commit it first`);
  }
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
