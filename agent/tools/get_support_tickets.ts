import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "List support tickets with customer name, hours open, and the latest message. Filter by status (open, waiting_on_customer, escalated, resolved). Use to triage support work — long-open or escalated tickets first. Returns { count, tickets } (max 50).",
  inputSchema: z.object({
    status: z
      .enum(["open", "waiting_on_customer", "escalated", "resolved"])
      .optional()
      .describe("Only tickets with this status"),
  }),
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const nowMs = Date.parse(client.now());
    const tickets = await client.listSupportTickets(input.status);
    const shown = tickets.slice(0, 50);
    const customers = await Promise.all(shown.map((t) => client.getCustomer(t.customerId)));
    return {
      count: tickets.length,
      tickets: shown.map((t, i) => {
        const customer = customers[i];
        const hoursOpen =
          Math.round(Math.max(0, (nowMs - Date.parse(t.openedAt)) / 3_600_000) * 10) / 10;
        const lastMessage = t.messages.length > 0 ? t.messages[t.messages.length - 1] : null;
        return {
          id: t.id,
          customerId: t.customerId,
          customerName: customer?.name ?? null,
          orderId: t.orderId,
          subject: t.subject,
          category: t.category,
          status: t.status,
          openedAt: t.openedAt,
          hoursOpen,
          messageCount: t.messages.length,
          lastMessage: lastMessage
            ? { from: lastMessage.from, text: lastMessage.text, at: lastMessage.at }
            : null,
        };
      }),
    };
  },
});
