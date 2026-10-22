import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Strict-Command-Routing Pre Hook
 *
 * All commands that have a `make` target must use `make <target>`.
 * Direct tool invocations (npx/npm running tsc, eslint, jest or the React
 * Native CLI; swiftc; pod; xcodebuild) are blocked toward the target that owns
 * them, so every run uses the flags the gate uses.
 *
 * A full gate (`make verify`, `make test`) additionally may not have its output
 * truncated by a pipe. Two separate failures come from the same shape:
 * `make verify | tail` returns **tail's** exit code, so a red gate reads green;
 * and the session's own finish gate refuses to count a truncated run as a
 * verification, so the model is asked to verify again after every answer. That
 * is a measured loop — six `make verify | tail` runs in one session, each one
 * green, each one followed by the same "run make verify" notice.
 *
 * Denylist patterns are anchored to a command boundary (line start, or after
 * `&&` / `||` / `;` / `|` / `(`, with optional `sudo`). A binary path used as
 * an argument — e.g. `ls app/node_modules/.bin/jest` — is NOT an invocation and
 * is not blocked.
 *
 * To add/remove rules: modify the denylist array. No other logic changes needed.
 */

/**
 * A project-root full gate. `-fast` variants are excluded for the same reason
 * `continuity/discipline.ts` excludes them: they are a subset, not the gate.
 */
const FULL_GATE = /\bmake\b[^|;&]*\b(?:verify|test)\b(?!-fast)/;

/** The filters that drop a gate's lines and its exit code with them. */
const GATE_TRUNCATION = /\|\s*(?:tail|head|grep|sed|awk|wc)\b/;

export default function strictCommandRouting(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: { toolName?: string; input?: Record<string, unknown> }) => {
    // 실행 채널은 셋이다: bash, eval(파이썬/JS 본문에서 subprocess.run·execSync), hub(op:start).
    // bash 만 보면 전수 점검 기준 32% 가 샌다(차단 185 vs 우회 87).
    const tool = String(event.toolName ?? "");
    if (!/^(bash|eval)$/.test(tool)) return;

    const cmd = String(event.input?.command ?? event.input?.code ?? "");

    // eval 본문에서는 라우팅 대상이 인용부호 안에 들어간다(`execSync("npx jest")`) — 셸용
    // 패턴이 못 잡는다. 전수 점검: eval 로 85건/25세션이 우회했다. 실행 함수 + 대상 도구가
    // 같은 본문에 있으면 막고, 셸과 같은 안내(make 타깃)를 준다.
    if (tool === "eval") {
      const runner = /\b(subprocess\.(?:run|call|check_output|Popen)|execSync|spawnSync|os\.system)\b/;
      const routed = /\b(npm|npx|jest|tsc|eslint|swiftc|xcodebuild|pod)\b/;
      if (runner.test(cmd) && routed.test(cmd)) {
        return {
          block: true,
          reason:
            "도구를 eval 본문에서 직접 실행하지 않는다 — 셸에서 막히는 것과 같은 우회다. " +
            "프로젝트의 make 타깃을 쓰세요(`make test`, `make lint`, `make typecheck`, `make swift-check`).",
        };
      }
    }

    // --- Full gate: never truncated ---
    // 허용목록보다 먼저다. `make verify | tail` 은 `make ` 로 시작하므로 아래 allowlist 가
    // 그대로 통과시켰고, 그래서 이 두 실패가 같은 세션에서 동시에 일어났다: 파이프의
    // 종료코드가 게이트의 것을 덮어 빨간 게이트가 초록으로 읽히고, 마감 게이트는 잘린
    // 실행을 검증으로 세지 않아 답변마다 "make verify 를 돌려라" 를 되풀이한다.
    if (FULL_GATE.test(cmd) && GATE_TRUNCATION.test(cmd)) {
      return {
        block: true,
        reason:
          "게이트 출력을 파이프로 자르지 않는다 — `make verify | tail` 은 tail 의 종료코드를 " +
          "돌려주므로 빨간 게이트가 초록으로 보이고, 세션의 마감 게이트도 잘린 실행을 " +
          "검증으로 세지 않아 같은 요구가 반복된다.\n\n  → `make verify` 를 그대로 실행하세요" +
          "(출력이 길면 결과가 artifact 로 남는다).",
      };
    }

    // --- Allowlist ---
    if (cmd.startsWith("make ")) return;

    // --- Denylist (patterns anchored to a command boundary) ---
    for (const rule of denylist) {
      if (rule.pattern.test(cmd)) {
        return {
          block: true,
          reason: `\`${rule.desc}\` — 직접 실행 금지\n\nmake 타겟을 사용하세요:\n  → \`${rule.target}\``,
        };
      }
    }
  });
}

/**
 * Anchors the given binary name to a command boundary (start or after `&&`, `||`, `;`, `|`, `(`, optional `sudo`).
 * Allows whitespace-free relative-path prefixes (`app/`, `./`, `node_modules/.bin/`), but never an argument word —
 * e.g. `ls app/node_modules/.bin/jest` stays unblocked because `ls ` (with space) cannot be part of the prefix.
 */
const atCmdStart = (bin: string) => `(?:^|[&|;()]\\s*)(?:sudo\\s+)?(?:[^\\s&|;()]+/)*${bin}\\b`;

const denylist: Array<{
  desc: string;
  pattern: RegExp;
  target: string;
}> = [
  {
    desc: "TypeScript 컴파일러 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx\\s+)?tsc")}(?:\\s|$)`),
    target: "make typecheck",
  },
  {
    desc: "ESLint 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx\\s+)?eslint")}(?:\\s|$)`),
    target: "make lint",
  },
  {
    desc: "Jest 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx\\s+)?jest")}(?:\\s|$)`),
    target: "make test",
  },
  {
    // package.json 의 scripts 는 make 타깃과 같은 일을 다른 플래그로 한다 — 게이트와 다른 결과의 근원.
    desc: "npm 스크립트 직접 실행",
    pattern: new RegExp(`${atCmdStart("npm")}\\s+(?:run\\s+)?(?:test|lint|start|macos|ios|android)\\b`),
    target: "make test / make lint / make start / make run",
  },
  {
    desc: "npm ci/install 직접 실행",
    pattern: new RegExp(`${atCmdStart("npm")}\\s+(?:ci|install|i)(?:\\s*$|\\s*[&|;)])`),
    target: "make install (app/) / make desktop-install (app/desktop/)",
  },
  {
    desc: "React Native CLI 직접 실행",
    pattern: new RegExp(`${atCmdStart("npx")}\\s+(?:@react-native-community/cli|react-native)\\s+(?:start|run-macos)\\b`),
    target: "make start / make run",
  },
  {
    desc: "Swift 타입체크 직접 실행",
    pattern: new RegExp(`${atCmdStart("swiftc")}\\s+[^|;&]*-typecheck\\b`),
    target: "make swift-check",
  },
  {
    desc: "CocoaPods 직접 실행",
    pattern: new RegExp(`${atCmdStart("pod")}\\s+install\\b`),
    target: "make pods (macOS) / make ios-pods (iOS)",
  },
  {
    desc: "xcodebuild 직접 실행",
    pattern: new RegExp(`${atCmdStart("xcodebuild")}(?:\\s|$)`),
    target: "make build (macOS) / make ios-build (iOS)",
  },
  {
    // The bundle's resolution (react-native-web, the platform swaps) lives in build.ts; a
    // hand-run esbuild or electron-builder packages something the gate never built.
    desc: "데스크톱 번들러 직접 실행",
    pattern: new RegExp(`${atCmdStart("node")}\\s+\\S*desktop/build\\.ts\\b`),
    target: "make desktop-build",
  },
  {
    // The README's recording has one documented entry, like the bundler it drives.
    desc: "README 데모 녹화 직접 실행",
    pattern: new RegExp(`${atCmdStart("node")}\\s+\\S*desktop/demo\\.ts\\b`),
    target: "make demo",
  },
  {
    desc: "electron-builder 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx\\s+)?electron-builder")}(?:\\s|$)`),
    target: "make desktop-dist",
  },
  {
    desc: "Electron 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx\\s+)?electron")}\\s+\\.(?:\\s|$)`),
    target: "make desktop-start",
  },
  {
    // The version comes from the tag through -ProadieVersionName; a bare gradlew build ships 0.0.0.
    desc: "Gradle 직접 실행",
    pattern: new RegExp(`${atCmdStart("gradlew")}(?:\\s|$)`),
    target: "make android-apk",
  },
  {
    desc: "Script 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx|bash|sh)")}\\s+\\S*scripts/`),
    target: "make <target>",
  },
];
