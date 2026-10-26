/**
 * `make app-smoke` — the running Roadie's window, driven the way a user drives
 * it (rule://app-macos-project). A menu bar app whose window cannot be reopened,
 * or reopens at the wrong size, builds cleanly and passes every gate; this is
 * the one check that opens it. It acts on elements through Accessibility
 * (System Events), never on screen coordinates:
 *
 *   1. Roadie runs (one process) and this terminal may drive it
 *   2. three times: "Open Roadie" in the menu bar item's menu opens exactly one
 *      window at the size it had, and its close button leaves none
 *   3. the opening size: the saved frame when the app has one, else 680×520
 *      content; never below the minimum
 *   4. shrinking to 300×200 stops at the minimum, 560×440 content
 *   5. the size it was found at is set back, and a window found closed is closed
 *
 * Drives the copy that runs — `/Applications/Roadie.app` or the build `make run`
 * launched — and changes nothing it does not restore. Not part of `verify`: it
 * needs a logged-in GUI session and Accessibility permission for the terminal.
 *
 *   node app-smoke.ts     print PASS/FAIL per step, exit 1 on any FAIL
 *
 * Separate osascript calls with a pause between them: one long `tell` block
 * raced the window list.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { homedir } from "node:os";
import { BUNDLE_ID, runningApps } from "./app-registry.ts";

declare const process: { argv: string[]; exit(code?: number): never };

// ============================================================
// Constants
// ============================================================

const APP_NAME = "Roadie";
const MENU_ITEM = "Open Roadie";
const CYCLES = 3;
/** Content size the window opens at when the app has no saved frame, and the smallest it may be made. */
const OPENING = { width: 680, height: 520 };
const MINIMUM = { width: 560, height: 440 };
/** The title bar adds to the content height; this range holds any macOS release's. */
const TITLE_BAR = { least: 20, most: 40 };
const SHRINK_TO = { width: 300, height: 200 };
/** After a click the window list needs a moment to follow. */
const SETTLE_MS = 2500;
const SHORT_MS = 1000;
/** How long after "Open" the window list is polled, and how often. */
const OPEN_WAIT_MS = 4000;
const POLL_MS = 500;
/** The menu can be rebuilt between the two clicks (the click then lands on a stale item), so an "Open" that opened nothing is repeated; the attempts are reported. */
const OPEN_ATTEMPTS = 3;
/** The key the window's frame autosave writes into the app's defaults. */
const FRAME_KEY = "NSWindow Frame main";

interface Size {
  width: number;
  height: number;
}

/** What the run must put back: the size the window was found at, and whether it was open. */
interface Found {
  size: Size | null;
  open: boolean;
}

/** The size in the app's frame autosave, or null while it has none; unreadable when macOS keeps a sandboxed app's container from this shell. */
interface SavedFrame {
  size: Size | null;
  readable: boolean;
}

type Check = (step: string, ok: boolean, detail: string) => boolean;

// ============================================================
// Commands
// ============================================================

/** Prints one PASS/FAIL line per step; the exit code is 1 when any step failed. */
export function smoke(): number {
  let passed = 0;
  let failed = 0;
  const check: Check = (step, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
    if (ok) passed += 1;
    else failed += 1;
    return ok;
  };
  console.log(`==> app-smoke (Accessibility, ${APP_NAME}'s window; restores what it changes)`);

  const found: Found = { size: null, open: false };
  try {
    drive(check, found);
  } catch (error) {
    check("app-smoke", false, error instanceof Error ? error.message : String(error));
  }
  restore(check, found);
  console.log(`==> app-smoke: ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

// ============================================================
// Steps
// ============================================================

/** The whole walk: preflight, the open/close cycles, the opening size, the minimum. Stops at the first step the rest depends on. */
function drive(check: Check, found: Found): void {
  const running = runningApps();
  const [app] = running;
  if (!check("running", running.length === 1, app === undefined ? `${APP_NAME} is not running — start /Applications/${APP_NAME}.app, or \`make run\`` : `${app.path} (pid ${app.pid})`)) return;
  const version = spawnSync("defaults", ["read", `${app.path}/Contents/Info`, "CFBundleShortVersionString"], { encoding: "utf8" }).stdout.trim();
  console.log(`     driving ${app.path} ${version}`);

  const windows = windowCount();
  check("accessibility", true, `this terminal may drive ${APP_NAME} through System Events`);
  found.open = windows > 0;
  if (windows > 1) {
    check("windows", false, `${windows} windows at start, expected at most 1`);
    return;
  }
  if (found.open) found.size = windowSize();
  const saved = savedFrame();
  const savedText = !saved.readable ? "unreadable (sandbox container)" : saved.size === null ? "none" : `${saved.size.width}×${saved.size.height}`;
  console.log(`     found ${found.open ? `open at ${found.size?.width}×${found.size?.height}` : "closed"}; saved frame ${savedText}`);

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const attempts = openFromMenu();
    const opened = windowCount();
    if (!check(`cycle ${cycle}/${CYCLES} open`, opened === 1, `"${MENU_ITEM}" leaves ${opened} window(s)${attempts > 1 ? `, after ${attempts} attempts` : ""}`)) return;
    const size = windowSize();
    found.size ??= size;
    check(`cycle ${cycle}/${CYCLES} size`, size.width === found.size.width && size.height === found.size.height, `${size.width}×${size.height}, found at ${found.size.width}×${found.size.height}`);
    closeWindow();
    const left = windowCount();
    if (!check(`cycle ${cycle}/${CYCLES} close`, left === 0, `the close button leaves ${left} window(s)`)) return;
  }

  const reopened = openFromMenu();
  if (!check("reopen", windowCount() === 1, `one window after the last close${reopened > 1 ? `, after ${reopened} attempts` : ""}`)) return;
  const opening = windowSize();
  if (!saved.readable) {
    console.log(`SKIP opening size: ${opening.width}×${opening.height}; the saved frame is in a sandbox container macOS keeps from this shell, so only the cycles' equal sizes above hold`);
  } else if (saved.size === null) {
    check("opening size", opening.width === OPENING.width && inTitleBar(opening.height - OPENING.height), `${opening.width}×${opening.height}, expected ${OPENING.width}×${OPENING.height} content plus the title bar`);
  } else {
    check("opening size", opening.width === saved.size.width && opening.height === saved.size.height, `${opening.width}×${opening.height}, the saved frame is ${saved.size.width}×${saved.size.height}`);
  }
  check("above the minimum", opening.width >= MINIMUM.width && opening.height >= MINIMUM.height + TITLE_BAR.least, `${opening.width}×${opening.height}, the minimum content is ${MINIMUM.width}×${MINIMUM.height}`);

  setWindowSize(SHRINK_TO);
  const shrunk = windowSize();
  check(
    "minimum size",
    shrunk.width === MINIMUM.width && inTitleBar(shrunk.height - MINIMUM.height),
    `${SHRINK_TO.width}×${SHRINK_TO.height} became ${shrunk.width}×${shrunk.height} (content ${MINIMUM.width}×${MINIMUM.height} plus a ${shrunk.height - MINIMUM.height} pt title bar)`,
  );
}

/**
 * Puts the window back as found — its size, and closed when it was closed; a
 * failure here is a FAIL line of its own. A window that went away mid-restore
 * is opened again once, so the saved frame is never left at the shrunk size.
 */
function restore(check: Check, found: Found): void {
  try {
    if (found.size === null) return;
    let size: Size | null = null;
    for (let attempt = 1; attempt <= 2 && (size === null || size.width !== found.size.width || size.height !== found.size.height); attempt += 1) {
      if (windowCount() === 0) openFromMenu();
      setWindowSize(found.size);
      size = windowCount() === 0 ? null : windowSize();
    }
    check("restore size", size !== null && size.width === found.size.width && size.height === found.size.height, `${size === null ? "no window" : `${size.width}×${size.height}`}, found at ${found.size.width}×${found.size.height}`);
    if (!found.open) {
      closeWindow();
      check("restore state", windowCount() === 0, "the window was closed when found, and is closed again");
    }
  } catch (error) {
    check("restore", false, error instanceof Error ? error.message : String(error));
  }
}

/**
 * The menu bar item's menu, then its "Open" item — two calls, because one raced
 * the menu — and the window list polled until the window shows. Returns the
 * attempt that opened a window, or 0 when none did.
 */
function openFromMenu(): number {
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt += 1) {
    ax("click menu bar item 1 of menu bar 2");
    sleep(SHORT_MS);
    try {
      ax(`click menu item "${MENU_ITEM}" of menu 1 of menu bar item 1 of menu bar 2`);
    } catch (error) {
      if (attempt === OPEN_ATTEMPTS) throw error;
      continue;
    }
    for (let waited = 0; waited < OPEN_WAIT_MS; waited += POLL_MS) {
      sleep(POLL_MS);
      if (windowCount() > 0) return attempt;
    }
  }
  return 0;
}

function closeWindow(): void {
  ax('click (first button of window 1 whose subrole is "AXCloseButton")');
  sleep(SETTLE_MS);
}

function setWindowSize(size: Size): void {
  ax(`set size of window 1 to {${size.width}, ${size.height}}`);
  sleep(SHORT_MS);
}

// ============================================================
// Helpers
// ============================================================

function windowCount(): number {
  return Number(ax("count of windows"));
}

function windowSize(): Size {
  const match = /^(\d+), (\d+)$/.exec(ax("get size of window 1"));
  if (match === null) throw new Error("System Events returned no window size");
  return { width: Number(match[1]), height: Number(match[2]) };
}

function inTitleBar(extra: number): boolean {
  return extra >= TITLE_BAR.least && extra <= TITLE_BAR.most;
}

/**
 * The window size the app's frame autosave holds (`x y width height …`). A sandboxed app
 * keeps its defaults in its container, an unsandboxed one in the user's domain; the
 * container may be closed to this shell (`Operation not permitted`), which `defaults`
 * reports like an absent domain — so readability is tested first.
 */
function savedFrame(): SavedFrame {
  const containerDir = `${homedir()}/Library/Containers/${BUNDLE_ID}`;
  const preferences = `${containerDir}/Data/Library/Preferences`;
  let readable = true;
  if (existsSync(containerDir)) {
    try {
      readdirSync(preferences);
    } catch {
      readable = false;
    }
  }
  for (const domain of readable ? [`${preferences}/${BUNDLE_ID}`, BUNDLE_ID] : [BUNDLE_ID]) {
    const frame = spawnSync("defaults", ["read", domain, FRAME_KEY], { encoding: "utf8" });
    const match = frame.status === 0 ? /^\s*-?\d+ -?\d+ (\d+) (\d+)/.exec(frame.stdout) : null;
    if (match !== null) return { size: { width: Number(match[1]), height: Number(match[2]) }, readable };
  }
  return { size: null, readable };
}

/** One action against Roadie's process in System Events; a refusal names its cause. */
function ax(action: string): string {
  const result = spawnSync("osascript", ["-e", `tell application "System Events" to tell process "${APP_NAME}" to ${action}`], { encoding: "utf8" });
  if (result.status === 0) return String(result.stdout).trim();
  const error = String(result.stderr).trim();
  if (/assistive access|-25211/i.test(error)) {
    throw new Error("Accessibility permission is missing — allow the app this terminal runs in under System Settings › Privacy & Security › Accessibility, then rerun `make app-smoke`");
  }
  if (/-1743|not authorized to send apple events/i.test(error)) {
    throw new Error("Automation permission is missing — allow this terminal to control System Events under System Settings › Privacy & Security › Automation, then rerun `make app-smoke`");
  }
  throw new Error(`System Events refused \`${action}\`: ${error}`);
}

function sleep(milliseconds: number): void {
  spawnSync("sleep", [String(milliseconds / 1000)]);
}

// ============================================================
// CLI
// ============================================================

if (typeof process !== "undefined" && process.argv[1]?.endsWith("app-smoke.ts")) {
  process.exit(smoke());
}
