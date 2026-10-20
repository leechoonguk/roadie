/**
 * Dormancy reporting — shared by the post hooks that sometimes have nothing to
 * assert.
 *
 * A check that asserted nothing must not print the PASS a compliant one does,
 * and it must say *why* it asserted nothing, because the two reasons it is
 * allowed are not alike (rule://omp-hooks, Dormancy):
 *
 * - `absent` — the feature the check guards is not in the code (no
 *   `app/macos/` native tree yet). True in every environment; nothing to fix.
 * - `service` — the check compares the code with a running service this
 *   environment does not have (a registry, a device). True in a clean clone,
 *   and only there; the same check runs in full wherever the service is up.
 *
 * Nothing else is dormancy. A check that could not read the code it guards -
 * an import that failed, a manifest that did not parse - is broken, and says
 * so as an issue. Measured in the harness this was ported from: a manifest
 * failed to import in a clean clone, the check reported "dormant" and passed,
 * and a sibling check judged a whole screen set against an empty reading.
 */

/** Why a check asserted nothing - the only two reasons that are not a failure. */
export type DormantCause = "absent" | "service";

const reasons = new Map<string, string>();

/**
 * Records why a hook has nothing to assert and returns the empty issue list, so
 * a hook body reads `return dormant("check-app-native-boundary", "absent", "no app/macos/")`.
 */
export function dormant(hookName: string, cause: DormantCause, reason: string): string[] {
  reasons.set(hookName, `${cause}: ${reason}`);
  return [];
}

/** The recorded reason, or null when the hook actually checked something. */
export function dormancyReason(hookName: string): string | null {
  return reasons.get(hookName) ?? null;
}

/** `PASS` line for a CLI run: compliant and dormant must not look alike. */
export function passLine(hookName: string, compliantMessage: string): string {
  const reason = reasons.get(hookName);
  return reason === null || reason === undefined
    ? `    PASS: ${compliantMessage}`
    : `    PASS: ${compliantMessage} (dormant — ${reason})`;
}
