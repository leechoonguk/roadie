/**
 * The files a tool call is about to touch.
 *
 * Pre hooks that guard *where* code may be written all asked the same question
 * and all asked it wrongly: they read `input.path`, which only the `write` tool
 * carries. The `edit` tool names its files in `[path#TAG]` section headers
 * inside the patch body, so every guard keyed on `input.path` let `edit`
 * through. Measured in the harness this was ported from: an immutable file was
 * rewritten with `edit` and its guard never saw it; the same bypass existed for
 * the structure and tooling guards.
 *
 * One module answers it now, so a fourth guard cannot get it wrong again
 * (omp-hooks.md: one policy decision source).
 */

/** `[app/App.tsx#A1B2]` — an edit patch's section header. */
const SECTION_HEADER = /^\[([^\]#\n]+)#[0-9a-fA-F]{4}\]/gm;

/** `MV dest/path.ts` — an edit patch's move target, quoted when it has spaces. */
const MOVE_TARGET = /^MV\s+(?:"([^"]+)"|(\S+))\s*$/gm;

/**
 * Every path the call would write to. Empty for tools that write no file, so a
 * caller can `return` on an empty result instead of special-casing tool names.
 */
export function writtenPaths(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === "write") {
    // 내용 태그(`main.py#0D77`)가 붙어 오면 확장자·경로 판정이 전부 빗나간다 — 여기서 벗긴다
    // (측정: additive 가드가 태그 때문에 write 분기 무동작이었던 사례).
    const path = String(input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
    return path === "" ? [] : [path];
  }
  // pi-hashline-edit-pro: 플러그인 편집 툴은 전부 평문 input.path 를 싣는다.
  // 이 분기가 없으면 replace/insert 편집이 모든 pre 가드(구조·tooling·additive)를 우회한다 — 실측.
  // 플러그인은 omp 전역 링크라 모든 프로젝트 세션에 같은 툴이 실린다.
  if (toolName === "replace" || toolName === "insert" || toolName === "undo_last_change") {
    const path = String(input.path ?? "");
    return path === "" ? [] : [path];
  }
  if (toolName !== "edit") return [];

  // edit 는 경로를 두 곳에 실을 수 있다: `input.path`(있을 수도, 태그가 붙을 수도) 와 패치
  // 본문의 `[path#TAG]` 섹션 헤더들. 실측 분포(원 하네스 전수 점검, 편집 2,923건): 2,230건은
  // path 없음(헤더만), 440건은 태그 붙은 path. 헤더만 읽으면 path 만 실은 편집이 통째로 샌다.
  const own = String(input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
  const patch = String(input.input ?? "");
  const sections = [...patch.matchAll(SECTION_HEADER)].map((match: string[]) => match[1]);
  const moves = [...patch.matchAll(MOVE_TARGET)].map((match: string[]) => match[1] ?? match[2]);
  return [...new Set([own, ...sections, ...moves])].filter((path: string) => path !== "");
}
