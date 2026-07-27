import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Where is my parcel — answered from the shop's own record (Stage 10 module 06).
 *
 * ── WHY THIS RETURNS WHAT IT DOES ──────────────────────────────────────────
 * The raw courier string never reaches this tool. The server maps it through
 * the SAME humanizer the public tracking page uses, because the customer can
 * open that link while reading Nova's reply — so "delivered_approval_pending"
 * in a thread would be both meaningless to them and different from what their
 * own page says. What comes back is the step, not the scan.
 *
 * `stuck` is the SERVER's verdict, computed off the same stagnation rule the
 * nightly sweep uses to open delivery cases. It is here so that Nova and the
 * sweep cannot disagree about whether a parcel is late — a model deciding
 * "five days feels long" would be inventing a threshold.
 *
 * `openCase` rides along so the SECOND person asking about one parcel is
 * answered from the case, with the same facts, without another round trip. Two
 * threads about one parcel should sound like one company, not two bots.
 *
 * ── WHAT NOVA MAY NOT DO WITH THIS ─────────────────────────────────────────
 * There is no ETA field, and that is not an omission: no courier gives Dakio a
 * delivery date, so any date in a reply would be a promise the shop then has to
 * keep. Quote the step and the holder. Hard rule 20 already forbids inventing a
 * scan or a date; this tool is the reason that rule now has something true to
 * offer instead.
 */
export default defineTool({
  description:
    "Look up where a customer's order actually is, before you answer any 'kothay', 'koto din', 'ekhono paini' question. Returns the humanized delivery step (the same wording their own tracking page shows), who is carrying it, the COD amount due at the door, whether the shop has confirmed it, and whether it has genuinely stopped moving. NEVER guess or estimate a delivery date — no courier gives one, and a date you invent becomes a promise the shop has to keep. Quote the step and who is holding it. If the order already has an open case, that comes back too: say what is being done about it rather than starting again, because another person may have asked about this same parcel already.",
  inputSchema: z.object({
    orderId: z
      .string()
      .min(1)
      .describe("The order's id, from the customer block on this conversation. Look it up rather than asking them to repeat their order number when the thread already knows it."),
  }),
  async execute(input, ctx) {
    // No `requireFounderSession` — this is customer-plane on purpose, and it is
    // the only read on that plane that touches an order. The projection is
    // built for a customer to hear: it carries no tracking id, no raw courier
    // status, no address, and no other order.
    const client = storeFor(requireStore(ctx).storeId);
    const status = await client.getOrderStatus(input.orderId);
    if (!status) {
      return {
        error:
          "No such order on this shop. Do not guess — ask them to check the order number, or hand the thread over.",
      };
    }
    return status;
  },
});
