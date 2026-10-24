/**
 * Ambient Harness Environment
 *
 * The harness runs on `node` with no package.json and no `@types/node`: hooks
 * are executed directly (`node .omp/hooks/post/<name>.ts`), so a dependency
 * added for type-checking alone would put a node_modules tree under a tree that
 * has none.
 *
 * The globals the hooks call are declared here, once, together with the host
 * module they import. Node builtins (`node:fs`, `node:path`, ...) stay behind
 * their `@ts-expect-error` markers: the runtime resolves them, and declaring
 * their signatures by hand would be a second, staler `@types/node`.
 */

// ============================================================
// Globals
// ============================================================

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
};

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  execPath: string;
  cwd(): string;
  exit(code?: number): never;
};

// ============================================================
// Host
// ============================================================

/**
 * Only the members the hooks and extensions call. `on` is a method on purpose:
 * method parameters are bivariant, so a handler typed for its own event shape
 * still assigns.
 */
interface HostExtensionApi {
  on(event: string, handler: (event: never, ctx: never) => unknown): void;
  registerTool?(tool: unknown): void;
  registerCommand?(command: unknown): void;
  setLabel?(label: string): void;
  logger?: unknown;
  zod?: unknown;
  setActiveTools?(names: string[]): Promise<void>;
  sendMessage?(message: unknown, options?: unknown): void;
  appendEntry?(type: string, data: unknown): void;
}

/** Some hooks annotate their entry point without importing the type. */
declare type ExtensionAPI = HostExtensionApi;

/** The package itself is resolved by the OMP runtime, not by this project. */
declare module "@oh-my-pi/pi-coding-agent" {
  export type ExtensionAPI = HostExtensionApi;
}

/** The one module-metadata field the harness reads: where a hook file lives. */
interface ImportMeta {
  readonly url: string;
}

declare class URL {
  constructor(input: string, base?: string);
}
