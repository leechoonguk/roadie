/**
 * `make doctor` — what this Mac believes about Roadie, read-only.
 *
 * Every "the new app does not work" report in this project's history was an
 * environment fact found by log forensics: a second copy of Roadie.app
 * registered, a widget loaded from the wrong copy, a signing identity whose team
 * is not the project's, a missing intermediate certificate, the Command Line
 * Tools selected instead of Xcode. This prints those facts in one place and exits
 * non-zero when any of them is wrong, naming the fix.
 *
 * Read-only by contract: it lists the Launch Services dump, asks pluginkit,
 * `ps`, `security` and `openssl` to print, and changes nothing — no
 * unregistering, no keychain writes (rule://app-macos-project, "Running on This Mac").
 * Every read is fail-loud: a command that exits nonzero or a registry that cannot be
 * parsed is a problem of its own, never an empty section that reads as "all clear".
 *
 *   1. Registered copies — every Roadie.app Launch Services knows. Only
 *      `/Applications/Roadie.app` and the Debug build `make run` launches may be
 *      registered; any other is listed as extra.
 *   2. Widget — the registration pluginkit chose must belong to the app that
 *      runs (or, when none runs, to an allowed copy); running processes are listed.
 *   3. Signing — a valid code-signing identity whose team is the pbxproj's
 *      `DEVELOPMENT_TEAM`; the Apple WWDR G3 intermediate present and unexpired.
 *   4. Toolchain — `xcode-select -p` is Xcode, not the Command Line Tools, when
 *      Xcode exists.
 *   5. Metro — whether the bundler answers on 8081. `requireMetro` is what `make run`
 *      calls first, because Debug loads its JavaScript from Metro and an empty window
 *      is the symptom of its absence.
 *
 *   node .omp/hooks/lib/app-doctor.ts           print the report, exit 1 when there is a problem
 *   node .omp/hooks/lib/app-doctor.ts metro     exit 1 unless Metro answers on 8081
 */
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { projectRoot } from "./hook-project-root.ts";
import { BUNDLE_ID, DEBUG_APP, INSTALLED_APP, registeredCopies, WIDGET_ID } from "./app-registry.ts";

declare const process: { argv: string[]; exit(code?: number): never };

// ============================================================
// Constants
// ============================================================

const PROJECT_FILE = "app/macos/MarshallBluetooth.xcodeproj/project.pbxproj";
const METRO_STATUS_URL = "http://localhost:8081/status";
const WWDR_NAME = "Apple Worldwide Developer Relations Certification Authority";
/** Said by `make run` and by the doctor alike: the one fix for a Debug app with no Metro. */
export const METRO_MESSAGE = "Debug loads its JS from Metro — run `make start` first (or install a Release with `make app-install`)";

interface Section {
  title: string;
  lines: string[];
}

/** One entry of `pluginkit -m -vv`: its election tag, version and where the extension lives. */
interface WidgetRegistration {
  tag: string;
  version: string;
  path: string;
}

// ============================================================
// Commands
// ============================================================

/** Prints the report; the exit code is 1 when any section reports a problem. */
export function doctor(): number {
  const problems: string[] = [];
  const sections = [copies(problems), widget(problems), signing(problems), toolchain(problems), metro()];
  console.log("==> doctor (read-only: Launch Services, pluginkit, keychain, processes)");
  for (const section of sections) {
    console.log(`${section.title}:`);
    for (const line of section.lines) console.log(`  ${line}`);
  }
  console.log(`==> doctor: ${problems.length === 0 ? "ok" : `${problems.length} problem(s)`}`);
  for (const problem of problems) console.log(`    PROBLEM: ${problem}`);
  return problems.length === 0 ? 0 : 1;
}

/** Fails unless Metro answers — before the minutes of an Xcode build that would launch an empty window. */
export function requireMetro(): void {
  const answer = spawnSync("curl", ["-fsS", "--max-time", "2", METRO_STATUS_URL], { encoding: "utf8" });
  if (answer.status !== 0) {
    console.error(`run: nothing answers on 8081. ${METRO_MESSAGE}`);
    process.exit(1);
  }
  if (!String(answer.stdout).includes("packager-status:running")) {
    console.error(`run: 8081 answers, but not as Metro. ${METRO_MESSAGE}`);
    process.exit(1);
  }
}

// ============================================================
// Sections
// ============================================================

/** Claim 1: only the installed copy and the Debug build are registered. */
function copies(problems: string[]): Section {
  const section: Section = { title: `Launch Services: registered copies of ${BUNDLE_ID}`, lines: [] };
  try {
    const registered = registeredCopies();
    const extras: string[] = [];
    for (const copy of registered) {
      const role = copy.app === INSTALLED_APP ? "installed" : copy.app === DEBUG_APP ? "debug build" : "EXTRA";
      if (role === "EXTRA") extras.push(copy.app);
      section.lines.push(`${role.padEnd(11)} ${(copy.version ?? "?").padEnd(8)} ${copy.app}${copy.exists ? "" : "  (no longer on disk)"}`);
    }
    if (registered.length === 0) section.lines.push("none registered");
    if (extras.length > 0) {
      problems.push(
        `${extras.length} extra registered cop${extras.length === 1 ? "y" : "ies"} besides ${INSTALLED_APP} and the Debug build ` +
          "— Spotlight, `open -b` and the widget host may pick them; `make run` (or `make app-install`) unregisters them",
      );
    }
  } catch (error) {
    problems.push(`Launch Services is unreadable: ${message(error)}`);
  }
  return section;
}

/** Claims 2 and 3 of the widget: the host elected a copy that is the one running. */
function widget(problems: string[]): Section {
  const section: Section = { title: `widget host: ${WIDGET_ID}, and the running processes`, lines: [] };
  try {
    const chosen = widgetRegistrations(["-m", "-vv", "-i", WIDGET_ID])[0] ?? null;
    for (const registration of widgetRegistrations(["-m", "-A", "-D", "-vv", "-i", WIDGET_ID])) {
      const mark = chosen !== null && registration.path === chosen.path ? "chosen" : "      ";
      section.lines.push(`${mark} ${registration.tag || " "} ${registration.version.padEnd(8)} ${registration.path}`);
    }
    if (chosen === null) section.lines.push("no registration");
    const running = runningRoadies();
    for (const line of running.lines) section.lines.push(line);
    if (running.lines.length === 0) section.lines.push("Roadie is not running");

    const widgetApp = chosen === null ? null : chosen.path.split("/Contents/PlugIns/")[0];
    if (running.apps.length > 1) {
      problems.push(`${running.apps.length} different Roadie bundles are running (${running.apps.join(", ")}) — quit all but one`);
    }
    if (running.apps.length > 0 && chosen === null) {
      problems.push(`${running.apps[0]} runs but no widget is registered with pluginkit — \`make run\` registers the Debug build's widget`);
    }
    if (widgetApp !== null && running.apps.length > 0 && !running.apps.includes(widgetApp)) {
      problems.push(
        `the widget pluginkit chose lives in ${widgetApp}, but ${running.apps.join(", ")} runs — the widget would show the other copy's ` +
          "state; `make run` re-registers the Debug build, `make app-install` makes /Applications the only copy",
      );
    }
    if (widgetApp !== null && running.apps.length === 0 && widgetApp !== INSTALLED_APP && widgetApp !== DEBUG_APP) {
      problems.push(`the widget pluginkit chose lives in ${widgetApp}, an extra copy — \`make run\` or \`make app-install\` unregisters it`);
    }
  } catch (error) {
    problems.push(`pluginkit or the process table is unreadable: ${message(error)}`);
  }
  return section;
}

/** Claim 4: this Mac can sign what `make build` and `make dist` produce. */
function signing(problems: string[]): Section {
  const section: Section = { title: "signing", lines: [] };
  try {
    const teams = projectTeams();
    section.lines.push(`project team (pbxproj DEVELOPMENT_TEAM): ${teams.join(", ") || "none"}`);
    if (teams.length !== 1) {
      const found = teams.length === 0 ? "no DEVELOPMENT_TEAM" : `different DEVELOPMENT_TEAMs (${teams.join(", ")})`;
      problems.push(`${PROJECT_FILE} sets ${found} — every target signs with one team`);
    }

    const names = [...run("security", ["find-identity", "-v", "-p", "codesigning"]).matchAll(/^\s*\d+\)\s+\w+\s+"([^"]+)"/gm)].map((match) => match[1]);
    const identities = names.map((name) => ({ name, team: certificateTeam(name) }));
    for (const identity of identities) section.lines.push(`identity: ${identity.name} (team ${identity.team ?? "?"})`);
    if (identities.length === 0) {
      problems.push(
        "no valid code-signing identity in the keychain — an expired certificate, a missing private key or a missing WWDR intermediate " +
          "(`security find-identity -v -p codesigning`); sign in to Xcode > Settings > Accounts to create one",
      );
    } else if (teams.length === 1 && !identities.some((identity) => identity.team === teams[0])) {
      const held = identities.map((identity) => identity.team ?? "?").join(", ");
      problems.push(`no valid identity belongs to team ${teams[0]} (found ${held}) — the build would be signed by another team than the App Group's`);
    }

    // `security find-certificate` exits 44 when nothing matches, and `openssl -checkend` exits 1 for an expired
    // certificate: both are answers, not failures.
    const intermediates = run("security", ["find-certificate", "-a", "-c", WWDR_NAME, "-p"], undefined, [0, 44])
      .split(/(?<=-----END CERTIFICATE-----)/)
      .filter((pem) => pem.includes("BEGIN CERTIFICATE"));
    const g3 = intermediates.filter((pem) => /OU=G3\b/.test(run("openssl", ["x509", "-noout", "-subject", "-nameopt", "RFC2253"], pem)));
    const live = g3.filter((pem) => /will not expire/.test(run("openssl", ["x509", "-noout", "-checkend", "0"], pem, [0, 1])));
    section.lines.push(`WWDR G3 intermediate: ${live.length > 0 ? "present" : g3.length > 0 ? "expired" : "missing"}`);
    if (live.length === 0) {
      problems.push(
        `the Apple WWDR G3 intermediate certificate is ${g3.length > 0 ? "expired" : "missing"} — a development identity cannot chain to Apple's root; ` +
          "open https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer to add it to the login keychain",
      );
    }
  } catch (error) {
    problems.push(`the signing chain is unreadable: ${message(error)}`);
  }
  return section;
}

/** Claim 5: Xcode, not the Command Line Tools, when Xcode exists — the build and the widget toolchain need it. */
function toolchain(problems: string[]): Section {
  const section: Section = { title: "toolchain", lines: [] };
  try {
    const developerDir = run("xcode-select", ["-p"]).trim();
    const xcodes: string[] = existsSync("/Applications") ? readdirSync("/Applications").filter((name: string) => /^Xcode.*\.app$/.test(name)) : [];
    section.lines.push(`xcode-select: ${developerDir || "unset"}${xcodes.length > 0 ? `  (Xcode: ${xcodes.join(", ")})` : ""}`);
    if (xcodes.length > 0 && !developerDir.startsWith("/Applications/Xcode")) {
      problems.push(
        `xcode-select points at ${developerDir || "nothing"} while ${xcodes[0]} is installed — the build and the widget toolchain need Xcode: ` +
          `sudo xcode-select -s /Applications/${xcodes[0]}/Contents/Developer`,
      );
    }
  } catch (error) {
    problems.push(`xcode-select is unreadable: ${message(error)}`);
  }
  return section;
}

/** Whether Metro answers; informational, because a Release build does not need it. */
function metro(): Section {
  const answer = spawnSync("curl", ["-fsS", "--max-time", "2", METRO_STATUS_URL], { encoding: "utf8" });
  const running = answer.status === 0 && String(answer.stdout).includes("packager-status:running");
  return { title: "metro", lines: [running ? "answers on 8081" : "nothing answers on 8081 (Debug needs `make start`)"] };
}

// ============================================================
// Helpers
// ============================================================

/** The distinct `DEVELOPMENT_TEAM` values of the project file; none when the file is absent (check-app-macos-project owns its existence). */
function projectTeams(): string[] {
  const path = join(projectRoot, PROJECT_FILE);
  if (!existsSync(path)) return [];
  return [...new Set([...readFileSync(path, "utf-8").matchAll(/DEVELOPMENT_TEAM = "?([A-Z0-9]+)"?;/g)].map((match) => match[1]))];
}

/** The team a certificate was issued to: the OU of its subject. */
function certificateTeam(name: string): string | null {
  const pem = run("security", ["find-certificate", "-c", name, "-p"]).split(/(?<=-----END CERTIFICATE-----)/)[0] ?? "";
  if (!pem.includes("BEGIN CERTIFICATE")) return null;
  return /OU=([A-Z0-9]+)/.exec(run("openssl", ["x509", "-noout", "-subject", "-nameopt", "RFC2253"], pem))?.[1] ?? null;
}

/** Entries of `pluginkit` for the widget, in the order it prints them. */
function widgetRegistrations(args: string[]): WidgetRegistration[] {
  const found: WidgetRegistration[] = [];
  for (const line of run("pluginkit", args).split("\n")) {
    const header = /^([+\-!=?]?)\s+[\w.-]+\(([^)]*)\)\s*$/.exec(line);
    if (header !== null) found.push({ tag: header[1], version: header[2], path: "" });
    const path = /^\s+Path = (.+)$/.exec(line)?.[1];
    if (path !== undefined && found.length > 0) found[found.length - 1].path = path;
  }
  return found.filter((registration) => registration.path !== "");
}

/** Roadie and widget processes, with the bundle each runs from. */
function runningRoadies(): { apps: string[]; lines: string[] } {
  const lines: string[] = [];
  const apps: string[] = [];
  for (const line of run("ps", ["-axo", "pid=,command="]).split("\n")) {
    const match = /^\s*(\d+)\s+(\/.*?\/Roadie\.app)\/Contents\/(MacOS\/Roadie|PlugIns\/MarshallWidget\.appex\/Contents\/MacOS\/MarshallWidget)(?:\s|$)/.exec(line);
    if (match === null) continue;
    const isWidget = match[3].startsWith("PlugIns/");
    lines.push(`${match[1].padEnd(7)} ${isWidget ? "widget" : "app   "} ${match[2]}`);
    if (!isWidget && !apps.includes(match[2])) apps.push(match[2]);
  }
  return { apps, lines };
}

/** A command's stdout; an exit status outside `ok` is an error, so an unreadable source is never an empty one. */
function run(command: string, args: string[], input?: string, ok: number[] = [0]): string {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 16 * 1024 * 1024 });
  if (!ok.includes(result.status)) throw new Error(`${command} ${args.slice(0, 3).join(" ")} … exited ${result.status ?? result.signal}`);
  return String(result.stdout);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================
// CLI
// ============================================================

// Direct execution (make doctor, make run): print the report, or gate on Metro.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("app-doctor.ts")) {
  const command = process.argv[2];
  if (command === "metro") requireMetro();
  else if (command === undefined) process.exit(doctor());
  else {
    console.error("usage: app-doctor.ts [metro]");
    process.exit(2);
  }
}
