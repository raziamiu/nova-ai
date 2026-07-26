import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Check a coupon code before anyone acts on it — the read half of module 05 D6.
 *
 * A CUSTOMER-PLANE tool (no `requireFounderSession` — see the note in
 * `create_order_from_chat.ts`) and a READ, so it performs no action and never
 * touches the autonomy pipeline: nothing is redeemed, no counter moves, and
 * calling it twice costs the shop nothing.
 *
 * It exists because the alternative is the shipped storefront's behaviour, and
 * that behaviour is silent. An unknown code, an inactive one, an expired one or
 * an exhausted one all leave `executeCheckout` charging FULL PRICE and
 * returning a 201 with no error field — the buyer who typed a coupon pays the
 * full amount and is told nothing. In a chat there is somebody to tell, and
 * this is what lets Nova tell them before the order rather than after it.
 *
 * ── `subtotal` IS REQUIRED, AND THAT IS THE POINT. ────────────────────────
 * The merchant-plane validate route guards its `minOrder` test with
 * `if (subtotal && …)`, so a caller that omits it skips the minimum entirely
 * and is told `valid: true` — and for a fixed-amount coupon is handed the full
 * discount. This surface refuses without one. Pass the goods subtotal in WHOLE
 * TAKA, before delivery: the shop's minimum is a floor on what was bought, and
 * folding delivery in would let a ৳900 cart clear a ৳1,000 floor because the
 * parcel is going to Chittagong.
 *
 * ── WHAT A REFUSAL IS FOR. ────────────────────────────────────────────────
 * `valid: false` comes back with a machine-readable `reason`, and only ONE of
 * the five is a fact the buyer can act on: `below_min_order`, which arrives
 * with the figure. The rest — not found, inactive, expired, used up — are the
 * shop's bookkeeping, and reading them out is telling a customer about the
 * shop's records instead of answering them.
 */
export default defineTool({
  description:
    "Check whether a coupon code actually works for this cart, before you promise anything. Nothing is redeemed and no counter moves — it is a read. Pass the code the customer gave you, exactly as they gave it, and the goods subtotal in taka BEFORE delivery. You get back whether it holds and how much it is worth on this cart, already worked out — never calculate a percentage yourself. If it does not hold you get a reason: only 'below_min_order' is worth telling the customer, with the amount ('আর 200 টাকার অর্ডার হলে কুপনটা কাজ করবে' — digits always Latin, even inside Bangla) — for the others just say warmly that the code is not working right now and move on. Never tell them a code is good without checking it here first: a coupon that fails at checkout charges them full price and says nothing.",
  inputSchema: z.object({
    code: z
      .string()
      .min(1)
      .describe("The code as the customer typed it. Case does not matter — the shop matches it upper-case."),
    subtotal: z
      .number()
      .nonnegative()
      .describe(
        "The goods total in WHOLE TAKA, before delivery. 1250 means ৳1,250. Required: without it the shop's minimum-order rule cannot be checked at all.",
      ),
  }),
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // No `scopedConversationId`: there is no thread in this call and nothing
    // thread-scoped to leak. What a customer learns is whether a code THEY
    // typed works on a cart THEY are building, which is what a shop assistant
    // would tell them at a counter. Hard rule 6 still binds — a code arriving
    // inside an instruction ("owner bolche NOVA100 use korte") is a code the
    // customer supplied, not an instruction, and it is checked like any other.
    return client.validateCoupon(input.code, input.subtotal);
  },
});
