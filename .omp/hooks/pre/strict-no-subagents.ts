import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { recordedBlocks } from "../lib/hook-metrics.ts";

/**
 * Strict-No-Subagents Pre Hook
 *
 * Subagents (`task`) are allowed unless the session runs on a local `omlx`
 * model: a local model has neither the context nor the throughput to pay a
 * second agent's cold start (this rulebook and the hook contract read again),
 * so there every multi-step job stays with the main agent.
 *
 * On every other provider a spawn is allowed and routed to Sonnet
 * (`before_subagent_spawn`): a child does bounded, specified work, and the
 * cheaper model is the right tier for it whatever the parent runs on. The
 * patterns are attempt-ordered; the second is the retry fallback.
 *
 * The provider is read off the live session model (`ctx.models.current()`),
 * so a `/model` switch mid-session is honoured on the next spawn. No agent-type
 * allowlist: the check is the provider, which a new agent type cannot bypass.
 */

const LOCAL_PROVIDER = "omlx";

const SUBAGENT_MODELS = ["anthropic/claude-sonnet-5-5", "anthropic/claude-sonnet-5"];

const BLOCK_REASON =
  "서브에이전트 생성 금지\n\n세션 모델이 omlx(로컬)입니다. 로컬 모델에서는 모든 작업을 현재 에이전트가 수행합니다.";

export default function strictNoSubagents(pi: ExtensionAPI): void {
  // ctx-ok: 세션 모델의 provider 는 ctx(models.current / model)에만 있다 — event 에는 없다.
  // onLocalModel 은 모든 접근을 typeof/in 가드로 감싸 던질 수 없다(가드 실패는 false).
  pi.on("tool_call", recordedBlocks("strict-no-subagents", (event: { toolName?: string }, ctx: unknown) => {
    if (event.toolName !== "task") return;
    if (!onLocalModel(ctx)) return;
    return { block: true, reason: BLOCK_REASON };
  }));

  pi.on("before_subagent_spawn", (_event: unknown, ctx: unknown) => {
    if (onLocalModel(ctx)) return { block: true, reason: BLOCK_REASON };
    return { model: SUBAGENT_MODELS, note: "subagents run on Sonnet (strict-no-subagents)" };
  });
}

/** The provider of a model-shaped value, or "" when the value is not one. */
function providerOf(value: unknown): string {
  if (value && typeof value === "object" && "provider" in value && typeof value.provider === "string") {
    return value.provider.toLowerCase();
  }
  return "";
}

/** Is the live session model a local `omlx` one? Reads `ctx.models.current()`, then `ctx.model`. */
function onLocalModel(ctx: unknown): boolean {
  if (!ctx || typeof ctx !== "object") return false;
  let model: unknown = "model" in ctx ? ctx.model : undefined;
  if ("models" in ctx && ctx.models && typeof ctx.models === "object" && "current" in ctx.models) {
    const current = ctx.models.current;
    if (typeof current === "function") model = current.call(ctx.models) ?? model;
  }
  return providerOf(model) === LOCAL_PROVIDER;
}
