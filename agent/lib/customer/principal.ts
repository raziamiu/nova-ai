/**
 * The synthetic principal the customer channel mints for every inbound
 * customer-conversation session (Stage 10 module 01). Shape is canonical
 * (Front Office §2.5): `authenticator: "dakio-inbox"` is what the dynamic
 * customer instruction layer keys on (module 02 — founder layers must NOT
 * load for customer sessions), and `attributes.storeId` is the ONLY source
 * of tenancy for the session (`resolveStoreId` / `requireStore` read it;
 * the tenant-guard hook pins it for the session's lifetime).
 *
 * `principalType: "customer"` (not `"user"`) is load-bearing, same as
 * `tenantAppPrincipal` in `../jobs/principal.ts`: the trust-plane tools
 * (`approve_action`, `reject_action`, `undo_action`, `configure_autonomy`)
 * deny any non-`"user"` principal outright, so a customer session is
 * structurally denied the trust plane no matter what the transcript says.
 * Deliberately no `role` attribute — `requireStore` then resolves the least
 * privileged `"staff"`, never an owner.
 *
 * Tenancy note: `storeId` here is taken from the delivery POST's body, which
 * is legitimate ONLY because the caller (dakio-api's `inboxDelivery.js`) has
 * already been authenticated as dakio-api itself via the HMAC shared secret —
 * dakio-api is the authoritative tenancy system, and the channel mints this
 * principal server-side after that check. The channel never accepts founder
 * JWTs and this function must never be handed a model- or customer-supplied
 * store id.
 */

import type { SessionAuthContext } from "eve/context";

export function customerPrincipal(
  storeId: string,
  conversationId: string,
  platform: string,
): SessionAuthContext {
  return {
    authenticator: "dakio-inbox",
    principalId: `inbox:${conversationId}`,
    principalType: "customer",
    attributes: { storeId, conversationId, platform },
  };
}
