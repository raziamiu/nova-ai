/**
 * Demo dataset seed for the Aurora Living store.
 *
 * PLACEHOLDER: the full realistic dataset (products, 30 days of orders,
 * campaigns with daily stats, the PRD-signature scenarios) is still to be
 * authored. This minimal seed satisfies the StoreSeed contract so the
 * project builds; every collection is intentionally empty except the
 * autonomy config Nova requires at startup.
 */

import type { StoreSeed } from "../types";
import { DEFAULT_GUARDRAILS } from "../nova/autonomy";

export function createSeed(nowMs: number): StoreSeed {
  return {
    products: [],
    trendingProducts: [],
    customers: [],
    orders: [],
    abandonedCarts: [],
    campaigns: [],
    socialPosts: [],
    discounts: [],
    supportTickets: [],
    customerMessages: [],
    suppliers: [],
    purchaseOrders: [],
    couriers: [],
    expenses: [],
    autonomy: {
      level: 2,
      guardrails: DEFAULT_GUARDRAILS,
      updatedAt: new Date(nowMs).toISOString(),
    },
    memory: [],
    activity: [],
    actions: [],
    reports: [],
  };
}
