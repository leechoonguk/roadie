/**
 * Check-App-Protocol-Parity Post Hook
 *
 * The speaker's GATT layout and the press model exist twice, once per
 * language (app-protocol-parity.md): Swift for macOS and iOS, TypeScript for
 * Windows, Linux and Android. Each half is tested on its own, so a value
 * changed in one half passes every test of both and breaks only one
 * platform's speaker. This check reads both halves and holds them equal:
 *
 *   1. Characteristic and service UUIDs — `UUIDS` in `app/src/protocol.ts`
 *      against `MarshallScanner`'s `CBUUID(string:)` constants, by name.
 *   2. Scales — the EQ range and flat point and the fallback volume maximum
 *      (`EQ_STEPS`, `FALLBACK_MAX_VOLUME` against `EQScale`, `VolumeScale`).
 *   3. Product names — the advertised-name tokens that make a candidate.
 *   4. The press model — the kinds of `ControlAction` and `ControlChange`
 *      (`app/src/controls.ts` against `Shared/ControlStep.swift`).
 *
 * Reads files only. A side that parses to nothing is a finding: an empty set
 * on both sides would otherwise compare equal.
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

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

const TS_PROTOCOL = "app/src/protocol.ts";
const TS_CONTROLS = "app/src/controls.ts";
const SWIFT_SCANNER = "app/macos/MarshallBluetooth-macOS/Native/Core/MarshallScanner.swift";
const SWIFT_SNAPSHOT = "app/macos/Shared/DeviceSnapshot.swift";
const SWIFT_STEP = "app/macos/Shared/ControlStep.swift";
const FILES = [TS_PROTOCOL, TS_CONTROLS, SWIFT_SCANNER, SWIFT_SNAPSHOT, SWIFT_STEP];

/** A 16-bit Bluetooth SIG UUID in its 128-bit form. */
const BLUETOOTH_BASE = (short: string) => `0000${short.toLowerCase()}-0000-1000-8000-00805f9b34fb`;

// ============================================================
// Functions
// ============================================================

export default function checkAppProtocolParity(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-app-protocol-parity", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, FILES)) return;

    const issues = checkAppProtocolParitySync();
    if (issues.length === 0) {
      resetSuppression("check-app-protocol-parity");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-app-protocol-parity",
      issues,
      "change the value in both languages — Swift (macOS, iOS) and TypeScript (Windows, Linux, Android)",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-app-protocol-parity") };
  }));
}

export function checkAppProtocolParitySync(): string[] {
  if (!existsSync(join(projectRoot, TS_PROTOCOL))) {
    return dormant("check-app-protocol-parity", "absent", `no ${TS_PROTOCOL} — no TypeScript half to compare`);
  }
  const missing = FILES.filter((path) => !existsSync(join(projectRoot, path)));
  if (missing.length > 0) {
    return missing.map((path) => `${path}: missing — one half of the protocol cannot be compared with the other`);
  }
  const [tsProtocol, tsControls, swiftScanner, swiftSnapshot, swiftStep] = FILES.map((path) => readFileSync(join(projectRoot, path), "utf-8"));

  const issues: string[] = [];
  issues.push(...compareMaps("UUID", parseTsUuids(tsProtocol), parseSwiftUuids(swiftScanner)));
  issues.push(...compareMaps("scale", parseTsScales(tsProtocol), parseSwiftScales(swiftSnapshot, swiftStep)));
  issues.push(...compareSets("product-name token", stringsOf(tsProtocol, /PRODUCT_NAME_TOKENS\s*=\s*\[([\s\S]*?)\]/), stringsOf(swiftScanner, /productNameTokens\s*=\s*\[([\s\S]*?)\]/)));
  issues.push(...compareSets("ControlAction kind", tsKinds(tsControls, "ControlAction"), swiftCases(swiftStep, "ControlAction")));
  issues.push(...compareSets("ControlChange kind", tsKinds(tsControls, "ControlChange"), swiftCases(swiftStep, "ControlChange")));
  return issues;
}

/** Claim 1, TypeScript half: `UUIDS = { name: 'uuid', … }`. */
function parseTsUuids(source: string): Map<string, string> {
  const body = /export const UUIDS\s*=\s*\{([\s\S]*?)\};/.exec(source)?.[1] ?? "";
  return new Map([...body.matchAll(/(\w+):\s*'([0-9a-fA-F-]+)'/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

/** Claim 1, Swift half: `static let name = CBUUID(string: "…")`, 16-bit forms expanded. */
function parseSwiftUuids(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/static let (\w+) = CBUUID\(string: "([0-9A-Fa-f-]+)"\)/g)].map((m) => [
      m[1],
      m[2].length === 4 ? BLUETOOTH_BASE(m[2]) : m[2].toLowerCase(),
    ]),
  );
}

/** Claim 2, TypeScript half. */
function parseTsScales(source: string): Map<string, string> {
  const scales = new Map<string, string>();
  const eq = /EQ_STEPS\s*=\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+),\s*flat:\s*(\d+)\s*\}/.exec(source);
  if (eq) {
    scales.set("EQ minimum", eq[1]);
    scales.set("EQ maximum", eq[2]);
    scales.set("EQ flat", eq[3]);
  }
  const fallback = /FALLBACK_MAX_VOLUME\s*=\s*(\d+)/.exec(source);
  if (fallback) scales.set("fallback volume maximum", fallback[1]);
  return scales;
}

/** Claim 2, Swift half. */
function parseSwiftScales(snapshot: string, step: string): Map<string, string> {
  const scales = new Map<string, string>();
  const steps = /static let steps = (\d+)\.\.\.(\d+)/.exec(snapshot);
  if (steps) {
    scales.set("EQ minimum", steps[1]);
    scales.set("EQ maximum", steps[2]);
  }
  const flat = /static let flat = (\d+)/.exec(snapshot);
  if (flat) scales.set("EQ flat", flat[1]);
  const fallback = /static let fallbackMaximum = (\d+)/.exec(step);
  if (fallback) scales.set("fallback volume maximum", fallback[1]);
  return scales;
}

/** The quoted strings inside the first match of `list`. */
function stringsOf(source: string, list: RegExp): Set<string> {
  const body = list.exec(source)?.[1] ?? "";
  return new Set([...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
}

/** Claim 4, TypeScript half: the `kind` literals of a union type. */
function tsKinds(source: string, type: string): Set<string> {
  const body = new RegExp(`export type ${type}\\s*=([\\s\\S]*?);\\n`).exec(source)?.[1] ?? "";
  return new Set([...body.matchAll(/kind:\s*'(\w+)'/g)].map((m) => m[1]));
}

/** Claim 4, Swift half: the `case` names of an enum. */
function swiftCases(source: string, type: string): Set<string> {
  const start = source.search(new RegExp(`enum ${type}\\b`));
  if (start < 0) return new Set();
  const body = source.slice(start, source.indexOf("\n}", start));
  return new Set([...body.matchAll(/^\s*case (\w+)/gm)].map((m) => m[1]));
}

function compareMaps(what: string, ts: Map<string, string>, swift: Map<string, string>): string[] {
  if (ts.size === 0 || swift.size === 0) {
    return [`read no ${what} values from ${ts.size === 0 ? "the TypeScript" : "the Swift"} half — the parser is blind, the comparison would pass on nothing`];
  }
  const issues: string[] = [];
  for (const [name, value] of ts) {
    const other = swift.get(name);
    if (other === undefined) {
      issues.push(`${what} ${name} = ${value} in TypeScript has no Swift counterpart of that name`);
    } else if (other !== value) {
      issues.push(`${what} ${name}: TypeScript has ${value}, Swift has ${other} — one platform family talks to a different speaker than the other`);
    }
  }
  for (const name of swift.keys()) {
    if (!ts.has(name)) issues.push(`${what} ${name} in Swift has no TypeScript counterpart of that name`);
  }
  return issues;
}

function compareSets(what: string, ts: Set<string>, swift: Set<string>): string[] {
  if (ts.size === 0 || swift.size === 0) {
    return [`read no ${what}s from ${ts.size === 0 ? "the TypeScript" : "the Swift"} half — the parser is blind, the comparison would pass on nothing`];
  }
  const onlyTs = [...ts].filter((value) => !swift.has(value));
  const onlySwift = [...swift].filter((value) => !ts.has(value));
  if (onlyTs.length === 0 && onlySwift.length === 0) return [];
  return [`${what}s differ — only in TypeScript: ${onlyTs.join(", ") || "none"}; only in Swift: ${onlySwift.join(", ") || "none"}`];
}

// Direct execution (make check-app-protocol-parity): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-app-protocol-parity.ts")) {
  const issues = checkAppProtocolParitySync();
  console.log("==> check-app-protocol-parity");
  if (issues.length === 0) {
    console.log(passLine("check-app-protocol-parity", "Swift and TypeScript agree on UUIDs, scales, product names and the press model"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-app-protocol-parity");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
