/**
 * Executors — the one place where Nova's actions actually mutate the store.
 *
 * Both direct execution (high autonomy) and owner-approved execution of
 * prepared actions run through this registry, so behavior is identical
 * regardless of how an action was authorized. Executors capture the state
 * needed to undo, which powers the PRD trust system's undo button.
 */

import type { ActionType } from "../types";
import type { StoreClient } from "../store/client";
import {
  assignCourierPayload,
  createCampaignPayload,
  createDiscountPayload,
  createPurchaseOrderPayload,
  importProductPayload,
  publishSocialPostPayload,
  resolveTicketPayload,
  sendCustomerMessagePayload,
  switchSupplierPayload,
  updateCampaignPayload,
  updatePricePayload,
} from "./schemas";

export interface ExecutionResult {
  /** Human-readable statement of what was done. */
  outcome: string;
  undoable: boolean;
  undoData: Record<string, unknown> | null;
  /** Revenue this action plausibly influences, for the activity metrics. */
  revenueInfluence: number;
  /**
   * Business entity this action relates to (cart id, order id …). Recorded on
   * the activity so the nightly attribution pass can join estimated influence
   * to the real outcome.
   */
  relatedId?: string | null;
  /**
   * Founder-facing display snapshots for the E-8 receipt — what the record
   * looked like before and after the mutation. Distinct from `undoData`
   * (internal rollback state): these are for reading, not reverting.
   */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** The door record this action touched, e.g. "coupon:ck…" (receipt targetRef). */
  targetRef?: string | null;
}

type Executor = (client: StoreClient, payload: Record<string, unknown>) => Promise<ExecutionResult>;
type Undoer = (client: StoreClient, undoData: Record<string, unknown>) => Promise<string>;

export const executors: Record<ActionType, Executor> = {
  async update_campaign(client, raw) {
    const payload = updateCampaignPayload.parse(raw);
    const before = await client.getCampaign(payload.campaignId);
    if (!before) throw new Error(`Campaign not found: ${payload.campaignId}`);
    const prior = { status: before.status, dailyBudget: before.dailyBudget };
    const updated = await client.updateCampaign(payload.campaignId, {
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.dailyBudget !== undefined ? { dailyBudget: payload.dailyBudget } : {}),
      ...(payload.note !== undefined
        ? { notes: `${before.notes}\n[nova] ${payload.note}`.trim() }
        : {}),
    });
    const changes: string[] = [];
    if (payload.status !== undefined && payload.status !== prior.status) {
      changes.push(`status ${prior.status} → ${payload.status}`);
    }
    if (payload.dailyBudget !== undefined && payload.dailyBudget !== prior.dailyBudget) {
      changes.push(`daily budget $${prior.dailyBudget} → $${payload.dailyBudget}`);
    }
    return {
      outcome: `Updated campaign "${updated.name}": ${changes.join(", ") || "notes updated"}.`,
      undoable: true,
      undoData: { campaignId: payload.campaignId, ...prior },
      revenueInfluence: 0,
      before: prior,
      after: { status: updated.status, dailyBudget: updated.dailyBudget },
      targetRef: `campaign:${payload.campaignId}`,
    };
  },

  async create_campaign(client, raw) {
    const payload = createCampaignPayload.parse(raw);
    const campaign = await client.createCampaign({
      name: payload.name,
      channel: payload.channel,
      status: payload.startNow ? "active" : "scheduled",
      dailyBudget: payload.dailyBudget,
      productIds: payload.productIds,
      startedAt: client.now(),
      notes: payload.notes,
    });
    return {
      outcome: `Created ${campaign.status} ${campaign.channel} campaign "${campaign.name}" at $${campaign.dailyBudget}/day.`,
      undoable: true,
      undoData: { campaignId: campaign.id },
      revenueInfluence: 0,
      before: null,
      after: { name: campaign.name, channel: campaign.channel, status: campaign.status, dailyBudget: campaign.dailyBudget },
      targetRef: `campaign:${campaign.id}`,
    };
  },

  async publish_social_post(client, raw) {
    const payload = publishSocialPostPayload.parse(raw);
    const scheduled = payload.scheduledFor !== undefined;
    const post = await client.createSocialPost({
      platform: payload.platform,
      format: payload.format,
      caption: payload.caption,
      productIds: payload.productIds,
      status: scheduled ? "scheduled" : "published",
      scheduledFor: payload.scheduledFor ?? null,
      publishedAt: scheduled ? null : client.now(),
    });
    return {
      outcome: scheduled
        ? `Scheduled ${payload.platform} ${payload.format} for ${payload.scheduledFor}.`
        : `Published ${payload.platform} ${payload.format}.`,
      undoable: true,
      undoData: { postId: post.id },
      revenueInfluence: 0,
      before: null,
      after: { platform: payload.platform, format: payload.format, status: post.status },
      targetRef: `post:${post.id}`,
    };
  },

  async update_price(client, raw) {
    const payload = updatePricePayload.parse(raw);
    const before = await client.getProduct(payload.productId);
    if (!before) throw new Error(`Product not found: ${payload.productId}`);
    const prior = { price: before.price, compareAtPrice: before.compareAtPrice };
    const updated = await client.updateProduct(before.id, {
      price: payload.newPrice,
      ...(payload.compareAtPrice !== undefined ? { compareAtPrice: payload.compareAtPrice } : {}),
    });
    return {
      outcome: `Repriced "${updated.name}" $${prior.price} → $${payload.newPrice}.`,
      undoable: true,
      undoData: { productId: before.id, ...prior },
      revenueInfluence: 0,
      before: prior,
      after: { price: updated.price, compareAtPrice: updated.compareAtPrice },
      targetRef: `product:${before.id}`,
    };
  },

  async create_discount(client, raw) {
    const payload = createDiscountPayload.parse(raw);
    const expiresAt = new Date(
      Date.parse(client.now()) + payload.expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const discount = await client.createDiscount({
      code: payload.code.toUpperCase(),
      percentOff: payload.percentOff,
      scope: payload.scope,
      productIds: payload.productIds ?? [],
      customerId: payload.customerId ?? null,
      expiresAt,
      active: true,
    });
    return {
      outcome: `Created discount ${discount.code} (${discount.percentOff}% off, expires in ${payload.expiresInDays}d).`,
      undoable: true,
      undoData: { discountId: discount.id },
      revenueInfluence: 0,
      before: null,
      after: { code: discount.code, percentOff: discount.percentOff, scope: payload.scope, expiresAt },
      targetRef: `coupon:${discount.id}`,
    };
  },

  async send_customer_message(client, raw) {
    const payload = sendCustomerMessagePayload.parse(raw);
    const customer = await client.getCustomer(payload.customerId);
    if (!customer) throw new Error(`Customer not found: ${payload.customerId}`);
    await client.addCustomerMessage({
      customerId: payload.customerId,
      channel: payload.channel,
      purpose: payload.purpose,
      subject: payload.subject ?? null,
      body: payload.body,
      relatedId: payload.relatedId ?? null,
    });
    let revenueInfluence = 0;
    if (payload.purpose === "cart_recovery" && payload.relatedId) {
      const carts = await client.listAbandonedCarts();
      const cart = carts.find((c) => c.id === payload.relatedId);
      if (cart) {
        await client.updateCart(cart.id, {
          recoveryState: "message_sent",
          recoveryMessage: payload.body,
        });
        // Industry-typical recovery expectation used for the influence metric.
        // This is an ESTIMATE; the nightly attribution pass replaces it with
        // the actual recovered order total where one can be measured.
        revenueInfluence = Math.round(cart.value * 0.25 * 100) / 100;
      }
    }
    return {
      outcome: `Sent ${payload.purpose.replace("_", " ")} ${payload.channel} to ${customer.name}.`,
      undoable: false,
      undoData: null,
      revenueInfluence,
      relatedId: payload.purpose === "cart_recovery" ? (payload.relatedId ?? null) : null,
      before: null,
      after: { channel: payload.channel, purpose: payload.purpose, customer: customer.name },
      targetRef: `customer:${payload.customerId}`,
    };
  },

  async resolve_ticket(client, raw) {
    const payload = resolveTicketPayload.parse(raw);
    const ticket = await client.getSupportTicket(payload.ticketId);
    if (!ticket) throw new Error(`Ticket not found: ${payload.ticketId}`);
    const priorStatus = ticket.status;
    await client.addTicketMessage(payload.ticketId, { from: "nova", text: payload.reply });
    await client.updateTicketStatus(payload.ticketId, payload.newStatus);
    return {
      outcome: `Replied to ticket "${ticket.subject}" and set it to ${payload.newStatus}.`,
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      before: { status: priorStatus },
      after: { status: payload.newStatus },
      targetRef: `ticket:${payload.ticketId}`,
    };
  },

  async create_purchase_order(client, raw) {
    const payload = createPurchaseOrderPayload.parse(raw);
    const supplier = await client.getSupplier(payload.supplierId);
    if (!supplier) throw new Error(`Supplier not found: ${payload.supplierId}`);
    const product = await client.getProduct(payload.productId);
    if (!product) throw new Error(`Product not found: ${payload.productId}`);
    const offer = supplier.offers.find((o) => o.productId === product.id);
    const unitCost = payload.unitCost ?? offer?.unitCost;
    if (unitCost === undefined) {
      throw new Error(
        `${supplier.name} has no offer for ${product.name}; provide unitCost explicitly.`,
      );
    }
    const leadTimeDays = offer?.leadTimeDays ?? 14;
    const expectedAt = new Date(
      Date.parse(client.now()) + leadTimeDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const po = await client.createPurchaseOrder({
      supplierId: supplier.id,
      productId: product.id,
      quantity: payload.quantity,
      unitCost,
      status: "placed",
      expectedAt,
    });
    return {
      outcome: `Placed PO ${po.id}: ${payload.quantity} × ${product.name} from ${supplier.name} at $${unitCost}/unit ($${po.total} total, ETA ${leadTimeDays}d).`,
      undoable: true,
      undoData: { purchaseOrderId: po.id },
      revenueInfluence: 0,
      before: null,
      after: { supplier: supplier.name, product: product.name, quantity: payload.quantity, unitCost, total: po.total },
      targetRef: `purchase_order:${po.id}`,
    };
  },

  async switch_supplier(client, raw) {
    const payload = switchSupplierPayload.parse(raw);
    const product = await client.getProduct(payload.productId);
    if (!product) throw new Error(`Product not found: ${payload.productId}`);
    const supplier = await client.getSupplier(payload.newSupplierId);
    if (!supplier) throw new Error(`Supplier not found: ${payload.newSupplierId}`);
    const offer = supplier.offers.find((o) => o.productId === product.id);
    if (!offer) {
      throw new Error(`${supplier.name} has no offer for ${product.name}.`);
    }
    const prior = { supplierId: product.supplierId, cost: product.cost };
    await client.updateProduct(product.id, {
      supplierId: supplier.id,
      cost: offer.unitCost,
    });
    const delta = prior.cost - offer.unitCost;
    return {
      outcome: `Switched "${product.name}" to ${supplier.name} at $${offer.unitCost}/unit (${
        delta >= 0 ? `saves $${delta.toFixed(2)}` : `costs $${(-delta).toFixed(2)} more`
      } per unit).`,
      undoable: true,
      undoData: { productId: product.id, ...prior },
      revenueInfluence: 0,
      before: prior,
      after: { supplierId: supplier.id, cost: offer.unitCost },
      targetRef: `product:${product.id}`,
    };
  },

  async assign_courier(client, raw) {
    const payload = assignCourierPayload.parse(raw);
    const order = await client.getOrder(payload.orderId);
    if (!order) throw new Error(`Order not found: ${payload.orderId}`);
    const courier = await client.getCourier(payload.courierId);
    if (!courier) throw new Error(`Courier not found: ${payload.courierId}`);
    const prior = { courierId: order.courierId };
    await client.updateOrder({ id: order.id, courierId: courier.id });
    return {
      outcome: `Assigned ${courier.name} to order ${order.id} (${order.region}).`,
      undoable: true,
      undoData: { orderId: order.id, ...prior },
      revenueInfluence: 0,
      before: prior,
      after: { courierId: courier.id, courier: courier.name },
      targetRef: `order:${order.id}`,
    };
  },

  async import_product(client, raw) {
    const payload = importProductPayload.parse(raw);
    const trendingProducts = await client.listTrendingProducts();
    const trending = trendingProducts.find((t) => t.id === payload.trendingProductId);
    if (!trending) {
      throw new Error(`Trending product not found: ${payload.trendingProductId}`);
    }
    const price = payload.price ?? trending.suggestedPrice;
    const product = await client.createProduct({
      sku: `AUR-${trending.id.toUpperCase()}`,
      name: trending.name,
      category: trending.category,
      description: trending.insight,
      price,
      compareAtPrice: null,
      cost: trending.estimatedUnitCost,
      stock: 0,
      reorderPoint: 10,
      supplierId: "",
      status: payload.activate ? "active" : "draft",
      rating: 0,
      reviewCount: 0,
      weeklyVelocity: [0, 0, 0, 0, 0, 0, 0, 0],
      tags: ["imported", trending.source],
    });
    return {
      outcome: `Imported "${product.name}" as ${product.status} at $${price} (est. margin ${trending.estimatedMarginPct}%). Needs a supplier and stock before fulfillment.`,
      undoable: true,
      undoData: { productId: product.id },
      revenueInfluence: 0,
      before: null,
      after: { sku: product.sku, name: product.name, price: product.price, status: product.status },
      targetRef: `product:${product.id}`,
    };
  },
};

export const undoers: Partial<Record<ActionType, Undoer>> = {
  async update_campaign(client, undoData) {
    const campaign = await client.updateCampaign(String(undoData.campaignId), {
      status: undoData.status as "active" | "paused",
      dailyBudget: Number(undoData.dailyBudget),
    });
    return `Restored campaign "${campaign.name}" to ${campaign.status} at $${campaign.dailyBudget}/day.`;
  },
  async create_campaign(client, undoData) {
    const campaign = await client.updateCampaign(String(undoData.campaignId), { status: "paused" });
    return `Paused campaign "${campaign.name}" (created by Nova, now rolled back).`;
  },
  async publish_social_post(client, undoData) {
    await client.updateSocialPost(String(undoData.postId), {
      status: "draft",
      scheduledFor: null,
      publishedAt: null,
    });
    return "Reverted the post to draft.";
  },
  async update_price(client, undoData) {
    const product = await client.updateProduct(String(undoData.productId), {
      price: Number(undoData.price),
      compareAtPrice: undoData.compareAtPrice === null ? null : Number(undoData.compareAtPrice),
    });
    return `Restored "${product.name}" to $${product.price}.`;
  },
  async create_discount(client, undoData) {
    const discount = await client.updateDiscount(String(undoData.discountId), { active: false });
    return `Deactivated discount ${discount.code}.`;
  },
  async create_purchase_order(client, undoData) {
    const po = await client.updatePurchaseOrder(String(undoData.purchaseOrderId), {
      status: "cancelled",
    });
    return `Cancelled purchase order ${po.id}.`;
  },
  async switch_supplier(client, undoData) {
    const product = await client.updateProduct(String(undoData.productId), {
      supplierId: String(undoData.supplierId),
      cost: Number(undoData.cost),
    });
    return `Restored "${product.name}" to its previous supplier.`;
  },
  async assign_courier(client, undoData) {
    const courierId = undoData.courierId;
    await client.updateOrder({
      id: String(undoData.orderId),
      courierId: courierId === null ? undefined : String(courierId),
    });
    return `Restored the previous courier assignment on order ${String(undoData.orderId)}.`;
  },
  async import_product(client, undoData) {
    await client.updateProduct(String(undoData.productId), { status: "archived" });
    return "Archived the imported product.";
  },
};
