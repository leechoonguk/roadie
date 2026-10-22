/**
 * Duplicated block runs — 파일 안에 같은 줄 묶음이 두 벌.
 *
 * 실측(원 하네스): 앵커 편집 실패 → stale 전체 재작성 → 부분 편집이
 * 겹치며 섹션 묶음이 두 벌 들어갔고, 도메인 검사의 순번 캐스케이드는 "번호를 고쳐라"로
 * 읽혀 재번호 루프를 유발했다. 이 실패 모드는 특정 형식이 아니라 모든 코드 파일에서
 * 가능하다 — 그래서 탐지는 공통 계층이다: 연속 W줄 이상이 파일 안에 그대로 다시
 * 나타나면(서로 겹치지 않게) 중복 블록으로 본다. 반복 데이터가 아닌 실질 중복만 잡도록
 * 창 안에 서로 다른 비공백 줄이 MIN_UNIQUE 개 이상일 때만 발화한다.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join, extname } from "node:path";
import { WALK_EXCLUDES } from "./hook-project-root.ts";

const WINDOW = 24;      // 연속 동일 줄 최소 길이 — 정상 코드의 실측 최대 반복(대칭 블록 17줄, 원 하네스 전수 스캔) 위로 잡는다
const MIN_UNIQUE = 8;   // 창 안 서로 다른 비공백 줄 최소 개수(단순 반복 데이터 배제)
const MAX_BYTES = 512 * 1024;

/** 데이터 파일은 구조 반복이 정상이라 보지 않는다(Xcode 프로젝트·plist 포함 — 생성 형식이다). */
const SKIP_EXT = new Set([".json", ".lock", ".svg", ".csv", ".map", ".png", ".jpg", ".ico", ".plist", ".entitlements", ".pbxproj", ".xcscheme", ".xcworkspacedata", ".storyboard", ".xib"]);

export type DuplicateRun = { firstStart: number; firstEnd: number; secondStart: number; secondEnd: number; lines: number };

/** 파일 본문에서 첫 중복 런을 찾는다(1-기준 줄 번호). 없으면 null. */
export function findDuplicateRun(text: string): DuplicateRun | null {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  const n = lines.length;
  if (n < WINDOW * 2) return null;
  const firstAt = new Map<string, number>();
  for (let i = 0; i + WINDOW <= n; i++) {
    const win = lines.slice(i, i + WINDOW);
    const unique = new Set(win.filter((l) => l.trim() !== ""));
    if (unique.size < MIN_UNIQUE) continue;
    const key = win.join("\n");
    const prev = firstAt.get(key);
    if (prev === undefined) { firstAt.set(key, i); continue; }
    if (i < prev + WINDOW) continue; // 겹치는 자기 반복은 중복 블록이 아니다
    // 앞뒤로 최대 확장
    let a = prev, b = i;
    while (a > 0 && b > prev + WINDOW && lines[a - 1] === lines[b - 1]) { a--; b--; }
    let len = WINDOW;
    while (b + len < n && a + len < b && lines[a + len] === lines[b + len]) len++;
    return { firstStart: a + 1, firstEnd: a + len, secondStart: b + 1, secondEnd: b + len, lines: len };
  }
  return null;
}

/** 훅·make 타깃이 같은 판정을 쓰도록 한 곳에 둔다. */
export function checkFileForDuplicates(absPath: string, displayPath: string): string[] {
  if (SKIP_EXT.has(extname(absPath))) return [];
  let stat; try { stat = statSync(absPath); } catch { return []; }
  if (!stat.isFile() || stat.size > MAX_BYTES) return [];
  let text; try { text = readFileSync(absPath, "utf-8"); } catch { return []; }
  if (text.includes("\u0000")) return [];
  const run = findDuplicateRun(text);
  if (run === null) return [];
  return [
    `${displayPath}: lines ${run.secondStart}-${run.secondEnd} repeat lines ` +
      `${run.firstStart}-${run.firstEnd} (${run.lines} identical consecutive lines) — ` +
      "the file contains a duplicated block, typically a stale full rewrite followed by " +
      "partial edits. Read the file and DELETE one copy; do not renumber or patch around it",
  ];
}

/** 직접 실행(make check-app-duplicate-blocks): 소스 트리를 훑는다 — JS/TS 앱과 플랫폼 트리, Swift 네이티브·위젯, 모바일 셸. */
const SCAN_DIRS = [
  "app/src",
  "app/__tests__",
  "app/desktop/src",
  "app/mobile/src",
  "app/macos/Shared",
  "app/macos/MarshallBluetooth-macOS",
  "app/macos/MarshallWidget",
  "app/ios/MarshallBluetooth",
  "app/android/app/src/main/java",
];
const SCAN_FILES = ["app/App.tsx", "app/index.js", "app/metro.config.js", "app/desktop/build.ts"];

export function scanTree(projectRoot: string): string[] {
  const issues: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      if (WALK_EXCLUDES.has(entry) || entry.startsWith(".")) continue;
      const abs = join(dir, entry);
      const relPath = rel === "" ? entry : `${rel}/${entry}`;
      if (statSync(abs).isDirectory()) walk(abs, relPath);
      else issues.push(...checkFileForDuplicates(abs, relPath));
    }
  };
  for (const d of SCAN_DIRS) {
    const abs = join(projectRoot, d);
    if (existsSync(abs)) walk(abs, d);
  }
  for (const f of SCAN_FILES) {
    issues.push(...checkFileForDuplicates(join(projectRoot, f), f));
  }
  return issues;
}
