/**
 * Strict-Additive-Writes Pre Hook
 *
 * An additive task must not wipe existing code. Measured failure class (in the
 * harness this was ported from): asked to ADD a domain, a local model rewrote a
 * shared file and dropped the import line other domains depended on. The
 * write/edit path that loses the most at once is a full-file `write` onto an
 * existing source file; the shell twin is a `>` truncation. Both are blocked
 * with guidance toward targeted edits — `edit` changes survive, wholesale
 * rewrites forget.
 *
 * Here the accumulating lines are the TypeScript imports that wire the screens
 * to `src/native/*`, the Swift `import` lines, the Objective-C `#import`s, and
 * the `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` declarations that expose the
 * Swift adapters to React Native: drop one and a method silently disappears
 * from the JS side, because nothing fails until it is called.
 *
 * 등록/배선의 판정 기준: **줄의 모양이 아니라 항목의 생존**이다. 편집 뒤에도 같은 형태의
 * 항목이 파일 어딘가에 남으면(중복 제거, 같은 패치 안의 이동) 손실이 아니다. 마지막 하나가
 * 사라질 때만 막는다. 그리고 조용히 사라지는 곳에서만 막는다 — 테스트 파일의 import 소실은
 * jest 가 즉시 터뜨리므로 이 가드의 대상이 아니다.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { resolve } from "node:path";

const MIN_LINES = 12;        // files smaller than this are cheap to rewrite honestly
const RETAIN_FLOOR = 0.5;    // block when less than half of the existing lines survive

export default function strictAdditiveWrites(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: { toolName: string; input: Record<string, unknown> }, _ctx: unknown) => {
    const toolName = String(event.toolName ?? "");

    if (toolName === "bash" || toolName === "eval") {
      const body = String(event.input.command ?? event.input.code ?? "");
      const m = body.match(/(?<![>\d&])>\s*([\w@./-]+\.(?:ts|tsx|js|mjs|swift|m|h|md|yml|yaml|json|plist))\b/);
      if (!m) return;
      const abs = resolve(process.cwd(), m[1]);
      if (!existsSync(abs)) return;
      if (countLines(abs) < MIN_LINES) return;
      return {
        block: true,
        reason:
          `\`> ${m[1]}\` truncates an existing file — append with >>, or use the edit tool ` +
          "for targeted changes. An additive task must not wipe existing content.",
      };
    }

    if (toolName === "edit" && typeof event.input.input === "string") {
      // omp patch form, measured: {path, input: "[rel#TAG]\nPUT 12.:\n+line..."}.
      // Grammar observed in sessions: `PUT N:`/`PUT N.:` REPLACE line N; `PUT N+k@:`/`PUT N+k:`
      // INSERT after line N. The replace-instead-of-add habit (a sibling import swapped for the
      // new one) arrived as a replace-form PUT on the import line. Destruction is blocked, not advised.
      const patch = event.input.input;
      // 경로는 세 곳에 있을 수 있다: `path`(깨끗), `path`+내용 태그(`App.tsx#0D77`), 또는 패치 본문의
      // `[상대경로#TAG]` 헤더. 원 하네스 전수 점검: 편집 2,923건 중 2,230건은 `path` 자체가 없고
      // 440건은 태그가 붙어 있었다 — 둘 다 fail-open 으로 빠져서 이 가드는 **91% 무동작**이었다.
      const header = /^\s*\[([^\]\n#]+)/.exec(patch);
      const rawPath = String(event.input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "") || (header?.[1] ?? "");
      const path = rawPath;
      const abs = path.startsWith("/") ? path : resolve(process.cwd(), path);
      const fileText = safeRead(abs);
      if (fileText === null) return; // 빈 path→cwd(디렉터리) 등 — EISDIR 클래스 fail-open
      const fileLines = fileText.split("\n");
      // 이 패치가 **더하는** 줄 전부(op 를 가리지 않고 모은다). 한 패치 안에서 옮기는 편집
      // (여기서 지우고 저기에 다시 넣기)은 손실이 아니다 — 항목 생존 판정에 함께 넣는다.
      const patchAdds = [...patch.matchAll(/(?:^|\n)PUT \d+(?:\+\d+@?)?(?:\.?=\d+)?\.?:\n((?:(?!PUT \d|CUT \d)[^\n]*(?:\n|$))+)/g)]
        .flatMap((m) => m[1].split("\n").map((l) => l.replace(/^\+/, "").trim()).filter(Boolean));
      // 등록 보호는 **조용히 사라지는 곳** 에만 건다. 테스트 파일에서 import 가 없어지면 jest 가
      // 즉시 터지고 게이트가 초 단위로 잡는다 — 거기서까지 막으면 자기 파일을 고치는 정당한 편집이
      // 갇힌다(원 하네스 실측: 방금 자기가 쓴 테스트의 import 를 고치다 2회 연속 차단).
      const isTestPath = /(^|\/)__tests__\//.test(path) || /\.(spec|test)\.[jt]sx?$/.test(path);
      // 의도 프로토콜: 차단은 "실수 교체"만 걸러내는 장치다.
      // 진짜 교체 의도는 편집에 `// intent: replace` 마커를 실어 명시하면 통과한다 —
      // 추가를 원하면 삽입형으로, 교체를 원하면 선언하고 교체한다.
      const intendedReplace = /(?:#|\/\/)\s*intent:\s*replace/i.test(patch);
      // 본문 줄의 `+` 접두는 **선택**이다 — 접두 없는 형식(`PUT 233:\n import …`)으로 등록 줄이
      // 교체됐는데 파서가 통째로 놓친 회귀가 있었다.
      // 삭제형(`CUT N`, `CUT N.=M`)은 등록 줄을 지우는 가장 직접적인 형태다 — 지운 줄이 등록·import 면 막는다.
      if (!intendedReplace && !isTestPath) {
        for (const cut of patch.matchAll(/(?:^|\n)CUT (\d+)(?:\.?=(\d+))?/g)) {
          const from = Number(cut[1]), to = Number(cut[2] ?? cut[1]);
          const lost = lostEntries(fileLines, from, to, patchAdds);
          if (lost.length > 0) {
            return {
              block: true,
              reason: `\`${path}\` ${from}${to > from ? `-${to}` : ""}행을 지우면 \`${lost.join(", ").slice(0, 60)}\` 가 ` +
                "이 파일 어디에도 남지 않는다 — 등록은 누적되는 것이라 사라지면 그 기능이 조용히 배선에서 빠진다. " +
                "옮기는 중이라면 같은 패치에 새 위치의 삽입(`PUT M+1@:`)을 함께 실어라(그러면 통과한다). " +
                "정말 없애야 하면 `// intent: replace` 를 실어라.",
            };
          }
        }
      }
      // `PUT N.=M:` 은 N..M 을 통째로 갈아끼우는 범위 교체다 — 가장 흔한 교체 형태라 범위의 모든 줄을 대상으로 본다.
      for (const op of patch.matchAll(/(?:^|\n)PUT (\d+)(\+\d+@?)?(?:\.?=(\d+))?\.?:\n((?:(?!PUT \d|CUT \d)[^\n]*(?:\n|$))+)/g)) {
        if (op[2]) continue; // insert form — additive, fine
        if (intendedReplace) continue; // declared intent — the replacement stands
        const rangeEnd = Number(op[3] ?? op[1]);
        if (!isTestPath) {
          const lost = lostEntries(fileLines, Number(op[1]), rangeEnd, patchAdds);
          if (lost.length > 0) {
            return {
              block: true,
              reason: `\`${path}\` ${op[1]}${rangeEnd > Number(op[1]) ? `-${rangeEnd}` : ""}행을 갈아끼우면 ` +
                `\`${lost.join(", ").slice(0, 60)}\` 가 이 파일 어디에도 남지 않는다 — 기존 항목을 모두 유지한 채 ` +
                "새 이름을 더하라(한 줄짜리 목록이면 그 줄에 이름을 덧붙이면 된다). 정말 지워야 하면 `// intent: replace` 를 실어라.",
            };
          }
        }
        const target = (fileLines[Number(op[1]) - 1] ?? "").trim();
        if (!target) continue;
        const bodyLines = op[4].split("\n").map((l) => l.replace(/^\+/, "").trim()).filter(Boolean); // 접두 있으면 벗기고, 없으면 그대로
        const retained = bodyLines.includes(target);
        if (retained) continue;
        // 보편 규칙: 형제 치환(sibling swap). 관측된 교체는 전부 "뼈대는 같고 식별자만
        // 다른" 줄로의 교체였다. 언어 무관: 식별자 마스킹 후 뼈대가 동일하고 식별자가 2군데 이상
        // 갈리면, 추가 과제에서 형제는 공존해야 한다 — 교체가 아니라 삽입으로 유도한다.
        // (값 수정 x=1->x=2, 단일 인자 교체 compute(y)->compute(z) 는 통과한다.)
        const sibling = bodyLines.find((b) => siblingSwap(target, b));
        if (sibling) {
          return {
            block: true,
            reason:
              `this edit REPLACES \`${target.slice(0, 60)}\` with its sibling \`${sibling.slice(0, 60)}\` — ` +
              "if you meant to ADD, keep the old line and use the insert form " +
              `(\`PUT ${op[1]}+1@:\`) for the new one. If you truly mean to REPLACE it, resend the same ` +
              "edit with a `// intent: replace` comment line included.",
          };
        }
      }
      return;
    }

    if (toolName === "edit") {
      // Legacy field shape: {path, old_string, new_string}
      // or {path, edits: [{old_string, new_string}]}.
      type EditPair = { old_string?: unknown; new_string?: unknown };
      const edits = event.input.edits;
      const pairs: EditPair[] = Array.isArray(edits) ? (edits as EditPair[]) : [event.input as EditPair];
      for (const pr of pairs) {
        const oldStr = String(pr.old_string ?? "");
        const newStr = String(pr.new_string ?? "");
        if (!oldStr) continue;
        // (a) Replacing an existing import line — asked to ADD an import, the
        // model swapped an existing one for its own. A replaced import is wiped
        // code; add alongside instead.
        const oldImports = meaningfulLines(oldStr).filter((l: string) => IMPORT_LINE.test(l));
        const dropped = oldImports.filter((l: string) => !newStr.includes(l));
        const addsImport = meaningfulLines(newStr).some((l: string) => IMPORT_LINE.test(l));
        if (dropped.length > 0 && addsImport) {
          return {
            block: true,
            reason:
              `this edit replaces an existing import (\`${String(dropped[0]).slice(0, 60)}\`) with a new one — ` +
              "an additive task adds its import alongside; existing imports wire modules and behavior " +
              "other code depends on. Keep the old line and add yours next to it.",
          };
        }
        // (b) Unwrapping surviving code: deleting a `do {`/`try {` wrapper line
        // while its body stays silently drops the error handling around it.
        const wrapper = (l: string) => /^(?:do|try)\s*\{$/.test(l);
        const newSetW = new Set(meaningfulLines(newStr));
        const droppedWrappers = meaningfulLines(oldStr).filter((l: string) => wrapper(l) && !newSetW.has(l));
        const retainedOthers = meaningfulLines(oldStr).filter((l: string) => !wrapper(l) && newSetW.has(l)).length;
        if (droppedWrappers.length > 0 && retainedOthers > 0) {
          return {
            block: true,
            reason:
              `this edit removes \`${String(droppedWrappers[0]).slice(0, 60)}\` while keeping the code it wraps — ` +
              "an additive task must not strip existing error-handling wrappers from surviving code.",
          };
        }
        // (c) Egregious deletion: a large block mostly vanishes.
        const oldLines = meaningfulLines(oldStr);
        if (oldLines.length >= 8) {
          const newLines = meaningfulLines(newStr);
          const newSet = new Set(newLines);
          const retained = oldLines.filter((l: string) => newSet.has(l)).length / oldLines.length;
          // A wholesale MODIFICATION keeps the block's size (every line changed,
          // e.g. a rename sweep) — that is not a deletion. Only a block that
          // actually SHRINKS below half its size counts as a wipe.
          if (retained < 0.3 && newLines.length < oldLines.length * 0.5) {
            return {
              block: true,
              reason:
                `this edit deletes ~${Math.round((1 - retained) * 100)}% of a ${oldLines.length}-line block — ` +
                "an additive task must not wipe existing code; make a narrower edit that keeps unrelated lines.",
            };
          }
        }
      }
      return;
    }

    if (toolName !== "write") return;
    // 내용 태그(`App.tsx#0D77`)가 붙어 오면 확장자 판정이 빗나가 이 가드가 조용히 통과한다.
    const path = String(event.input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
    if (!/\.(?:ts|tsx|js|mjs|swift|m|h|yml|yaml|json|plist)$/.test(path)) return;
    const abs = resolve(process.cwd(), path);
    const fileText = safeRead(abs);
    if (fileText === null) return;
    const oldLines = meaningfulLines(fileText);
    if (oldLines.length < MIN_LINES) return;
    const newSet = new Set(meaningfulLines(String(event.input.content ?? event.input.text ?? "")));
    const retained = oldLines.filter((l: string) => newSet.has(l)).length / oldLines.length;
    if (retained >= RETAIN_FLOOR) return;
    return {
      block: true,
      reason:
        `overwriting ${path} drops ~${Math.round((1 - retained) * 100)}% of its existing lines — ` +
        "the task adds code, it does not replace the file. Use the edit tool for targeted " +
        "changes, or include the existing content you mean to keep.",
    };
  });
}

/** An import in any language this project writes: TS/JS, Swift, Objective-C. */
const IMPORT_LINE = /^(?:import\s+\S|#import\s+[<"])/;

/**
 * 등록 항목을 **형태와 함께** 식별한다 — `import:MarshallBle`, `register:scan`.
 *
 * 형태를 붙이는 이유: `RCT_EXTERN_METHOD(scan…)` 을 `RCT_EXTERN_METHOD(connect…)` 로 바꾸면
 * `scan` 은 Swift 어댑터에 글자로는 여전히 있다. 형태를 무시하고 "파일 어딘가에 있나"만 보면
 * 브리지 선언 소실이 그대로 통과한다.
 */
function entryKeys(line: string): string[] {
  const t = line.trim();
  const tsImport = /^import\s+(?:type\s+)?(.+?)\s+from\s+["']([^"']+)["']/.exec(t);
  if (tsImport) {
    const names = tsImport[1]
      .replace(/[{}]/g, ",")
      .split(",")
      .map((x) => x.trim().replace(/^type\s+/, "").replace(/^\*\s+as\s+/, "").replace(/\s+as\s+\S+$/, ""))
      .filter(Boolean);
    return names.map((name) => `import:${name}`);
  }
  const sideEffect = /^import\s+["']([^"']+)["']/.exec(t);
  if (sideEffect) return [`import:${sideEffect[1]}`];
  const swift = /^import\s+([A-Za-z_][\w.]*)\s*$/.exec(t);
  if (swift) return [`import:${swift[1]}`];
  const objc = /^#import\s+[<"]([^>"]+)[>"]/.exec(t);
  if (objc) return [`import:${objc[1]}`];
  const bridge = /\bRCT_EXTERN_(?:METHOD|MODULE)\(\s*([A-Za-z_]\w*)/.exec(t);
  if (bridge) return [`register:${bridge[1]}`];
  const app = /\bAppRegistry\.registerComponent\(\s*([^,]+)/.exec(t);
  if (app) return [`register:${app[1].trim()}`];
  return [];
}

/**
 * `from`..`to` 행을 지우거나 갈아끼운 뒤, **이 파일 어디에도 남지 않는** 등록 항목.
 *
 * 판정이 "이 줄이 등록인가" 였을 때 정당한 편집 셋이 갇혔다(원 하네스 실측):
 *  - 자기가 실수로 넣은 중복 등록을 지우지 못했다 — 잃는 것이 없는데도 "그 줄은 등록이다" 로 막혔다.
 *  - 한 패치에서 옮기는 편집(여기서 CUT, 저기에 PUT)이 CUT 만 보고 막혔다.
 *  - 방금 자기가 쓴 테스트 파일의 import 를 고치다 막혔다(호출부 `isTestPath` 로 제외).
 * 남는지만 본다 — 중복 제거·이동은 손실이 아니고, 마지막 하나가 사라지는 것만 손실이다.
 */
function lostEntries(fileLines: string[], from: number, to: number, adds: string[]): string[] {
  const removed: string[] = [];
  for (let n = from; n <= to; n++) removed.push(...entryKeys(fileLines[n - 1] ?? ""));
  if (removed.length === 0) return [];
  const surviving = new Set<string>();
  fileLines.forEach((l, i) => { if (i + 1 < from || i + 1 > to) for (const k of entryKeys(l)) surviving.add(k); });
  for (const l of adds) for (const k of entryKeys(l)) surviving.add(k);
  return [...new Set(removed.filter((k) => !surviving.has(k)))].map((k) => k.split(":").slice(1).join(":"));
}

function siblingSwap(oldLine: string, newLine: string): boolean {
  if (oldLine === newLine) return false;
  const ids = (l: string) => l.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const skel = (l: string) => l.replace(/[A-Za-z_][A-Za-z0-9_]*/g, "\u0001").replace(/\s+/g, " ").trim();
  if (skel(oldLine) !== skel(newLine)) return false;
  const a = ids(oldLine), b = ids(newLine);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff >= 2;
}

// 훅은 절대 던지지 않는다 — omp 는 훅 예외를 도구 실패로 승격시켜 edit 자체를
// 죽인다(원 하네스 실측: EISDIR 크래시로 한 셀의 edit 이 전멸).
// 읽을 수 없거나 파일이 아니면 null → 검사를 조용히 통과(fail-open).
function safeRead(p: string): string | null {
  try {
    const st = statSync(p);
    if (!st.isFile()) return null;
    return readFileSync(p, "utf-8");
  } catch { return null; }
}

function meaningfulLines(content: string): string[] {
  return content.split("\n").map((l: string) => l.trim()).filter((l: string) => l !== "");
}

function countLines(path: string): number {
  try { return meaningfulLines(readFileSync(path, "utf-8")).length; } catch { return 0; }
}
