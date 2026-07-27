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
 * `link_customer` joined in module 03 (D-38). It is on the customer plane on
 * purpose: recognising the person in the thread is something they ask for by
 * stating their own number, and the tool hands that assertion to the SERVER to
 * resolve — the model never picks whom to link to, so the widest failure this
 * opens is "no match", not "the wrong person's history".
 *
 * `schedule_follow_up` joined in module 04 (D7). Also customer-plane on
 * purpose: deciding to check back happens mid-conversation, in the same breath
 * as "achha, ami dekhe janai". It books a job and sends nothing — the reply it
 * eventually composes is a separate `reply_in_thread` through the same gate —
 * and the server owns the delay bounds, the quiet hours, the one-per-thread
 * rule and the cancel-on-inbound, so the widest failure this opens is a
 * reminder nobody needed.
 *
 * `remember` is deliberately still NOT here even though it is shipped and
 * module 03 has landed: a customer can dictate a "brand note" that renders back
 * as trusted shop fact in every later session, so customer memory is written by
 * the server-side `conversation_distill` job instead of by anything the model
 * can be talked into calling. See `SLIM_TOOLS_WITHHELD`.
 *
 * MODULE 05 ADDS FOUR, and they are the first ones on this list that can move
 * money. The argument for putting them on the customer plane is the same one
 * that put `link_customer` here and it is stronger, not weaker: closing a sale
 * is what this conversation is FOR, and a selling tool that refused a customer
 * session would be unreachable from the only thread it belongs in. What makes
 * that safe is not the plane, it is the shape of the payloads — none of the
 * three write verbs carries a price. The model names products, quantities, a
 * district and a mechanism; the SERVER prices every line from the catalogue,
 * refuses anything off the listed price, resolves the delivery charge and
 * re-validates the coupon. And all three are gated: `inbox.orderAuto` and
 * `inbox.discountAuto` ship FALSE so every order and every discount is a
 * Decision the owner approves, and `verify_payment_slip` is in `ALWAYS_DRAFT`
 * in both repos, forever, because nothing in this system can read a payment
 * slip.
 *
 * `validate_coupon` is the odd one out and deliberately included: it is a READ
 * that performs no action, and it is what lets Nova find out a code is dead
 * BEFORE the order rather than let the storefront charge full price and say
 * nothing, which is what it does today.
 *
 * `get_product` and `get_order_status` stay in `SLIM_TOOLS_PENDING` — module 05
 * built neither. `get_products` already answers every catalogue question this
 * register asks for, and order lookup is module 06's.
 */
export const CUSTOMER_SLIM_TOOLS: readonly string[] = [
  "get_conversation",
  "reply_in_thread",
  "flag_handover",
  "get_products",
  "link_customer",
  "schedule_follow_up",
  "validate_coupon",
  "create_order_from_chat",
  "offer_chat_discount",
  "verify_payment_slip",
  // Module 06. The one read that lets Nova answer "amar order kothay?" with a
  // fact instead of a hand-off. It returns the SAME humanized step the public
  // tracking page shows — never a raw courier string — so what Nova says and
  // what the customer sees on their own link are the same sentence.
  "get_order_status",
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
