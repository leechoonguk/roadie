/**
 * Which copies of Roadie macOS knows (rule://app-macos-project, "One registered copy").
 *
 * A menu bar app is found by bundle id, so every Roadie.app that Launch Services
 * has registered competes for the same jobs: `open -b`, Spotlight and Launchpad
 * pick one, and the widget host loads the widget extension from whichever copy
 * it elected — a Release build with a higher version beats the Debug build being
 * developed, and a copy left behind by a moved repository or a deleted build
 * directory stays listed until it is unregistered. This module reads that state
 * (the Launch Services dump) and unregisters every copy but the ones to keep.
 *
 * Embedded Sparkle updaters are registered beside their app and outlive it, so a
 * copy's `Updater.app` goes with the copy — an updater whose app record is gone is
 * still a copy (`version` null). `lsregister -dump` is several MB — past Node's 1 MB
 * default buffer.
 *
 * The registry is read fail-loud: a failing command, a dump without bundle records
 * and a Roadie record without a path all throw. An unreadable registry that reads as
 * "no registered copies" would pass the doctor on a format change.
 *
 *   node .omp/hooks/lib/app-registry.ts unregister-others [<app to keep>…]
 *
 * `/Applications/Roadie.app` is always kept; `make run` passes the Debug build it
 * launches. `make doctor` (lib/app-doctor.ts) reads the same state without changing it.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { projectRoot } from "./hook-project-root.ts";

export const BUNDLE_ID = "com.uk.marshallbluetooth";
export const WIDGET_ID = `${BUNDLE_ID}.widget`;
/** Where the one copy of Roadie lives; Sparkle replaces this bundle in place. */
export const INSTALLED_APP = "/Applications/Roadie.app";
/** The Debug build `make run` launches (the one `make build` writes). */
export const DEBUG_APP = join(projectRoot, "app/macos/build/DerivedData.noindex/Build/Products/Debug/Roadie.app");
/** The widget extension inside a copy. */
export const WIDGET_IN_APP = "Contents/PlugIns/MarshallWidget.appex";
export const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

declare const process: { argv: string[]; exit(code?: number): never };

/** One Roadie.app Launch Services lists, with the Sparkle updater registered beside it. */
export interface RegisteredCopy {
  app: string;
  /** `CFBundleShortVersionString` as Launch Services recorded it; null when only the updater is left. */
  version: string | null;
  /** The embedded `Updater.app`'s own registration, when there is one. */
  updater: string | null;
  /** The bundle is still on disk — a stale record points at a deleted build or a moved repository. */
  exists: boolean;
}

/** A command's stdout; a nonzero exit is an error. The buffer holds the Launch Services dump. */
function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} … exited ${result.status ?? result.signal}`);
  return String(result.stdout);
}

/**
 * Every Roadie.app Launch Services has a record for, whether or not it still exists. A dump with no
 * bundle records at all is unreadable, not empty: reporting "no copies" from it would pass the doctor
 * on a format change.
 */
export function registeredCopies(): RegisteredCopy[] {
  const dump = capture(LSREGISTER, ["-dump"]);
  if (!/^bundle id:/m.test(dump)) {
    throw new Error("the Launch Services dump holds no bundle records — its format changed or the registry is unreadable");
  }
  const identifier = new RegExp(`^identifier:\\s+${BUNDLE_ID.replace(/\./g, "\\.")}\\s*$`, "m");
  const copies = new Map<string, RegisteredCopy>();
  for (const record of dump.split(/^-{20,}$/m)) {
    const path = /^path:\s+(.+?)\s+\(0x[0-9a-f]+\)$/m.exec(record)?.[1];
    if (path === undefined && identifier.test(record)) throw new Error(`a Launch Services record of ${BUNDLE_ID} names no path`);
    const parts = path === undefined ? null : /^(.*\/Roadie\.app)(\/Contents\/Frameworks\/Sparkle\.framework\/Versions\/[^/]+\/Updater\.app)?$/.exec(path);
    if (parts === null) continue;
    const copy = copies.get(parts[1]) ?? { app: parts[1], version: null, updater: null, exists: existsSync(parts[1]) };
    if (parts[2] === undefined) copy.version = /^version:\s+(\S+)/m.exec(record)?.[1] ?? copy.version;
    else copy.updater = path ?? null;
    copies.set(parts[1], copy);
  }
  return [...copies.values()];
}

/** Drops a copy from the widget host and Launch Services — the app, its widget and its updater. */
export function unregisterCopy(copy: RegisteredCopy): void {
  spawnSync("pluginkit", ["-r", join(copy.app, WIDGET_IN_APP)], { stdio: "ignore" });
  for (const bundle of [copy.app, copy.updater]) {
    if (bundle !== null) spawnSync(LSREGISTER, ["-u", bundle], { stdio: "ignore" });
  }
}

/** Unregisters every registered copy except `/Applications/Roadie.app` and `keep`; returns what it dropped. */
export function unregisterOthers(keep: string[]): RegisteredCopy[] {
  const kept = new Set([INSTALLED_APP, ...keep]);
  const dropped = registeredCopies().filter((copy) => !kept.has(copy.app));
  for (const copy of dropped) unregisterCopy(copy);
  return dropped;
}

// Direct execution (make run): drop every registered copy but the installed one and the one being launched.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("app-registry.ts")) {
  const [command, ...keep] = process.argv.slice(2);
  if (command !== "unregister-others") {
    console.error("usage: node .omp/hooks/lib/app-registry.ts unregister-others [<app to keep>…]");
    process.exit(2);
  }
  try {
    for (const copy of unregisterOthers(keep)) console.log(`==> unregistered ${copy.app}${copy.exists ? "" : " (no longer on disk)"}`);
  } catch (error) {
    console.error(`app-registry: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
