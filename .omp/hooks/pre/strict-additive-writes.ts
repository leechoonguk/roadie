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
 *
 * 사라진 항목도 **아직 참조되고 있을 때만** 손실이다. import 는 편집 뒤 같은 파일 본문이,
 * 브리지 등록(`RCT_EXTERN_*`, `registerComponent`)은 프로젝트 전체가 그 이름을 아직 쓰는가로 본다.
 * 형제 치환(`scan` → `connect`)도 같다: 사라지는 식별자를 편집 뒤 프로젝트 어디에서도 부르지 않으면
 * (`referencedInProject`) 컷오버이지 덮어쓰기가 아니다. 어디에서도 쓰지 않는 이름을 지우는 편집은
 * 막을 이유가 없다. 교체 의도 플래그(`INTENT_FLAG`)는 이 판정이 틀렸을 때의 탈출구일 뿐 **편집 플래그**다:
 * 파일에 남기면 안 되고, 남으면 check-code-layout 이 실패한다.
 *
 * 패치 문법은 `PatchOp` 로 읽는다: `PUT >N`/`PUT <N`/`PUT >$` 삽입, `PUT N.=M`/`PUT N*` 교체, `CUT` 삭제,
 * `@name` 레지스터 이동, `REM`. 같은 파서가 blescope 에도 있다 — 한쪽을 고치면 다른 쪽도 고친다.
 *
 * 프로젝트 밖(형제 프로젝트·홈 등)의 경로는 이 하네스의 일이 아니다 — 판정하지 않는다
 * (루트는 훅 파일의 위치에서 나온다, `lib/hook-project-root.ts`).
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { recordedBlocks } from "../lib/hook-metrics.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { commandRunsOutsideProject, eventWithCwd, isInsideProject, projectRoot, toolPath, WALK_EXCLUDES } from "../lib/hook-project-root.ts";

const MIN_LINES = 12;        // files smaller than this are cheap to rewrite honestly
const RETAIN_FLOOR = 0.5;    // block when less than half of the existing lines survive
/** 브리지 등록 이름이 쓰일 수 있는 소스 — 프로젝트 전체 참조 검색의 범위. */
const REFERENCE_SOURCES = /\.(?:ts|tsx|js|jsx|mjs|swift|m|mm|h|kt|java)$/;
const REFERENCE_MAX_BYTES = 1024 * 1024;

/**
 * The replace-intent flag: an escape hatch on one edit, never content. Spelled in pieces so this file
 * (and every message built from it) carries no literal of its own — `check-code-layout` fails on a
 * file that does, and the flag in a block message is the one place an agent would copy it from.
 */
const INTENT_FLAG = ["//", "intent:", "replace"].join(" ");
const INTENT_FLAG_NOTE =
  `\`${INTENT_FLAG}\` line in the edit — it is an edit flag, not file content: remove it again in a second edit ` +
  "(check-code-layout fails the gate while it stays in any file).";

/** One operation of an edit patch: the lines it touches in the file as it is now, and the lines it brings. */
interface PatchOp {
  kind: "put" | "cut";
  insert: boolean;
  from: number;
  to: number;
  body: string[];
  /** The register a `CUT N @name` captures into. */
  register: string | null;
  /** The register a `PUT … @name` pastes from. */
  paste: string | null;
}

/**
 * The patch grammar's headers: `PUT >N:` / `PUT <N:` insert, `PUT N.=M:` and `PUT N*:` replace, `CUT N.=M`
 * and `CUT N*` delete, `@name` registers move, and the older `PUT N:` / `PUT N+k@:` spellings the first
 * two forms replaced.
 */
const INSERT_HEADER = /^PUT\s+[<>](?:\d+|\$)\*?(?::|\s+@(\w+))\s*$/;
const LEGACY_INSERT_HEADER = /^PUT\s+(\d+)\+\d+@?:\s*$/;
const REPLACE_HEADER = /^PUT\s+(\d+)(?:\.?=(\d+)|\*|\.)?(?::|\s+@(\w+))\s*$/;
const CUT_HEADER = /^CUT\s+(\d+)(?:\.?=(\d+)|\*)?(?:\s+@(\w+))?\s*$/;
/** Lines that end a PUT body without being an operation: the next file section, a move, a delete. */
const SECTION_BOUNDARY = /^(?:\[[^\]\n#]+#[0-9A-Fa-f]{4}\]|MV\s|REM\s*$)/;

export default function strictAdditiveWrites(pi: ExtensionAPI): void {
  // ctx-ok: the session cwd only locates a relative path (eventWithCwd reads it inside a try) — it is never a root.
  pi.on("tool_call", recordedBlocks("strict-additive-writes", (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => {
    const toolName = String(event.toolName ?? "");
    const where = eventWithCwd(event, ctx);

    if (toolName === "bash" || toolName === "eval") {
      if (commandRunsOutsideProject(event.input, where)) return;
      const body = String(event.input.command ?? event.input.code ?? "");
      const m = body.match(/(?<![>\d&])>\s*([\w@./-]+\.(?:ts|tsx|js|mjs|swift|m|h|md|yml|yaml|json|plist))\b/);
      if (!m) return;
      const abs = toolPath(m[1], where);
      if (!isInsideProject(abs)) return;
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
      // omp patch form, measured: {path, input: "[rel#TAG]\nPUT 12.=12:\n+line..."}.
      // The replace-instead-of-add habit (a sibling import swapped for the new one) arrives as a
      // replace-form PUT on the import line. Destruction is blocked, not advised.
      const patch = event.input.input;
      // 경로는 세 곳에 있을 수 있다: `path`(깨끗), `path`+내용 태그(`App.tsx#0D77`), 또는 패치 본문의
      // `[상대경로#TAG]` 헤더. 원 하네스 전수 점검: 편집 2,923건 중 2,230건은 `path` 자체가 없고
      // 440건은 태그가 붙어 있었다 — 둘 다 fail-open 으로 빠져서 이 가드는 **91% 무동작**이었다.
      const header = /^\s*\[([^\]\n#]+)/.exec(patch);
      const rawPath = String(event.input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "") || (header?.[1] ?? "");
      const path = rawPath;
      const abs = toolPath(path, where);
      if (!isInsideProject(abs)) return; // 형제 프로젝트의 파일 — 그쪽 하네스의 일이다
      const fileText = safeRead(abs);
      if (fileText === null) return; // 빈 path→cwd(디렉터리) 등 — EISDIR 클래스 fail-open
      const fileLines = fileText.split("\n");
      // 이 패치가 **더하는** 줄 전부(op 를 가리지 않고 모은다). 한 패치 안에서 옮기는 편집
      // (여기서 지우고 저기에 다시 넣기, 레지스터로 잘라 붙이기)은 손실이 아니다 — 항목 생존 판정에 함께 넣는다.
      const ops = parsePatchOps(patch);
      const pasted = new Set(ops.flatMap((op) => (op.paste === null ? [] : [op.paste])));
      const patchAdds = [
        ...ops.flatMap((op) => op.body),
        ...ops
          .filter((op) => op.kind === "cut" && op.register !== null && pasted.has(op.register))
          .flatMap((op) => fileLines.slice(op.from - 1, op.to).map((line) => line.trim()).filter(Boolean)),
      ];
      // 등록 보호는 **조용히 사라지는 곳** 에만 건다. 테스트 파일에서 import 가 없어지면 jest 가
      // 즉시 터지고 게이트가 초 단위로 잡는다 — 거기서까지 막으면 자기 파일을 고치는 정당한 편집이
      // 갇힌다(원 하네스 실측: 방금 자기가 쓴 테스트의 import 를 고치다 2회 연속 차단).
      const isTestPath = /(^|\/)__tests__\//.test(path) || /\.(spec|test)\.[jt]sx?$/.test(path);
      // 의도 프로토콜: 차단은 "실수 교체"만 걸러내는 장치다. 지운 이름이 프로젝트 어디에도 더는
      // 참조되지 않으면(컷오버가 한 패치에서 전부 지웠거나 원래 다른 곳에 없었다) 플래그 없이 통과한다.
      // 그래도 막히는 정당한 편집만 INTENT_FLAG 를 싣는다 — 그것은 편집 플래그라 파일에 남으면 안 된다.
      const intendedReplace = /(?:#|\/\/|<!--)\s*intent:\s*replace/i.test(patch);
      // 본문 줄의 `+` 접두는 **선택**이다 — 접두 없는 형식(`PUT 233:\n import …`)으로 등록 줄이
      // 교체됐는데 파서가 통째로 놓친 회귀가 있었다.
      // 삭제형(`CUT N`, `CUT N.=M`)은 등록 줄을 지우는 가장 직접적인 형태다 — 지운 줄이 등록·import 면 막는다.
      if (!intendedReplace && !isTestPath) {
        for (const cut of ops.filter((candidate) => candidate.kind === "cut")) {
          const lost = lostEntries(fileLines, cut.from, cut.to, patchAdds, abs);
          if (lost.length > 0) {
            return {
              block: true,
              reason: `\`${path}\` ${cut.from}${cut.to > cut.from ? `-${cut.to}` : ""}행을 지우면 \`${lost.join(", ").slice(0, 60)}\` 가 ` +
                "이 파일 어디에도 남지 않는데 아직 참조된다 — 등록은 누적되는 것이라 사라지면 그 기능이 조용히 배선에서 빠진다. " +
                "컷오버라면 참조(호출부·구현)를 먼저 없애고 등록을 마지막에 지워라(참조가 없으면 통과한다). " +
                "옮기는 중이라면 같은 패치에 새 위치의 삽입(`PUT >M:`, 또는 `CUT N @name` + `PUT >M @name`)을 함께 실어라(그러면 통과한다). " +
                `정말 없애야 하면 ${INTENT_FLAG_NOTE}`,
            };
          }
        }
      }
      const removedRows = removedRowSet(ops);
      const referencedAfter = (names: string[]): boolean =>
        referencedInProject(names, abs, fileLines.filter((_, i) => !removedRows.has(i + 1)).concat(patchAdds).join("\n"));
      // `PUT N.=M:` / `PUT N*:` replace N..M (a block is judged by its opener) — the commonest replace form, so every line of the range is judged.
      for (const op of ops.filter((candidate) => candidate.kind === "put" && !candidate.insert)) {
        if (intendedReplace) continue; // declared intent — the replacement stands
        if (!isTestPath) {
          const lost = lostEntries(fileLines, op.from, op.to, patchAdds, abs);
          if (lost.length > 0) {
            return {
              block: true,
              reason: `\`${path}\` ${op.from}${op.to > op.from ? `-${op.to}` : ""}행을 갈아끼우면 ` +
                `\`${lost.join(", ").slice(0, 60)}\` 가 이 파일 어디에도 남지 않는데 아직 참조된다 — 기존 항목을 모두 유지한 채 ` +
                "새 이름을 더하라(한 줄짜리 목록이면 그 줄에 이름을 덧붙이면 된다). 컷오버라면 참조를 먼저 없애라(참조가 없으면 통과한다). " +
                `정말 지워야 하면 ${INTENT_FLAG_NOTE}`,
            };
          }
        }
        const target = (fileLines[op.from - 1] ?? "").trim();
        if (!target) continue;
        // 등록 줄의 교체는 위의 항목 생존·참조 판정이 이미 끝냈다 — 같은 줄을 형제 치환으로 다시 막지 않는다.
        if (entryKeys(target).length > 0) continue;
        const bodyLines = op.body;
        const retained = bodyLines.includes(target);
        if (retained) continue;
        // 보편 규칙: 형제 치환(sibling swap). 관측된 교체는 전부 "뼈대는 같고 식별자만
        // 다른" 줄로의 교체였다. 언어 무관: 식별자 마스킹 후 뼈대가 동일하고 식별자가 2군데 이상
        // 갈리면, 추가 과제에서 형제는 공존해야 한다 — 교체가 아니라 삽입으로 유도한다.
        // (값 수정 x=1->x=2, 단일 인자 교체 compute(y)->compute(z) 는 통과한다.)
        // 사라지는 이름을 편집 뒤 프로젝트 어디에서도 부르지 않으면 컷오버다 — 막지 않는다.
        const sibling = bodyLines.find((b) => siblingSwap(target, b));
        if (sibling && referencedAfter(replacedIdentifiers(target, sibling))) {
          return {
            block: true,
            reason:
              `this edit REPLACES \`${target.slice(0, 60)}\` with its sibling \`${sibling.slice(0, 60)}\`, ` +
              `and one of ${replacedIdentifiers(target, sibling).join(", ").slice(0, 60)} is still referenced elsewhere in the project — ` +
              "if you meant to ADD, keep the old line and use the insert form " +
              `(\`PUT >${op.from}:\`) for the new one. If you truly mean to REPLACE it, resend the same ` +
              `edit with a ${INTENT_FLAG_NOTE}`,
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
      const legacyPath = String(event.input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
      if (legacyPath !== "" && !isInsideProject(toolPath(legacyPath, where))) return;
      for (const pr of pairs) {
        const oldStr = String(pr.old_string ?? "");
        const newStr = String(pr.new_string ?? "");
        if (!oldStr) continue;
        // (a) Replacing an existing import line — asked to ADD an import, the
        // model swapped an existing one for its own. A replaced import is wiped
        // code; add alongside instead. An import whose name nothing in the file
        // uses after the edit is a cutover, not a wipe.
        const oldImports = meaningfulLines(oldStr).filter((l: string) => IMPORT_LINE.test(l));
        const current = legacyPath === "" ? null : safeRead(toolPath(legacyPath, where));
        const afterEdit = current === null ? newStr : current.replace(oldStr, newStr);
        const dropped = oldImports.filter((l: string) => !newStr.includes(l) && stillUsed(l, afterEdit));
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
    const abs = toolPath(path, where);
    if (!isInsideProject(abs)) return;
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
  }));
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
 * `from`..`to` 행을 지우거나 갈아끼운 뒤, **이 파일 어디에도 남지 않고 아직 참조되는** 등록 항목.
 *
 * 판정이 "이 줄이 등록인가" 였을 때 정당한 편집 셋이 갇혔다(원 하네스 실측):
 *  - 자기가 실수로 넣은 중복 등록을 지우지 못했다 — 잃는 것이 없는데도 "그 줄은 등록이다" 로 막혔다.
 *  - 한 패치에서 옮기는 편집(여기서 CUT, 저기에 PUT)이 CUT 만 보고 막혔다.
 *  - 방금 자기가 쓴 테스트 파일의 import 를 고치다 막혔다(호출부 `isTestPath` 로 제외).
 *  - 컷오버가 참조를 다 없앤 뒤 마지막 등록 줄을 지우려는데 "사라진다" 로 막혀 마커가 필요했고,
 *    그 마커가 파일에 남아 출하됐다(23시간). 참조가 없는 이름의 소실은 손실이 아니다.
 * 남는지, 그리고 아직 쓰이는지만 본다 — 중복 제거·이동·컷오버는 손실이 아니고,
 * 마지막 하나가 사라지는데 누가 아직 부르는 것만 손실이다.
 */
function lostEntries(fileLines: string[], from: number, to: number, adds: string[], editedAbs: string): string[] {
  const removed: string[] = [];
  for (let n = from; n <= to; n++) removed.push(...entryKeys(fileLines[n - 1] ?? ""));
  if (removed.length === 0) return [];
  const surviving = new Set<string>();
  const restLines = fileLines.filter((_, i) => i + 1 < from || i + 1 > to);
  restLines.forEach((l) => { for (const k of entryKeys(l)) surviving.add(k); });
  for (const l of adds) for (const k of entryKeys(l)) surviving.add(k);
  const rest = [...restLines, ...adds].join("\n");
  return [...new Set(removed.filter((k) => !surviving.has(k)))]
    .filter((k) => isReferenced(k, rest, editedAbs))
    .map((k) => k.split(":").slice(1).join(":"));
}

/** The identifier an entry's name is used by: `./x/Foo.ts` → `Foo`, `<React/RCTBridge.h>` → `RCTBridge`. */
function referenceToken(name: string): string {
  const base = name.replace(/^['"]|['"]$/g, "").split("/").pop() ?? name;
  return base.replace(/\.[A-Za-z]+$/, "");
}

/**
 * Does anything still use the entry's name after the edit? An import is used by the
 * rest of its own file; a bridge registration by any source in the project — the JS
 * that calls the method, the Swift that implements it.
 */
function isReferenced(key: string, restOfFile: string, editedAbs = ""): boolean {
  const kind = key.split(":")[0];
  const token = referenceToken(key.split(":").slice(1).join(":"));
  if (token === "") return true;
  const pattern = new RegExp(`(?<![\\w$])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`);
  if (pattern.test(restOfFile)) return true;
  return kind === "register" && projectUses(pattern, editedAbs);
}

/** An import line's names, tested against the file as it reads after the edit. */
function stillUsed(importLine: string, afterEdit: string): boolean {
  const keys = entryKeys(importLine);
  if (keys.length === 0) return true;
  const body = afterEdit.split("\n").filter((l: string) => !IMPORT_LINE.test(l.trim())).join("\n");
  return keys.some((k) => isReferenced(k, body));
}

/** Where a name can still be used: the app sources and the harness's own TypeScript. */
const SOURCE_ROOTS = ["app", ".omp"];

/** Fail-open walk: an unreadable tree answers "unused", never throws (a hook crash kills the edit). */
function projectUses(pattern: RegExp, skip: string): boolean {
  return SOURCE_ROOTS.some((root) => walkUses(join(projectRoot, root), pattern, skip));
}

function walkUses(dir: string, pattern: RegExp, skip: string): boolean {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (WALK_EXCLUDES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walkUses(full, pattern, skip)) return true;
      } else if (full !== skip && REFERENCE_SOURCES.test(entry.name) && statSync(full).size <= REFERENCE_MAX_BYTES && pattern.test(readFileSync(full, "utf-8"))) {
        return true;
      }
    }
  } catch { /* unreadable directory — nothing there to reference */ }
  return false;
}

/** 형제 치환에서 **사라지는** 식별자 — 같은 자리에서 다른 이름으로 바뀐 쪽의 옛 이름. */
function replacedIdentifiers(oldLine: string, newLine: string): string[] {
  const ids = (l: string) => l.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const b = ids(newLine);
  return ids(oldLine).filter((name, i) => name !== b[i]);
}

/**
 * 편집 **뒤에도** 이 이름들 중 하나가 프로젝트의 소스에서 쓰이는가. 편집한 파일은 편집이 반영된
 * 본문(`editedAfter`)으로, 나머지 파일은 디스크 그대로 읽는다. 훅은 던지지 않는다.
 */
function referencedInProject(names: string[], editedAbs: string, editedAfter: string): boolean {
  if (names.length === 0) return false;
  const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
  const pattern = new RegExp(names.map((name) => `(?<![\\w$])${escape(name)}(?![\\w$])`).join("|"));
  return pattern.test(editedAfter) || projectUses(pattern, editedAbs);
}

/** 패치가 지우거나 갈아끼우는 1-based 행 번호 전부(삽입형은 행을 지우지 않는다). */
function removedRowSet(ops: PatchOp[]): Set<number> {
  const rows = new Set<number>();
  for (const op of ops) {
    if (op.insert) continue;
    for (let n = op.from; n <= op.to; n++) rows.add(n);
  }
  return rows;
}

/** An edit patch as operations. A body line's `+` prefix is optional; blank lines carry nothing. */
function parsePatchOps(patch: string): PatchOp[] {
  const ops: PatchOp[] = [];
  let open: PatchOp | null = null;
  for (const line of patch.split("\n")) {
    const op = parseOpHeader(line);
    if (op !== null) {
      ops.push(op);
      open = op.kind === "put" ? op : null;
      continue;
    }
    if (SECTION_BOUNDARY.test(line)) {
      open = null;
      continue;
    }
    const text = line.replace(/^\+/, "").trim();
    if (open !== null && text !== "") open.body.push(text);
  }
  return ops;
}

function parseOpHeader(line: string): PatchOp | null {
  const insert = INSERT_HEADER.exec(line);
  if (insert !== null) return { kind: "put", insert: true, from: 0, to: 0, body: [], register: null, paste: insert[1] ?? null };
  const legacyInsert = LEGACY_INSERT_HEADER.exec(line);
  if (legacyInsert !== null) return { kind: "put", insert: true, from: Number(legacyInsert[1]), to: Number(legacyInsert[1]), body: [], register: null, paste: null };
  const replace = REPLACE_HEADER.exec(line);
  if (replace !== null) {
    return { kind: "put", insert: false, from: Number(replace[1]), to: Number(replace[2] ?? replace[1]), body: [], register: null, paste: replace[3] ?? null };
  }
  const cut = CUT_HEADER.exec(line);
  if (cut !== null) return { kind: "cut", insert: false, from: Number(cut[1]), to: Number(cut[2] ?? cut[1]), body: [], register: cut[3] ?? null, paste: null };
  return null;
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
