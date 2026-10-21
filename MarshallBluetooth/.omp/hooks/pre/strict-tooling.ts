import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Strict-Tooling Pre Hook
 *
 * Enforces the tooling language policy (tooling.md) at write time — `write`
 * only. A misplaced file must never land; but a file that already exists at a
 * bad path is fix-forward work, and blocking its `edit` strands it there with
 * nothing but the post check to nag about it. The one `edit` form that DOES
 * land a file somewhere new is `MV` (a patch move target), so that is checked
 * too. The policy itself:
 *
 *   - The app is TypeScript (`app/`) and its native side is Swift with thin
 *     Objective-C bridge files (`app/macos/`, and the iOS app's `app/ios/`).
 *     Swift or Objective-C anywhere else is native code outside the projects
 *     the Xcode targets and `make swift-check` compile.
 *   - No Python, Ruby or shell scripts at all. Automation belongs in
 *     `.omp/hooks/` as TypeScript, runnable by a make target on every machine
 *     that has node. The CocoaPods `Podfile` and Bundler `Gemfile` are
 *     manifests, not scripts, and carry no extension.
 *   - `.omp/hooks/` and `.omp/extensions/` hold TypeScript only, so every hook
 *     and lib is read, imported and type-checked the same way.
 *   - Ad-hoc script directories (`scripts/`, `tools/`, `bin/`, `utils/` at the
 *     project root) are blocked: tooling that is not under `.omp/hooks/` is not
 *     discovered by `check-omp-hooks` and not registered in the Makefile.
 *
 * To add/remove locations: edit the allowlists below. No other logic changes.
 */
const SCRIPT_ROOTS = [".omp/hooks/", ".omp/extensions/", "app/"];
const NATIVE_ROOTS = ["app/macos/", "app/ios/"];
const FORBIDDEN_SCRIPTS = /\.(py|rb|sh|bash|zsh)$/;
const NATIVE_SOURCES = /\.(swift|m|mm|h)$/;
const ADHOC_SCRIPT_DIRS = /^(?:scripts|tools|bin|utils)\//;

const projectRoot = `${process.cwd()}/`;

export default function strictTooling(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: { toolName: string; input: Record<string, unknown> }, _ctx: unknown) => {
    // 중복 경로 오타를 먼저 짚는다. 원 하네스 전수 점검: 차단 9건 중 6건이 `x/x/...` 형태였는데,
    // 안내는 "스크립트 금지 — TypeScript 로 옮기라"였다. 모델은 앱 코드를 다른 언어로 다시 쓰라는
    // 말로 읽고 같은 경로를 재시도했다.
    {
      const p0 = String(event.input?.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
      const dup = /(^|\/)(app|macos|MarshallBluetooth)\/\2\//.exec(p0);
      if (dup) {
        return {
          block: true,
          reason: `\`${p0}\` — 경로에 \`${dup[2]}\` 가 두 번 들어갔다. 프로젝트 루트(MarshallBluetooth/) 기준 경로로 다시 쓰세요.`,
        };
      }
    }
    // 이 정책은 **파일이 어디에 생기는가**에 관한 것이라 `write` 에만 건다. 이미 잘못된 자리에
    // 있는 파일을 고치는 `edit` 은 앞으로 나아가는 작업이다 — 막으면 파일은 그 자리에 그대로
    // 남고 사후 검사가 잔소리만 하는 상태가 된다. 예외는 edit 패치의 MV: 이동은 새 경로에
    // 파일을 내려놓는 행위라 write 와 같은 규칙을 본다.
    if (event.toolName === "edit") {
      const patch = String(event.input?.input ?? "");
      for (const mv of patch.matchAll(/^MV\s+(?:"([^"]+)"|(\S+))\s*$/gm)) {
        const blockedMove = toolingViolation(normalize(mv[1] ?? mv[2] ?? ""));
        if (blockedMove !== null) return blockedMove;
      }
      return;
    }
    if (event.toolName !== "write") return;

    // 앵커드 편집이 붙이는 내용 태그(`App.tsx#0D77`)를 먼저 벗긴다 — 태그가 남으면 확장자
    // 판정이 전부 빗나가 정책이 조용히 통과된다.
    const path = normalize(String(event.input?.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, ""));
    if (path === "") return;
    return toolingViolation(path) ?? undefined;
  });
}

/** 한 경로에 대한 tooling 정책 판정 — write 와 edit 의 MV 대상이 같은 규칙을 본다. */
function toolingViolation(path: string): { block: true; reason: string } | null {
  if (path === "") return null;

  if (FORBIDDEN_SCRIPTS.test(path)) {
    return {
      block: true,
      reason:
        `\`${path}\` — Python/Ruby/셸 스크립트 금지 (tooling.md)\n\n` +
        "이 프로젝트의 언어는 TypeScript(앱·하네스)와 Swift(네이티브)뿐입니다.\n" +
        "스크립트성 코드는 TypeScript로 훅 하위에 두고 make 타겟으로 실행하세요:\n" +
        "  .omp/hooks/post/check-<name>.ts  (자동 검사)\n" +
        "  .omp/hooks/lib/<scope>-<name>.ts (러너/공유 로직)",
    };
  }

  if (NATIVE_SOURCES.test(path) && !NATIVE_ROOTS.some((root) => path.startsWith(root))) {
    return {
      block: true,
      reason:
        `\`${path}\` — 네이티브 소스는 app/macos/ 또는 app/ios/ 아래에만 둔다 (tooling.md)\n\n` +
        "React-free 로직: app/macos/MarshallBluetooth-macOS/Native/Core/ 또는 app/macos/Shared/\n" +
        "RN 어댑터: app/macos/MarshallBluetooth-macOS/Native/*.swift + *.m\n" +
        "위젯: app/macos/MarshallWidget/\n" +
        "iOS 앱: app/ios/MarshallBluetooth/",
    };
  }

  if (/^\.omp\/(hooks|extensions)\//.test(path) && /\.(js|jsx|mjs|cjs)$/.test(path)) {
    return {
      block: true,
      reason:
        `\`${path}\` — .omp/hooks/ 와 .omp/extensions/ 는 TypeScript만 허용 (tooling.md)\n\n` +
        "확장자를 .ts 로 두세요 — node가 타입을 스트립해 그대로 실행합니다.",
    };
  }

  if (ADHOC_SCRIPT_DIRS.test(path)) {
    return {
      block: true,
      reason:
        `\`${path}\` — 프로젝트 루트 스크립트 디렉토리 금지 (tooling.md)\n\n` +
        "검사·러너는 .omp/hooks/ 하위에, 실행은 make 타겟으로:\n" +
        "  .omp/hooks/lib/<scope>-<name>.ts + Makefile 타겟",
    };
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path) && !SCRIPT_ROOTS.some((root) => path.startsWith(root))) {
    return {
      block: true,
      reason:
        `\`${path}\` — 인정되지 않은 위치의 스크립트 (tooling.md)\n\n` +
        "허용 위치: .omp/hooks/, .omp/extensions/, app/",
    };
  }

  return null;
}

/** An absolute or `./`-prefixed path is the same file as the project-relative one. */
function normalize(path: string): string {
  const relative = path.startsWith(projectRoot) ? path.slice(projectRoot.length) : path;
  return relative.replace(/^\.\//, "");
}
