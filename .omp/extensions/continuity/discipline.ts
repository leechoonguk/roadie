/**
 * Session Discipline — two signals, ported from measured lessons.
 *
 * Design system (every principle carries its measurement in the harness this
 * was ported from):
 *  1. Knowledge lives in docs. A rulebook checklist took a hookless task gate
 *     to green. Docs are for WHAT.
 *  2. Behavior moves only through runtime messages. Injected turn-time
 *     messages worked every time they fired; static doc directives for tool
 *     choice or work order were adopted zero times in two campaigns. Hooks are
 *     for WHEN.
 *  3. Start early, guard the finish. The green sessions shared exactly these
 *     two levers; everything in between belongs to the model.
 *  4. Destruction is blocked, not advised (strict-* pre hooks + the verify
 *     gate). This module only nudges; it never blocks.
 *
 * A healthy session receives no message at all.
 *
 *  - REG-WATCH   a wiring line (an import, a `#import`, an `RCT_EXTERN_*`
 *    bridge declaration, the `AppRegistry` registration) that vanishes from a
 *    wiring file is reported immediately: wiring accumulates, so a replaced
 *    line silently disconnects a feature. Capped per file.
 *  - Finish gate  when no verification covering the change (`make test`,
 *    `make lint`, `make typecheck`, `make swift-check`, a `make check-*`)
 *    succeeded after the last change and the session is about to end, it is
 *    sent back to verify. The full root `make verify` runs at commit time
 *    (`make commit` / `make push`).
 *
 * This module only nudges. It does not touch context — window management
 * belongs to omp.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join, resolve } from "node:path";
import { projectRoot } from "../../hooks/lib/hook-project-root.ts";

/**
 * A verification that releases the finish gate: any command that covers the
 * changed unit. The full gate runs on the commit path, because requiring it at
 * the end of every task cost minutes per run and ran several times per task.
 */
const VERIFY_RE = /\bmake\b[^|;&]*\b(?:(?:verify|test)\b|lint\b|typecheck\b|swift-check\b|check-[a-z-]+)|\bnode\s+\.omp\/hooks\/post\/check-[a-z-]+\.ts\b/;
/** Red-finish re-drives. */
const END_GATE_MAX = 2;
/**
 * Cap on hard finish-blocks. Measured: an unlimited gate on a degenerate loop
 * (no tools, the same prose repeated) blocked 104 times and pushed the context
 * past the model window. After the cap the session may end red — that row is
 * the measurement.
 */
const FINISH_BLOCK_MAX = 8;
/** Registration-loss messages per watched file, so one noisy file cannot silence the others. */
const REG_WATCH_MAX = 3;
/** Directory holding the Objective-C bridge declarations. */
const NATIVE_DIR = "app/macos/MarshallBluetooth-macOS/Native";
/** Wiring files whose accumulating lines are watched. */
const REG_ENTRY_FILES = ["app/App.tsx", "app/index.js"];
/** Prompt-spanning state: interactive omp starts one process per prompt. */
const STATE_DIR = join(projectRoot, ".omp", "state");
const STATE_FILE = join(STATE_DIR, "discipline.json");
/** A shell command that writes a file is a change too (`cat > path <<'EOF'`). */
const SHELL_WRITE_RE = /(?:>>?|\btee\b\s+(?:-a\s+)?)\s*(["']?)([\w./@-]+\.[A-Za-z0-9]+)\1/g;

type ContentChunk = { type?: string; text?: string };
type ToolResultEvent = {
  toolName?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  isError?: boolean;
};
type TurnEndEvent = { message?: { stopReason?: string }; stopReason?: string; toolResults?: unknown[] };
type TurnContext = { getContextUsage?: () => { tokens?: number } | undefined };
type AgentEndEvent = { messages?: unknown[] };
type Persisted = { lastGateAt?: number; lastNoticeAt?: number };

/** Only the members this module calls. */
interface DisciplineApi {
  on(event: "tool_result", handler: (event: ToolResultEvent) => void): void;
  on(event: "turn_end", handler: (event: TurnEndEvent, ctx: TurnContext) => void): void;
  on(event: "agent_end", handler: (event: AgentEndEvent) => void): void;
  sendUserMessage(text: string): void;
}

export function registerDiscipline(pi: DisciplineApi): void {
  const logPath = process.env.STUCK_RESET_LOG || "";
  const log = (s: string) => { if (logPath) { try { appendFileSync(logPath, `[continuity] ${s}\n`); } catch { /* logging never throws */ } } };

  let endGateSends = 0, lastTurnAt = Date.now();
  let mutatedEver = false;
  const persisted = loadPersisted();
  let lastGateAt = persisted.lastGateAt ?? 0, lastNoticeAt = persisted.lastNoticeAt ?? 0, gateBlocks = 0;
  let lastMutationAt = 0;
  let redSig: string | null = null;
  let redCmdTk: Set<string> | null = null;
  const regFiles = registrationFiles();
  const regSnapshot = new Map<string, Set<string>>();
  const regWarned = new Set<string>();
  const regWarnCount = new Map<string, number>();
  for (const rel of regFiles) {
    try {
      const abs = resolve(projectRoot, rel);
      if (existsSync(abs)) regSnapshot.set(rel, wiringLines(readFileSync(abs, "utf-8")));
    } catch { /* an unreadable file is simply not watched */ }
  }

  function regCheck(touched: string): void {
    for (const rel of regFiles) {
      if (!touched.endsWith(rel) && !rel.endsWith(touched) && !touched.includes(rel.split("/").pop() ?? rel)) continue;
      const snap = regSnapshot.get(rel);
      if (!snap) continue;
      try {
        const abs = resolve(projectRoot, rel);
        if (!existsSync(abs)) continue;
        const cur = wiringLines(readFileSync(abs, "utf-8"));
        const dropped = [...snap].filter((l) => !cur.has(l) && !regWarned.has(l));
        if (dropped.length === 0 || (regWarnCount.get(rel) ?? 0) >= REG_WATCH_MAX) continue;
        dropped.forEach((l) => regWarned.add(l));
        regWarnCount.set(rel, (regWarnCount.get(rel) ?? 0) + 1);
        pi.sendUserMessage(`A wiring line just vanished from ${rel}: \`${dropped[0]}\`${dropped.length > 1 ? ` (+${dropped.length - 1} more)` : ""}. These lines connect modules and expose native methods the rest of the code depends on — restore the line and add yours alongside it instead of replacing.`);
        log(`REG-WATCH ${rel}: ${dropped[0].slice(0, 60)}`);
      } catch { /* the watch never throws */ }
    }
  }

  log(`loaded discipline. endGate=${END_GATE_MAX} regWatch=${regSnapshot.size}files (context management belongs to omp)`);

  pi.on("tool_result", (event: ToolResultEvent) => {
    try {
      const toolName = String(event.toolName ?? "");
      const content = contentText(event.content);
      if (event.isError && isPolicyBlock(content)) return;
      const f = failSig(content);
      // A standing harness-check notice: a finish on top of it is a fake finish.
      if (/\[check-[a-z-]+\][^]{0,60}issue/.test(content)) { lastNoticeAt = Date.now(); savePersisted({ lastNoticeAt }); }
      if (/^bash/i.test(toolName)) {
        const cmdStr = norm(str(event.input)).slice(0, 300);
        const cmdTk = new Set(cmdStr.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
        const truncated = /\|\s*(?:tail|head|grep|sed|awk|wc)\b/.test(cmdStr);
        const verified = !truncated && VERIFY_RE.test(cmdStr);
        if (!event.isError) {
          for (const wp of shellWritePaths(cmdStr)) {
            mutatedEver = true; lastMutationAt = Date.now(); regCheck(wp);
          }
        }
        // Only a successful verification counts. Counting failed ones made the
        // finish predicate true and the block went silent on a red gate.
        if (verified && !event.isError && !f) {
          lastGateAt = Date.now(); savePersisted({ lastGateAt });
        }
        if (f) {
          redSig = f; redCmdTk = cmdTk; log(`red: ${f.slice(0, 100)}`);
        }
        if (!event.isError && !f && (verified || (!truncated && redSig && redCmdTk && jaccard(cmdTk, redCmdTk) >= 0.5))) {
          // A successful verification is the strongest green evidence and clears a stale red.
          if (redSig) log(verified ? "green — red cleared (verification success)" : "green — red cleared (same-command success)");
          redSig = null; redCmdTk = null;
        }
      }
      if (!f && !event.isError && isMutating(toolName)) {
        mutatedEver = true;
        const path = String(event.input?.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
        if (path) { lastMutationAt = Date.now(); regCheck(path); }
        else if (/^bash/i.test(toolName)) regCheck(norm(str(event.input)).slice(0, 300));
        // Schema-independent backstop: a patch-form result names its file as
        // `[path#TAG]` in the result text even when the input carries no path.
        regCheck(content.slice(0, 500));
      }
    } catch (e) { log(`tool_result ERR ${String(e)}`); }
  });

  pi.on("turn_end", (e: TurnEndEvent, ctx: TurnContext) => {
    try {
      const now = Date.now();
      const used = (() => { try { return ctx.getContextUsage?.()?.tokens ?? 0; } catch { return 0; } })();
      log(`turn dt=${((now - lastTurnAt) / 1000).toFixed(1)}s ctx=${used}`);
      lastTurnAt = now;

      // An interrupted turn is handled by who interrupted it:
      //  - `aborted` is the user's Esc. It is not "done", so stay silent —
      //    a signal would restart the work the user just cancelled.
      //  - `error` is a runtime/provider failure. Silence there let a session
      //    end quietly with its work unfinished, so it asks for a resume
      //    (sharing the END_GATE_MAX budget).
      const stopReason = String(e.message?.stopReason ?? e.stopReason ?? "");
      if (stopReason === "aborted") { log("turn interrupted (aborted by user) — no signal"); return; }
      if (stopReason === "error") {
        if (mutatedEver && endGateSends < END_GATE_MAX) {
          endGateSends++;
          pi.sendUserMessage(
            "The previous turn ended with a runtime error, not with your work finished. " +
            "Nothing you changed has been verified since. Re-run the verification that covers " +
            "what you touched and continue from what it reports — do not restart from scratch.",
          );
          log(`turn interrupted (error) — RESUME #${endGateSends}`);
        } else {
          log("turn interrupted (error) — budget spent or nothing changed, no signal");
        }
        return;
      }

      const prose = !(e.toolResults && e.toolResults.length);
      if (prose && endGateSends < END_GATE_MAX) {
        if (redSig) {
          endGateSends++;
          pi.sendUserMessage(`You just finished your answer, but the last observed verification result was failing:\n${redSig.slice(0, 300)}\nRe-run the verification to confirm it actually passes, and finish the remaining failures if any are left.`);
          log(`END-GATE re-drive #${endGateSends}`);
        } else if (gateBlocks >= FINISH_BLOCK_MAX) {
          log(`FINISH-RELEASE (block cap ${FINISH_BLOCK_MAX} reached — ending red is the measurement)`);
        } else if (mutatedEver && (lastGateAt < lastMutationAt || (lastNoticeAt > 0 && lastNoticeAt > lastGateAt))) {
          // Done means "a successful verification after the change". What to
          // verify is decided by the changed unit. Post hooks do not run per
          // tool call (`.omp/config.yml` disabledExtensions); the full set runs
          // in the root `make verify` on the commit path.
          const noticeStanding = lastNoticeAt > 0 && lastNoticeAt > lastGateAt;
          gateBlocks++;
          const why = noticeStanding
            ? "a harness check notice was raised after your last successful verification"
            : "nothing has verified your last change";
          let bmsg = `You are finishing, but ${why}. Run the checks that cover what you changed (\`make test\`, \`make lint\`, \`make typecheck\`, \`make swift-check\`, or the relevant \`make check-*\`), address what they or a standing system-notice report, and only then finish. The full root \`make verify\` runs at commit time (\`make commit\`) — do not run it here.`;
          if (gateBlocks >= 3) bmsg += " The single next action is exactly: run the checks covering the files you changed";
          pi.sendUserMessage(bmsg);
          log(`FINISH-BLOCK #${gateBlocks}`);
        }
      }
    } catch (e2) { log(`turn_end ERR ${String(e2)}`); }
  });

  pi.on("agent_end", (e: AgentEndEvent) => {
    log(`agent_end msgs=${(e.messages ?? []).length} endGate=${endGateSends} red=${redSig ? "YES" : "no"}`);
  });
}

// ---- helpers (details after the entry point — check-code-layout) ----

/** The wiring files present at session start: the JS entry points and every bridge declaration file. */
function registrationFiles(): string[] {
  const files = [...REG_ENTRY_FILES];
  try {
    for (const name of readdirSync(resolve(projectRoot, NATIVE_DIR))) {
      if (name.endsWith(".m")) files.push(join(NATIVE_DIR, name));
    }
  } catch { /* no native tree yet — nothing to watch there */ }
  return files;
}

/** Lines that wire something: imports in all three languages, bridge declarations, the app registration. */
function wiringLines(content: string): Set<string> {
  return new Set(content.split("\n").map((l) => l.trim()).filter((l) =>
    /^(?:import\s+\S|#import\s+[<"])/.test(l)
    || /\bRCT_EXTERN_(?:METHOD|MODULE)\(/.test(l)
    || /\bAppRegistry\.registerComponent\(/.test(l)));
}

function loadPersisted(): Persisted {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Persisted; } catch { return {}; }
}

function savePersisted(patch: Persisted): void {
  try {
    const cur = loadPersisted();
    const next: Persisted = {
      lastGateAt: Math.max(cur.lastGateAt ?? 0, patch.lastGateAt ?? 0) || undefined,
      lastNoticeAt: Math.max(cur.lastNoticeAt ?? 0, patch.lastNoticeAt ?? 0) || undefined,
    };
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(next));
  } catch { /* hooks and extensions never throw */ }
}

function shellWritePaths(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(SHELL_WRITE_RE)) {
    const q = m[2];
    if (!q || /^\/dev\//.test(q) || /^\/tmp\//.test(q)) continue;
    out.push(q.replace(/^\.\//, ""));
  }
  return out;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function str(x: unknown): string {
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function contentText(c: unknown): string {
  if (Array.isArray(c)) {
    return c.map((x: ContentChunk | null) => (x && typeof x.text === "string" ? x.text : "")).join("\n");
  }
  return typeof c === "string" ? c : str(c);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * The failure lines of a gate run: jest's `FAIL`, swiftc's `file:line:col:
 * error:`, tsc's `error TS…`, eslint's `✖ N problems`, and make's own `***`.
 */
function failSig(content: string): string | null {
  const fails = (content.match(/^\s*(?:FAIL|ERROR|FAILED)[:\s].*$|^.*:\d+:\d+: error: .*$|^.*\berror TS\d+:.*$|^.*✖ \d+ problems?.*$|^make: \*\*\* .*$/gim) ?? []).map(norm).sort();
  return fails.length ? fails.join(" | ") : null;
}

function isPolicyBlock(content: string): boolean {
  return /\bBlocked\b|use the .*? tool instead|instead of (cat|head|tail|grep|ls|sed|awk)|not (allowed|permitted)|requires approval|use `?(read|edit|write|grep)`? (tool )?instead/i.test(content);
}

function isMutating(toolName: string): boolean {
  return /^(write|edit|create|apply_patch|str_replace|bash|notebook)/i.test(toolName);
}
