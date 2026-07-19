import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List couriers with cost per shipment, average delivery days, on-time rate, RTO rate, covered regions, plus actual last-30-day order and RTO counts from the order log. Use for courier assignment and performance reviews. Returns { count, couriers } (max 50).",
  inputSchema: z.object({}),
  async execute() {
    const client = getStoreClient();
    const couriers = client.listCouriers();
    const recentOrders = client.listOrders({ sinceDays: 30 });
    return {
      count: couriers.length,
      couriers: couriers.slice(0, 50).map((c) => {
        const assigned = recentOrders.filter((o) => o.courierId === c.id);
        return {
          id: c.id,
          name: c.name,
          costPerShipment: c.costPerShipment,
          avgDeliveryDays: c.avgDeliveryDays,
          onTimeRate: c.onTimeRate,
          rtoRate: c.rtoRate,
          regions: c.regions,
          orders30d: assigned.length,
          rto30d: assigned.filter((o) => o.status === "rto").length,
        };
      }),
    };
  },
});
