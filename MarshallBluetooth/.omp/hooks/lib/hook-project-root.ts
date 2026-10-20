/**
 * Project root + 트리 순회 제외 — 훅들이 각자 들고 있던 공통 사실.
 *
 * 실측(전수 확인): projectRoot 파생식이 35개 훅에 복제돼 있었고, 순회 제외
 * 목록은 두 곳이 서로 다르게 들고 있었다. 정책이 아니라 사실인 값은 한 곳에만 둔다.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";

/** 훅은 프로젝트 루트 또는 .omp/ 안에서 실행된다 — app/macos 의 존재가 루트의 증거다. */
export function resolveProjectRoot(): string {
  const cwd = process.cwd();
  return existsSync(join(cwd, "app", "macos")) ? cwd : join(cwd, "..");
}

/** 소스 트리 순회에서 건너뛰는 디렉터리 — 우리가 소유하지 않거나 생성물이다(npm·CocoaPods·Xcode·jest). */
export const WALK_EXCLUDES = new Set(["node_modules", "Pods", "build", "DerivedData", "coverage", "vendor", "xcuserdata"]);
