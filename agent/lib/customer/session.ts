/**
 * The customer tool surface (Stage 10 module 02, D11).
 *
 * D11 names a slim tool set for a customer conversation, and until now that
 * set was a paragraph in the register asking the model not to call anything
 * else. A paragraph is not a boundary. eve resolves dynamic tools by ADDING to
 * the authored set and `disableTool()` is static, so the framework cannot
 * narrow a session's tools — every authored tool is visible to every session,
 * including `get_customers` (other people's names and phones),
 * `get_finance_report` (the shop's P&L) and the whole action plane. Reads are
 * not covered by the autonomy pipeline either, because a read performs no
 * action. So the gate has to live in the tools themselves: every tool that is
 * NOT on the list below opens its `execute` with `requireFounderSession(ctx)`.
 *
 * This file is the ONE registry. `instructions/50-customer-inbox.ts` renders
 * the advertised tool list from `CUSTOMER_SLIM_TOOLS`, and the guards deny
 * everything that isn't in it, so the prompt and the enforcement cannot drift;
 * `evals/inbox/run.ts` [14] walks `agent/tools/` file by file and proves both
 * directions, so a tool added later without a guard turns the suite red.
 *
 * The predicate is "is this a CUSTOMER session", not "is this the founder in
 * person": scheduled runs, subagent lineage and the internal job lane are all
 * founder-plane work under a non-`user` principal and must keep working. Only
 * the `dakio-inbox` authenticator is denied — the same single switch the two
 * instruction registers key on.
 */

import { isCustomerSession, type CustomerSessionContext } from "./principal";

/**
 * The tools a customer conversation may call. Shipped, gated, and advertised —
 * the register names exactly these and no more.
 *
 * `remember` is deliberately NOT here even though it is shipped: a customer
 * can dictate a "brand note" that renders back as trusted shop fact in every
 * later session, so customer memory stays closed until module 03 lands its
 * customer-scoped keying and provenance. See `SLIM_TOOLS_WITHHELD`.
 */
export const CUSTOMER_SLIM_TOOLS: readonly string[] = [
  "get_conversation",
  "reply_in_thread",
  "flag_handover",
  "get_products",
];

/**
 * What a customer session gets when it reaches for the owner's side of the
 * business. Deliberately non-leaky: it names no tool, no data and no reason
 * beyond "not here", so a successful injection learns nothing from the refusal
 * — and it tells the model the one thing it can usefully do next.
 */
export class CustomerToolDenied extends Error {
  readonly code = "CUSTOMER_TOOL_DENIED";
  constructor() {
    super(
      "Not available in a customer conversation — that belongs to the owner's side of the business. Answer from the tools you have, or hand the thread over.",
    );
    this.name = "CustomerToolDenied";
  }
}

/**
 * Refuse a founder-plane tool inside a customer conversation.
 *
 * Throws rather than returning an error object on purpose: a thrown refusal
 * cannot be quietly folded into a reply, and it fails closed if a future tool
 * forgets to check a return value.
 */
export function requireFounderSession(ctx: CustomerSessionContext): void {
  if (!isCustomerSession(ctx)) return;
  throw new CustomerToolDenied();
}
