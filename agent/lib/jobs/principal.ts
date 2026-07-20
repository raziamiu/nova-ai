/**
 * The synthetic principal the dispatcher stamps on every job session
 * (Phase 05). Today only `agent/schedules/dispatcher.ts` and the Phase 05
 * evals import this — no tool does, and it should stay that way — but this
 * is a convention, not an enforced boundary: `tenantAppPrincipal` is a plain
 * exported function, importable from anywhere in the codebase like any other.
 *
 * `principalType: "runtime"` (not `"user"`) is load-bearing: the trust-plane
 * tools (`approve_action`, `reject_action`, `undo_action`,
 * `configure_autonomy`) deny any non-`"user"` principal outright (see the
 * `principalType !== "user"` check each of those tools applies). That denial
 * is what actually makes a misused import harmless — it holds regardless of
 * who calls this function or what attributes they pass — NOT the absence of
 * an import path. Deliberately no `role` attribute here either way; don't add
 * one. An earlier version of the trust-plane guard matched the literal
 * string `eve:app`, which this principal's shape doesn't match at all;
 * widening it to `principalType !== "user"` (this phase) is what actually
 * covers a scheduler-minted principal.
 */

import type { SessionAuthContext } from "eve/context";

export function tenantAppPrincipal(storeId: string): SessionAuthContext {
  return {
    authenticator: "nova-scheduler",
    principalId: "nova:scheduler",
    principalType: "runtime",
    attributes: { storeId },
  };
}
