/**
 * Attribution pass — replace heuristic revenue influence with measured outcomes.
 *
 * Phase 1 recorded a cart-recovery message's influence as a heuristic
 * (25% × cart value). Once the customer actually buys, we can do better: join
 * the recovery activity to the order it recovered and rewrite the influence to
 * the real order total, in place, with provenance. Runs nightly (a step inside
 * reflection); tenant-scoped through `storeId`.
 *
 * Conservative by design: it only OVERWRITES an estimate when it can point to a
 * concrete recovering order. Unrecovered carts keep their estimate rather than
 * being zeroed on a guess.
 */

import type { ActivityEntry, Order } from "../types";
import type { StoreClient } from "../store/client";
import { storeFor } from "../store/resolve";

export interface AttributionResult {
  /** Activities whose influence was rewritten to a measured value. */
  updated: {
    activityId: string;
    cartId: string;
    orderId: string;
    was: number;
    now: number;
  }[];
  /** Total measured recovered revenue this pass attributed. */
  measuredRevenue: number;
}

/**
 * Find the order that recovered a cart: an eligible order from the same
 * customer placed after the cart was abandoned. Earliest such order wins.
 */
function recoveringOrder(
  cartCustomerId: string,
  cartAbandonedAtMs: number,
  orders: Order[],
): Order | null {
  const candidates = orders
    .filter(
      (o) =>
        o.customerId === cartCustomerId &&
        o.status !== "cancelled" &&
        o.status !== "refunded" &&
        Date.parse(o.placedAt) >= cartAbandonedAtMs,
    )
    .sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt));
  return candidates[0] ?? null;
}

export async function runAttribution(storeId: string): Promise<AttributionResult> {
  return attributeVia(storeFor(storeId));
}

/** Client-scoped attribution — the tenant-bound core `runAttribution` wraps. */
export async function attributeVia(client: StoreClient): Promise<AttributionResult> {
  const [activity, carts, orders] = await Promise.all([
    client.listActivity(),
    client.listAbandonedCarts(),
    client.listOrders(),
  ]);

  const cartById = new Map(carts.map((c) => [c.id, c]));
  const result: AttributionResult = { updated: [], measuredRevenue: 0 };

  const cartRecoveryActivities = activity.filter(
    (a: ActivityEntry) => a.relatedId != null && cartById.has(a.relatedId),
  );

  for (const entry of cartRecoveryActivities) {
    if (entry.revenueBasis === "measured") continue; // already attributed
    const cart = cartById.get(entry.relatedId as string);
    if (!cart) continue;

    const order = recoveringOrder(cart.customerId, Date.parse(cart.abandonedAt), orders);
    if (!order) continue; // no measurable recovery yet — keep the estimate

    const updated = await client.updateActivity(entry.id, {
      revenueInfluence: order.total,
      revenueBasis: "measured",
      revenueProvenance: `recovered by order ${order.id}`,
    });
    // Reflect the recovery on the cart itself so the state is consistent.
    if (cart.recoveryState !== "recovered") {
      await client.updateCart(cart.id, { recoveryState: "recovered" });
    }
    result.updated.push({
      activityId: entry.id,
      cartId: cart.id,
      orderId: order.id,
      was: entry.revenueInfluence,
      now: updated.revenueInfluence,
    });
    result.measuredRevenue += order.total;
  }

  result.measuredRevenue = Math.round(result.measuredRevenue * 100) / 100;
  return result;
}
