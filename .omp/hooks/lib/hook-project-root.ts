/**
 * Project root + 트리 순회 제외 — 훅들이 각자 들고 있던 공통 사실.
 *
 * 실측(전수 확인): projectRoot 파생식이 35개 훅에 복제돼 있었고, 순회 제외
 * 목록은 두 곳이 서로 다르게 들고 있었다. 정책이 아니라 사실인 값은 한 곳에만 둔다.
 *
 * 루트는 **훅 파일의 위치**에서 나온다 — 세션의 cwd 가 아니다. 같은 워크스페이스의 형제
 * 프로젝트(juice, blescope)에서 연 세션도 이 프로젝트의 훅을 싣는데, cwd 에서 루트를 구하면
 * 그 훅이 형제 프로젝트의 파일을 이 프로젝트의 정책으로 판정해 쓰기를 막는다(실측: 이틀간
 * 약 40건의 차단, `.staged` + `mv` 우회). 훅은 `<root>/.omp/hooks/lib/` 에 있으므로 세 단계 위가
 * 루트다 — 확장(`.omp/extensions/<name>/`)도 같은 깊이다.
 *
 * 비교는 양쪽 모두 `canonical()` 을 거친다: macOS 의 `/tmp` → `/private/tmp`, 심볼릭 링크로 연
 * 체크아웃이 문자열 비교에서 "밖"으로 보이지 않도록. 같은 이름·같은 시그니처의 파일이 네 프로젝트
 * (ficus, Roadie, Juice, blescope)에 있다 — 한 곳을 고치면 나머지도 같이 고친다(omp-hooks.md, Project root).
 */

// @ts-expect-error — Node builtin, not project-compiled
import { realpathSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
// @ts-expect-error — Node builtin, not project-compiled
import { fileURLToPath } from "node:url";

/**
 * 존재하는 경로는 realpath, 없는 경로는 가장 가까운 기존 조상의 realpath 에 나머지를 붙인 것.
 * 아직 만들어지지 않은 파일을 쓰려는 도구 호출도 같은 기준으로 비교된다.
 */
export function canonical(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(canonical(parent), basename(abs));
  }
}

/** 이 훅 묶음이 속한 프로젝트의 루트(realpath). `process.cwd()` 를 읽지 않는다. */
export const projectRoot: string = canonical(fileURLToPath(new URL("../../..", import.meta.url)));

/** 절대 경로가 이 프로젝트 안(루트 자신 포함)인가. 상대 경로는 호출자가 먼저 `toolPath` 로 푼다. */
export function isInsideProject(absPath: string): boolean {
  const rel: string = relative(projectRoot, canonical(absPath));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * 도구 호출이 말한 경로의 절대형. 상대 경로는 이벤트가 cwd 를 싣고 있으면 그것을 기준으로,
 * 없으면 프로젝트 루트를 기준으로 푼다 — 세션 cwd 는 이 훅 묶음의 프로젝트와 무관할 수 있다.
 */
export function toolPath(path: string, event: unknown): string {
  const cwd = (event as { cwd?: unknown } | null | undefined)?.cwd;
  const base = typeof cwd === "string" && isAbsolute(cwd) ? cwd : projectRoot;
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

/**
 * 이벤트에 cwd 가 없으면 핸들러의 컨텍스트가 싣고 있는 cwd 를 이벤트 사본에 얹는다 — `toolPath` 와
 * `commandRunsOutsideProject` 가 쓰는 "도구가 실제로 도는 곳"이다. 읽기가 던져도 판정은 계속된다.
 * 컨텍스트의 cwd 를 읽는 곳은 이 파일뿐이고, 루트의 근거로 쓰이지 않는다.
 */
export function eventWithCwd(event: unknown, ctx: unknown): unknown {
  try {
    const own = (event as { cwd?: unknown } | null | undefined)?.cwd;
    const cwd = typeof own === "string" && own !== "" ? own : (ctx as { cwd?: unknown } | null | undefined)?.cwd;
    return { ...(event as object), cwd };
  } catch {
    return event;
  }
}

/**
 * 셸 도구가 명령을 **어디서** 돌리는지 — 호출이 밝힌 `input.cwd`, 없으면 `source`(이벤트 또는 확장
 * 컨텍스트)가 싣고 있는 cwd — 그곳이 이 프로젝트 밖이면 true. 그 명령은 형제 프로젝트의 일이라
 * 이 프로젝트의 명령 정책이 판정하지 않는다. 어디서 도는지 알 수 없으면 false(판정한다).
 * 여기서의 cwd 는 "명령의 위치"일 뿐 루트의 근거가 아니다 — 루트는 항상 `projectRoot`.
 */
export function commandRunsOutsideProject(input: Record<string, unknown> | undefined, source: unknown): boolean {
  const sourceCwd = (source as { cwd?: unknown } | null | undefined)?.cwd;
  const where = typeof input?.cwd === "string" && input.cwd !== "" ? input.cwd : sourceCwd;
  return typeof where === "string" && where !== "" && !isInsideProject(toolPath(where, source));
}

/** 소스 트리 순회에서 건너뛰는 디렉터리 — 우리가 소유하지 않거나 생성물이다(npm·CocoaPods·Xcode·jest). */
export const WALK_EXCLUDES = new Set(["node_modules", "Pods", "build", "DerivedData", "coverage", "vendor", "xcuserdata"]);
