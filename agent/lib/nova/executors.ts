/**
 * Executors — the one place where Nova's actions actually mutate the store.
 *
 * Both direct execution (high autonomy) and owner-approved execution of
 * prepared actions run through this registry, so behavior is identical
 * regardless of how an action was authorized. Executors capture the state
 * needed to undo, which powers the PRD trust system's undo button.
 */

import { randomUUID } from "node:crypto";

import type { ActionType } from "../types";
import type { StoreClient } from "../store/client";
import {
  assignCourierPayload,
  createCampaignPayload,
  createDiscountPayload,
  createPurchaseOrderPayload,
  escalateConversationPayload,
  importProductPayload,
  linkCustomerPayload,
  mergeCustomerRecordsPayload,
  publishSocialPostPayload,
  resolveTicketPayload,
  sendCustomerMessagePayload,
  sendInboxReplyPayload,
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

/**
 * How this execution was authorized. Absent on the direct (autonomous) path;
 * present when a prepared row is being executed because a human said yes.
 *
 * It exists because a few verbs genuinely behave differently once a founder has
 * waited on them — `send_inbox_reply` sends NOW rather than re-entering the
 * shopkeeper pacing engine — and because the approve path already has a stable
 * ledger id, which is the idempotency key both approve surfaces must agree on.
 * Executors that don't care ignore it, which is all of them but one.
 */
export interface ExecutionContext {
  /**
   * The prepared NovaAction's id. Set ONLY on the approve path (the direct path
   * mints the ledger row after execution, so no id exists yet). dakio-api's own
   * approve executor books the send under `action.id` too — same id on both
   * surfaces means the same `Idempotency-Key`, so a Desk tap and a chat approve
   * of one draft collapse into one queued reply instead of two.
   */
  approvedActionId?: string;
}

type Executor = (
  client: StoreClient,
  payload: Record<string, unknown>,
  context?: ExecutionContext,
) => Promise<ExecutionResult>;
type Undoer = (client: StoreClient, undoData: Record<string, unknown>) => Promise<string>;

export const executors: Record<ActionType, Executor> = {
  /**
   * Unreachable by design. `bulk_refund` is founder-only (PRD §5.4), so
   * `evaluateAuthority` refuses it before `performAction` ever reaches an
   * executor — at every level, on every path.
   *
   * It throws rather than returning something harmless because arriving here
   * would mean the founder-only classification had been bypassed, and the
   * correct response to "the safety gate didn't run" is a loud crash, not a
   * quiet refund. The founder-side execution path lands with phase 08's
   * approve transaction and a real dakio-api refund endpoint.
   */
  async bulk_refund() {
    throw new Error(
      "bulk_refund reached an executor — the founder-only gate did not run. This is a bug in the authority seam, not a refund to retry.",
    );
  },

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
      changes.push(`daily budget ৳${prior.dailyBudget} → ৳${payload.dailyBudget}`);
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
      outcome: `Created ${campaign.status} ${campaign.channel} campaign "${campaign.name}" at ৳${campaign.dailyBudget}/day.`,
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
      outcome: `Repriced "${updated.name}" ৳${prior.price} → ৳${payload.newPrice}.`,
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

  /**
   * The only path to a customer-visible byte on Messenger/Instagram.
   *
   * Note what this executor does NOT do: it does not send. It hands the
   * bubbles to dakio-api, which owns the thread lock, the 24h window, the
   * loop cap, the human-timing engine and the page token, and which can
   * refuse — in which case {@link InboxSendRefused} propagates and NOTHING is
   * recorded as executed. A message the customer will never see must never
   * read as a message that was sent.
   */
  async send_inbox_reply(client, raw, context) {
    const payload = sendInboxReplyPayload.parse(raw);
    // The id this send is booked under, stable across the client's retries so
    // a network timeout cannot queue the reply twice. On the approve path it is
    // the prepared row's own id — the SAME id dakio-api's Decision-Desk
    // executor uses — so approving one draft twice (desk tab + chat) hits one
    // `Idempotency-Key` and queues one reply. On the direct path the ledger row
    // does not exist yet, so a fresh id is minted and stamped onto the same
    // target afterwards by `attributeDoorRecord`, which is how the /inbox
    // bubble gets its BY NOVA receipt drawer.
    const approved = typeof context?.approvedActionId === "string" && context.approvedActionId.length > 0;
    const novaActionId = approved ? context!.approvedActionId! : randomUUID();
    const result = await client.replyInThread(payload.conversationId, {
      chunks: payload.chunks,
      novaActionId,
      inReplyToMessageId: payload.inReplyToMessageId,
      intent: payload.intent,
      language: payload.language,
      purpose: payload.purpose ?? null,
      // D7: an approved draft sends immediately — the founder already waited,
      // and re-entering the pacing engine would hold a deliberately released
      // reply behind the hour bands (at 02:00 with nightMode 'off', until the
      // 07:00 batch, on a thread whose 24h window may close first). dakio-api's
      // approve executor hard-sets the same thing; without this line the two
      // approve surfaces send observably differently from one decision.
      // Pacing on the LIVE path is the server's alone — nothing the model wrote
      // reaches this field (see `sendInboxReplyPayload`).
      ...(approved ? { timing: { mode: "instant" as const } } : {}),
      ...(payload.disclosure ? { disclosure: payload.disclosure } : {}),
      // D7: the declared commitment rides the SAME request as the bubbles, so
      // dakio-api writes the NovaPromise row inside the outbound's transaction
      // and deletes it if the send is later canceled. This body is assembled
      // field by field — a field added to the zod schema and not to this list
      // is a field the model fills and the server never sees.
      ...(payload.promise ? { promise: payload.promise } : {}),
    });
    const bubbles = result.chunks.length;
    return {
      outcome: `Queued ${bubbles} ${bubbles === 1 ? "message" : "messages"} to the customer (${payload.language}, ${payload.intent}), first one due ${result.scheduledAt}.`,
      // Sent is sent. There is no unsend on Messenger, and pretending
      // otherwise would put an undo button on a promise we can't keep.
      undoable: false,
      undoData: null,
      // A reply claims no revenue — orders do (module 05). Attribution stays
      // honest by refusing to book credit for a conversation.
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: {
        outboundId: result.outboundId,
        bubbles,
        scheduledAt: result.scheduledAt,
        intent: payload.intent,
        language: payload.language,
        purpose: payload.purpose ?? null,
      },
      targetRef: `inbox_message:${result.firstMessageId}`,
    };
  },

  /**
   * Hand the thread to the founder. The route shipped in module 02 and really
   * does lock Nova out: `escalatedAt` + `handledBy:'founder'`, after which
   * every `/reply` on the thread is refused LOCKED with no release path in
   * this module. What module 08 still owns is the priority-1 Decision
   * (`decisionId:null` today) and the deterministic holding line
   * (`holdingSent:false`) — the outcome string below only claims the customer
   * was told something when the route says it was.
   */
  async escalate_conversation(client, raw) {
    const payload = escalateConversationPayload.parse(raw);
    const result = await client.handoverConversation(payload.conversationId, {
      novaActionId: randomUUID(),
      reason: payload.reason,
      department: payload.department,
      summary: payload.summary,
      summaryBn: payload.summaryBn,
      ...(payload.suggestedReply ? { suggestedReply: payload.suggestedReply } : {}),
      ...(payload.suggestedAction ? { suggestedAction: payload.suggestedAction } : {}),
      factsChecked: payload.factsChecked,
    });
    return {
      outcome: result.alreadyEscalated
        ? `Conversation ${payload.conversationId} was already with you (${payload.reason}); the brief was updated rather than asking twice.`
        : `Handed conversation ${payload.conversationId} to you — ${payload.reason}, ${payload.department}.${result.holdingSent ? " The customer was told someone is looking at it." : ""}`,
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: {
        reason: payload.reason,
        department: payload.department,
        decisionId: result.decisionId,
        holdingSent: result.holdingSent,
      },
      targetRef: `inbox_conversation:${payload.conversationId}`,
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
      outcome: `Placed PO ${po.id}: ${payload.quantity} × ${product.name} from ${supplier.name} at ৳${unitCost}/unit (৳${po.total} total, ETA ${leadTimeDays}d).`,
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
      outcome: `Switched "${product.name}" to ${supplier.name} at ৳${offer.unitCost}/unit (${
        delta >= 0 ? `saves ৳${delta.toFixed(2)}` : `costs ৳${(-delta).toFixed(2)} more`
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
      outcome: `Imported "${product.name}" as ${product.status} at ৳${price} (est. margin ${trending.estimatedMarginPct}%). Needs a supplier and stock before fulfillment.`,
      undoable: true,
      undoData: { productId: product.id },
      revenueInfluence: 0,
      before: null,
      after: { sku: product.sku, name: product.name, price: product.price, status: product.status },
      targetRef: `product:${product.id}`,
    };
  },

  /**
   * Module 03 D4. The MODEL never resolves identity — this hands the server a
   * self-stated phone or a digit check and the server answers.
   *
   * `matched:false` is a legitimate OUTCOME, not an error: zero matches stores
   * `claimedPhone` so the join materializes later when an order creates the
   * Customer, and a multi-match deliberately leaves the conversation UNLINKED
   * and proposes a merge Decision instead. Ambiguity resolves to "unknown
   * customer", always — which is why none of the three branches below throws.
   */
  async link_customer_identity(client, raw) {
    const payload = linkCustomerPayload.parse(raw);
    const novaActionId = randomUUID();
    const result = await client.linkCustomer(payload.conversationId, {
      novaActionId,
      ...(payload.phone ? { phone: payload.phone } : {}),
      ...(payload.verify ? { verify: payload.verify } : {}),
    });
    return {
      outcome: result.matched
        ? `Linked this conversation to customer ${result.customerId}${result.channelWritten ? " and recorded the channel as a verified address" : ""}.`
        : result.mergeProposed
          ? "That number matches more than one customer record, so nothing was linked — a merge decision is with the founder."
          : payload.verify
            // The two failure arms are DIFFERENT facts and the ledger row is
            // founder-readable, so they may not share a sentence. Nothing is
            // held on a failed digit check: the server cleared the proposal and
            // burned that candidate for this thread (D3, one attempt), so a
            // line promising a number "held for when an order creates the
            // record" would describe a state that does not exist.
            ? "The digits given did not match the record on file, so nothing was linked — the thread stays unlinked and that candidate is not asked again."
            : "No customer matched that number; the thread stays unlinked and the number is held for when an order creates the record.",
      // D4: the undo clears customerId/customerLinkedAt/customerLinkSource and
      // LEAVES the CustomerChannel row alone — the address is factually
      // verified, and removing it would forget something true.
      undoable: true,
      // `kind` is what dakio-api's `runUndo` dispatches on — it looks the
      // inverse up in `UNDO[undoData.kind]` (`src/lib/novaExecutors.js`), NOT by
      // verb name, so an undoData without it reaches a founder pressing Undo on
      // the Decision Desk as "No inverse is defined for undefined". The
      // receiving half is `UNDO.unlink_customer`; this key is the only thing
      // that connects the two, and `evals/inbox/identity.ts` [7] pins the pair
      // by reading that map across the repo boundary.
      //
      // nova-ai's own `undoers` map below stays keyed by VERB name, because
      // `scripts/check-undo-coverage.ts` matches undoer keys against executor
      // names in both directions. Two maps, two keying schemes, both correct.
      undoData: { kind: "unlink_customer", conversationId: payload.conversationId },
      // A link claims no revenue. Orders do (module 05).
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: {
        matched: result.matched,
        customerId: result.customerId ?? null,
        channelWritten: result.channelWritten,
      },
      targetRef: `inbox_conversation:${payload.conversationId}`,
    };
  },

  /**
   * Module 03 D5. Always reached through an approved Decision (`ALWAYS_DRAFT`
   * in authority.ts), never mid-conversation. The SURVIVOR is chosen
   * server-side — more orders, tie → older — so this verb names the pair and
   * dakio-api does the transactional repoint. Not undoable, which is exactly
   * why it always drafts: the signature is the only safety there is.
   */
  async merge_customer_records(client, raw) {
    const payload = mergeCustomerRecordsPayload.parse(raw);
    const result = await client.mergeCustomers({
      customerIdA: payload.customerIdA,
      customerIdB: payload.customerIdB,
      basis: payload.basis,
    });
    return {
      outcome: `Merged two customer records into ${result.survivorCustomerId} — ${result.ordersMoved} orders, ${result.channelsMoved} channels, ${result.conversationsMoved} conversations and ${result.promisesMoved} promises now point at one person.`,
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      relatedId: result.survivorCustomerId,
      before: null,
      after: {
        survivorCustomerId: result.survivorCustomerId,
        mergedCustomerId: result.mergedCustomerId,
        ordersMoved: result.ordersMoved,
        channelsMoved: result.channelsMoved,
        conversationsMoved: result.conversationsMoved,
        promisesMoved: result.promisesMoved,
      },
      // `customer:<id>` is NOT in dakio-api's ATTRIBUTABLE map
      // (src/lib/novaLedger.js), so `attributeDoorRecord` no-ops with
      // {attributed:false} — correct: there is no door record to stamp.
      targetRef: `customer:${result.survivorCustomerId}`,
    };
  },
};

export const undoers: Partial<Record<ActionType, Undoer>> = {
  async update_campaign(client, undoData) {
    const campaign = await client.updateCampaign(String(undoData.campaignId), {
      status: undoData.status as "active" | "paused",
      dailyBudget: Number(undoData.dailyBudget),
    });
    return `Restored campaign "${campaign.name}" to ${campaign.status} at ৳${campaign.dailyBudget}/day.`;
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
    return `Restored "${product.name}" to ৳${product.price}.`;
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
  /**
   * Module 03 D4. Keyed by the VERB name, like every entry here — not by
   * `undoData.kind`. dakio-api's own `UNDO` map (`src/lib/novaExecutors.js`)
   * keys the same inverse as `unlink_customer` because it dispatches on the
   * stored `undoData.kind`; two maps, two keying schemes, both correct. Do not
   * "fix" either to match the other — `scripts/check-undo-coverage.ts` matches
   * this map's keys against the executor block names in both directions.
   *
   * `merge_customer_records` registers NO undoer, deliberately: it returns
   * `undoable: false`, and a dead inverse fails the same check.
   */
  async link_customer_identity(client, undoData) {
    const conversationId = String(undoData.conversationId);
    await client.unlinkCustomer(conversationId);
    return `Unlinked conversation ${conversationId} — the verified channel address was kept, only the identity join was removed.`;
  },
};
