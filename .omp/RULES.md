# Sticky Rules

## Session Safety

Never modify `AGENTS.md` or any `.omp/` file without explicit user request.
`README.md` at the project root is the project's front page: keep it true to
the code in the same change (rule://root-readme). Its pictures in `docs/` are
regenerated with `make demo` and `make widget-snapshots`, never edited by hand.
Never commit or push unless the user explicitly asks in the current turn. This
one is mechanical, not advisory: `strict-publish-consent.ts` reads the session's
own entries and blocks the command. Publish with `make commit m="…"` and
`make push`, which run `make verify` first and stage the tree it read.

## Harness Integrity

When modifying the harness (`.omp/` files, hooks, rules, MCP/LSP config), always reference OMP official documentation (`omp://`) first. The harness is the backbone of your development workflow — changes here affect every session. Read `omp://` docs (settings, hooks, rules, tools, SDK) to understand current behavior before touching anything. Never guess how the harness works; verify against the official guide.

## Workflow

Before creating or editing files in an area, read that area's rulebook entries
via `rule://<name>` — they are listed in the system prompt with their globs.
Discovering requirements up front is faster than rediscovering them one verify
failure at a time. When a verify failure names a rule area, read that rule
before retrying.

Keep the todo list stateful while debugging: after each verification run, record
which check is failing and the next single step — it is the task's memory across
context resets and compactions.

An additive task must not wipe existing code: prefer targeted edits over
full-file rewrites of existing files, and never truncate a file with `>`.
Never replace an existing import line with yours — add it alongside; existing
imports and `RCT_EXTERN_METHOD` declarations wire modules the rest of the code
depends on. Never strip an existing `do`/`try` wrapper while keeping the code it
wraps.

Run the verification after wiring each layer or file group, not only at the
end — failures discovered early are cheaper than one pile at the finish.
Verify by unit while working: `make test`, `make lint`, `make typecheck`,
`make swift-check` or the `make check-*` that cover what changed. Do not run
the full `make verify` during work — it runs once, at commit time, through
`make commit`/`make push`. Before declaring work done, the unit checks covering
the last change must be green.

## Working pattern

- 작업 중 검증은 바뀐 단위만 돌린다(`make test`·`make lint`·`make typecheck`·`make swift-check`·해당
  `make check-*`). 전수 검증 `make verify` 는 커밋할 때 `make commit` 이 한 번 돌린다.
- 네이티브 로직은 `Native/Core`·`Shared` 에 먼저 쓰고 `make swift-check` 로 세운 뒤에 어댑터·브리지·
  JS 래퍼를 잇는다 — Xcode 가 없는 이 머신에서 어댑터 안의 로직은 어떤 게이트도 컴파일하지 않는다.
- 한 계층이 서면 그 계층의 검증을 곧바로 돌린다. 끝에 몰아서 하지 않는다.
- 배선 파일(import·`RCT_EXTERN_METHOD`·`AppRegistry` 등록)에 이미 다른 항목이 있으면 **나란히 추가**한다.
  기존 줄을 교체하지 않는다.
- 게이트 출력을 `head`/`tail`/`grep` 으로 자르지 않는다. 파이프는 파이프의 종료코드를 돌려주므로 빨간 게이트가
  초록으로 보인다.

## Subagents

서브에이전트(`task` 도구)는 세션 모델이 `omlx`(로컬)일 때만 쓰지 않는다 — 로컬 모델은 새 에이전트가 이
규칙서와 훅 계약을 처음부터 다시 읽는 비용을 감당하지 못한다. 그 밖의 모델에서는 허용하되 서브에이전트는
Sonnet 으로 돈다 — `strict-no-subagents` 가 둘 다 집행한다(omlx 차단, 그 외 `before_subagent_spawn` 에서
Sonnet 으로 라우팅). 병렬이 필요하면 도구 호출을 한 턴에 묶는 것이 여전히 먼저다.
