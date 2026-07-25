/**
 * The synthetic principal the customer channel mints for every inbound
 * customer-conversation session (Stage 10 module 01). Shape is canonical
 * (Front Office §2.5): `authenticator: "dakio-inbox"` is what the dynamic
 * customer instruction layer keys on (module 02 — `isCustomerSession` below
 * is that switch, and the founder layers 10–40 return `null` on it so they
 * cannot load for a customer session), and `attributes.storeId` is the ONLY source
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

import type { SessionAuth, SessionAuthContext } from "eve/context";

/**
 * The authenticator string every dynamic resolver keys on. Module 02 turned
 * it into the single switch that selects a register: the customer instruction
 * layer loads when it matches, and the founder layers return `null` when it
 * does — mutually exclusive by construction, so the two prompts can never
 * co-render.
 */
export const INBOX_AUTHENTICATOR = "dakio-inbox";

export function customerPrincipal(
  storeId: string,
  conversationId: string,
  platform: string,
): SessionAuthContext {
  return {
    authenticator: INBOX_AUTHENTICATOR,
    principalId: `inbox:${conversationId}`,
    principalType: "customer",
    attributes: { storeId, conversationId, platform },
  };
}

/** The minimal shape the session predicates need (mirrors `TenantContext`). */
export interface CustomerSessionContext {
  readonly session: { readonly auth: SessionAuth };
}

/**
 * Is this session a customer conversation?
 *
 * Checks BOTH `current` and `initiator`, not just `current` as D1 phrases it.
 * The two are the same principal on every real customer turn (the channel
 * mints one and the tenant-guard hook refuses a session whose current and
 * initiator disagree on tenant), so the OR only differs in the degenerate
 * case — and there it fails the safe way: a session that was EVER a customer
 * session keeps the customer register and stays out of the founder layers.
 * Getting founder content into a customer session is the worst
 * customer-facing failure this module can have; the reverse is a cosmetic bug.
 */
export function isCustomerSession(ctx: CustomerSessionContext): boolean {
  const { current, initiator } = ctx.session.auth;
  return (
    current?.authenticator === INBOX_AUTHENTICATOR ||
    initiator?.authenticator === INBOX_AUTHENTICATOR
  );
}

/** What the customer register needs to address the session, beyond the store. */
export interface CustomerSessionFacts {
  conversationId: string;
  platform: string;
}

/**
 * Read the conversation the session is pinned to, straight off the verified
 * principal — never off a tool argument or the transcript. Returns `null` for
 * a non-customer session.
 */
export function customerSessionFacts(ctx: CustomerSessionContext): CustomerSessionFacts | null {
  if (!isCustomerSession(ctx)) return null;
  const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
  const read = (key: string): string | undefined => {
    const value = auth?.attributes?.[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) return value[0];
    return undefined;
  };
  const conversationId = read("conversationId");
  if (!conversationId) return null;
  return { conversationId, platform: read("platform") ?? "messenger" };
}
