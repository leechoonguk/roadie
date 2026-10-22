/**
 * Continuity — the session's two project-specific contracts, and nothing else.
 *
 * The extension this was ported from once carried loop detection, goal cards,
 * acceptance judging and context cuts. Measured, nearly all of it only cost:
 * its interventions cancelled tool calls the previous turn had queued, its loop
 * detector then read those re-issued calls as loops, and its goal tool was
 * called zero times across 190 sessions. Context management belongs to omp.
 *
 * What remains lives in `discipline.ts`: REG-WATCH (a wiring line lost from an
 * entry point or a bridge declaration file) and the finish gate (a finish with
 * no verification after the last change). Both are contracts omp cannot know.
 * Messages leave only through `pi.sendUserMessage`; the extension never
 * touches the context.
 */

import { registerDiscipline } from "./discipline.ts";

export default function continuity(pi: unknown): void {
  registerDiscipline(pi as never);
}
