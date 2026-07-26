import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
import { round2 } from "../lib/nova/format";
import { requireFounderSession } from "../lib/customer/session";

export default defineTool({
  description:
    "List abandoned carts with customer name, value, and recovery state. Filter by state (none, message_prepared, message_sent, recovered, lost). Use to find recovery opportunities — carts in state 'none' are untouched revenue. A cart carrying a conversationId already has a live chat thread and the server has booked the in-thread nudge for it: do not contact that customer from this lane, or they hear about one basket twice in two channels. A cart with conversationId null has no thread and is yours to recover. Returns { count, totalValue, carts } (max 50).",
  inputSchema: z.object({
    state: z
      .enum(["none", "message_prepared", "message_sent", "recovered", "lost"])
      .optional()
      .describe("Only carts in this recovery state"),
  }),
  async execute(input, ctx) {
    requireFounderSession(ctx); // D11: founder-plane tool, never a customer session
    const client = storeFor(requireStore(ctx).storeId);
    const carts = await client.listAbandonedCarts(input.state);
    const totalValue = round2(carts.reduce((s, c) => s + c.value, 0));
    const shown = carts.slice(0, 50);
    const customers = await Promise.all(shown.map((cart) => client.getCustomer(cart.customerId)));
    return {
      count: carts.length,
      totalValue,
      carts: shown.map((cart, i) => {
        const customer = customers[i];
        return {
          id: cart.id,
          customerId: cart.customerId,
          customerName: customer?.name ?? null,
          customerSegment: customer?.segment ?? null,
          value: cart.value,
          abandonedAt: cart.abandonedAt,
          recoveryState: cart.recoveryState,
          recoveryMessage: cart.recoveryMessage,
          // THE FIELD THE SWEEP PROMPT IS WRITTEN AROUND. `cart_sweep` tells the
          // model "SKIP any cart that already has a conversationId" — and this
          // projection used to drop the field, so no cart ever appeared to have
          // one and the instruction could not be obeyed even in principle. Every
          // cart with a live thread got contacted here AND nudged in-thread by
          // dakio-api's `runCartRecoveryMatch`: one customer, one basket, two
          // channels, which is the exact failure that sentence exists to prevent.
          //
          // Spread rather than `?? null`, because absent and null mean different
          // things and collapsing them costs the model the difference. Null is
          // "no thread matched" — a normal cart, recover it. ABSENT is "this
          // dakio-api predates module 05 and cannot match threads at all", in
          // which case nothing else is nudging anyone and this lane is the only
          // recovery there is.
          ...(cart.conversationId === undefined ? {} : { conversationId: cart.conversationId }),
          items: cart.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        };
      }),
    };
  },
});
