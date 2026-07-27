/**
 * Executors — the one place where Nova's actions actually mutate the store.
 *
 * Both direct execution (high autonomy) and owner-approved execution of
 * prepared actions run through this registry, so behavior is identical
 * regardless of how an action was authorized. Executors capture the state
 * needed to undo, which powers the PRD trust system's undo button.
 */

import { randomUUID } from "node:crypto";

import type { ActionType, InboxHandoverResult, OrderStatus } from "../types";
import { InboxSendRefused, type StoreClient } from "../store/client";
import {
  assignCourierPayload,
  cancelOrderPayload,
  confirmOrderIntentPayload,
  createCampaignPayload,
  createDiscountPayload,
  createOrderFromChatPayload,
  createPurchaseOrderPayload,
  escalateConversationPayload,
  flagCourierIssuePayload,
  importProductPayload,
  linkCustomerPayload,
  mergeCustomerRecordsPayload,
  offerChatDiscountPayload,
  openCasePayload,
  publishSocialPostPayload,
  resolveTicketPayload,
  scheduleFollowUpPayload,
  sendCustomerMessagePayload,
  sendInboxReplyPayload,
  switchSupplierPayload,
  updateCampaignPayload,
  updateOrderContactPayload,
  updatePricePayload,
  verifyPaymentSlipPayload,
} from "./schemas";

/** ৳, grouped the way a Bangladeshi founder reads a number. */
function taka(amount: number): string {
  return `৳${Math.round(amount).toLocaleString("en-IN")}`;
}

/**
 * The alphabet a chat coupon code is drawn from (module 05 D6).
 *
 * No `0`, `O`, `1`, `I` or `L`: the customer reads this code off a Messenger
 * bubble and types it into a storefront checkout, and a code nobody can
 * transcribe is a discount that was never given. That is also why it is short.
 */
const COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Mint a code for a chat-issued coupon.
 *
 * The MODEL never names it — `offerChatDiscountPayload` has no `code` field, on
 * purpose. A model that could choose the code could be talked into re-issuing
 * one the shop already uses in a campaign, and a coupon is the only lever these
 * verbs have on price.
 *
 * `@@unique([tenantId, code])` means a collision is a P2002 the route surfaces
 * as a failed action: no coupon is minted and the customer is told no code, so
 * a rare clash is a retry the founder can see rather than a second person's
 * discount handed out by accident.
 */
function mintCouponCode(random: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < 6; i += 1) {
    body += COUPON_ALPHABET[Math.floor(random() * COUPON_ALPHABET.length)];
  }
  return `NOVA${body}`;
}

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

  /* ── Stage 10 module 05 — the three selling verbs ─────────────────────────
   *
   * The prologue owns the shared declaration surface (the `ActionType` union,
   * the zod payloads, RISK_CLASS, MINUTES_BY_ACTION, TARGET_TEXT, ALWAYS_DRAFT,
   * the duties) and landed these three as throwing stubs, because `executors`
   * is `Record<ActionType, Executor>` — TOTAL — so a verb name and its block
   * have to arrive in the same commit or the repo stops compiling for every
   * other stream. These are the bodies.
   *
   * A TRAP IN THE CI CHECK, worth keeping written down because it cost a build
   * once. `scripts/check-undo-coverage.ts` is a TEXT parser: it slices this
   * object on `async <name>(` and regex-searches each slice for the undoable
   * flag set to true. A comment sitting between two verbs belongs to the
   * PRECEDING verb's slice — so spelling that flag out literally in prose next
   * to an irreversible verb makes the checker demand an inverse for it.
   * Describe the flag; never write it out here.
   */

  /**
   * Module 05 D4/D5. Turn a confirmed chat into a real COD order.
   *
   * THE SERVER PRICES IT. Nothing on the payload carries money — no `discount`,
   * no `paid`, no `unitPrice`, no `total` — so the only figures below are ones
   * dakio-api computed from the catalogue, the district's own delivery charge
   * and a coupon it re-validated. The merchant order route accepts a raw client
   * `discount` that flows unvalidated into the total; that is the lever this
   * verb exists not to have.
   *
   * ONE ORDER, EVER, per `novaActionId`. On the approve path the prepared row's
   * id is the stable key both approve surfaces already agree on, so a Desk tap
   * and a chat approve of one draft place ONE parcel; on the direct path a
   * fresh id is minted and held for this call's retries. That id is not just an
   * idempotency-cache key — `w()` is not a mutex, and the route's real
   * at-most-once control is a conditional read-back on `Order.novaActionId`
   * before insert, which a per-attempt id would defeat at both layers.
   *
   * Refusals PROPAGATE, as {@link InboxSendRefused}. Out of stock, the
   * fake-order guard, a plan cap, a coupon that does not hold — every one is an
   * answer the customer is owed, and an order the server declined must never be
   * recorded as one Nova placed. The person at the other end has been told a
   * total and is waiting for a number.
   */
  async create_order_from_chat(client, raw, context) {
    const payload = createOrderFromChatPayload.parse(raw);
    const approved = typeof context?.approvedActionId === "string" && context.approvedActionId.length > 0;
    const novaActionId = approved ? context!.approvedActionId! : randomUUID();
    const order = await client.createChatOrder({
      // Named for the COLUMN, not for the concept: `Order.sourceConversationId`
      // is a plain string with no FK because Meta's data-deletion callback hard-
      // deletes conversations, and the route also derives the identity join and
      // `sourceChannel` from it.
      sourceConversationId: payload.conversationId,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      customerCity: payload.customerCity,
      customerDistrict: payload.customerDistrict,
      ...(payload.customerAddress ? { customerAddress: payload.customerAddress } : {}),
      // `productName` is dropped on purpose: it is the text a no-touch lock is
      // matched against and what the founder's card displays, and the server
      // prices from `productId` alone. Sending it would invite a reader to
      // think the name selects the product.
      items: payload.items.map((item) => ({
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        qty: item.qty,
      })),
      ...(payload.couponCode ? { couponCode: payload.couponCode } : {}),
      novaActionId,
    });
    const units = payload.items.reduce((sum, item) => sum + item.qty, 0);
    return {
      // Founder-facing, and it leads with the two facts that decide whether
      // they approve: what it costs and where it is going. The phone is NOT in
      // it — the ledger row is read on screens the 360 deliberately masks a
      // number on, and a full number typed into a title outlives that decision.
      outcome:
        `Order ${order.orderNumber} — ${taka(order.codAmount)} to collect on delivery, ` +
        `${units} item${units === 1 ? "" : "s"} to ${payload.customerCity}, ${payload.customerDistrict} ` +
        `(order total ${taka(order.total)}, delivery ${taka(order.shippingCharge)}` +
        (payload.couponCode ? `, coupon ${payload.couponCode}` : "") +
        `).`,
      undoable: true,
      // `kind` is what dakio-api's `runUndo` dispatches on — it looks the
      // inverse up in `UNDO[undoData.kind]` (`src/lib/novaExecutors.js`), NOT by
      // verb name. An undoData without it reaches a founder pressing Undo on the
      // Decision Desk as "No inverse is defined for undefined" — the bug commit
      // 79d5d83 fixed on `link_customer_identity` and that recurred on
      // `schedule_follow_up`. The receiving half is `UNDO.cancel_chat_order`;
      // this key is the only thing that connects the two.
      //
      // nova-ai's own `undoers` map below stays keyed by VERB name, because
      // `scripts/check-undo-coverage.ts` matches undoer keys against executor
      // names in both directions. Two maps, two keying schemes, both correct.
      //
      // `orderNumber` rides along so the undo can say WHICH order it cancelled
      // in words the founder recognises — they know `#00412`, not a cuid.
      undoData: { kind: "cancel_chat_order", orderId: order.id, orderNumber: order.orderNumber },
      // The one verb in this phase that genuinely claims revenue, and it claims
      // the order's own total — not an estimate. `link_customer_identity` says
      // "a link claims no revenue; orders do", and this is the order.
      revenueInfluence: order.total,
      relatedId: order.id,
      before: null,
      after: {
        orderNumber: order.orderNumber,
        shippingCharge: order.shippingCharge,
        total: order.total,
        // What the courier collects, from `Order.due` — not the total. The two
        // diverge the moment an advance is recorded, and this is the number a
        // founder checks against a consignment.
        codAmount: order.codAmount,
        status: order.status,
        customerId: order.customerId,
        // May be null: it needs a verified custom domain or a configured
        // storefront base, and a path-based store only gets the tracking FORM.
        trackingUrl: order.trackingUrl,
      },
      targetRef: `order:${order.id}`,
    };
  },

  /**
   * Module 05 D6. Answer a haggle with a bounded, expiring coupon.
   *
   * A discount is ALWAYS a Coupon row and NEVER a price change. `update_price`
   * is a store-wide act with its own margin guardrail; answering one customer's
   * "ektu kom hoy na?" by repricing the product silently discounts every other
   * customer buying it that day, and no receipt anywhere records that it was
   * meant for one person.
   *
   * `maxUses: 1` is how "issued to this customer" is expressed, because dakio-
   * api's `Coupon` has NO `customerId` column at all. The per-customer
   * frequency rule the founder set (`inbox.discountPerCustomerDays`) is
   * enforced against the NovaAction ledger instead, and the route 422s unless
   * this call carries a `customerId` OR a `conversationId` to match on — a
   * guard with nothing to match on passes every time, which is worse than no
   * guard because it reads as enforced.
   *
   * `free_delivery` carries no amount on the model's payload — the delivery
   * table is not something the model is told. It is resolved HERE, from the
   * shop's own settings, and to the OUTSIDE-Dhaka charge: a coupon smaller than
   * the real charge means a customer who was promised free delivery in the
   * thread still pays part of it at the door, which is a broken promise in
   * front of a courier. Over-covering costs the shop the difference on an
   * inside-Dhaka parcel, and the founder sees that figure on the card before
   * approving — `inbox.discountAuto` ships false, so every one of these drafts.
   */
  async offer_chat_discount(client, raw, context) {
    const payload = offerChatDiscountPayload.parse(raw);
    const approved = typeof context?.approvedActionId === "string" && context.approvedActionId.length > 0;
    const novaActionId = approved ? context!.approvedActionId! : randomUUID();
    const expiresAt = new Date(
      Date.parse(client.now()) + payload.expiresHours * 60 * 60 * 1000,
    ).toISOString();
    const freeDelivery =
      payload.mechanism === "free_delivery"
        ? (await client.getStoreSettings()).deliveryOutsideDhaka
        : 0;
    const discount = await client.createDiscount({
      code: mintCouponCode(),
      type: payload.mechanism === "percent" ? "PERCENT" : "FIXED",
      ...(payload.mechanism === "percent"
        ? { percentOff: payload.percentOff }
        : { amount: payload.mechanism === "fixed" ? payload.amount : freeDelivery }),
      expiresAt,
      active: true,
      // One redemption. A chat coupon any customer could use is a public
      // discount minted in a private negotiation.
      maxUses: 1,
      // Attribution AND the frequency guard's trigger: the route only runs the
      // once-per-N-days lookup when this is present.
      novaActionId,
      // The identity to match on. `customerId` when the thread is linked, and
      // the thread itself otherwise — a conversation is a person even before
      // the identity join has earned them a Customer row, and requiring the id
      // outright would push the common case into the fail-open branch.
      ...(payload.customerId ? { customerId: payload.customerId } : {}),
      conversationId: payload.conversationId,
    });
    const offer =
      payload.mechanism === "percent"
        ? `${payload.percentOff}% off`
        : payload.mechanism === "fixed"
          ? `${taka(payload.amount ?? 0)} off`
          : `free delivery (${taka(freeDelivery)} off)`;
    return {
      outcome: `Issued coupon ${discount.code} — ${offer}, one use, expires in ${payload.expiresHours}h. ${payload.reason}`,
      undoable: true,
      // Same two-maps arrangement as the order above. The receiving half is
      // `UNDO.deactivate_chat_discount`; deactivating is the only honest
      // inverse, because a code that has already been redeemed cannot be
      // un-given and deleting the row would erase the receipt for a discount
      // somebody really got.
      //
      // `couponId`, NOT this repo's usual `discountId`, and that is deliberate:
      // `undoData` is a WIRE payload. It is posted to dakio-api with the action
      // and read back by whichever surface the founder presses Undo on, so it is
      // dakio-api's vocabulary that decides the field name — `UNDO.delete_coupon`
      // and `UNDO.deactivate_chat_discount` both destructure `{ couponId }` and
      // the second one THROWS `undoData.couponId is required` on anything else.
      // "Discount" is this repo's word for the same Coupon row; using it here
      // would leave the founder pressing Undo on the Desk and being told the
      // coupon id is missing, which is the exact failure the two-maps comment
      // above exists to prevent and which has already shipped twice.
      undoData: { kind: "deactivate_chat_discount", couponId: discount.id, code: discount.code },
      // Zero, on module 04's direct-cause rule: the order this may help close is
      // attributed to the order, not to the offer that preceded it. A coupon
      // does not get credit for existing.
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: {
        code: discount.code,
        mechanism: payload.mechanism,
        percentOff: discount.percentOff,
        amount: discount.amount ?? null,
        expiresAt,
        maxUses: 1,
      },
      // `coupon:<id>` IS in dakio-api's ATTRIBUTABLE map, so `attributeDoorRecord`
      // stamps `Coupon.novaActionId` and the Coupons door renders the by:nova
      // chip with this action's receipt behind it.
      targetRef: `coupon:${discount.id}`,
    };
  },

  /**
   * Module 05 D7. File what the customer CLAIMED about a payment. Read the verb
   * name honestly: it verifies nothing, and it must never look like it did.
   *
   * Dakio has no payment-gateway API and Meta attachments are lossy, so nothing
   * in this system can read a bKash screenshot and know money moved. So this
   * writes NO store record: it does not touch `Order.paid`, it does not advance
   * a status, and it moves no money. The NovaAction row it lands on — payload,
   * receipt and evidence — IS the filed claim, and the founder's approval is
   * the acknowledgement that they have seen it and will judge it against a real
   * statement.
   *
   * It is in `ALWAYS_DRAFT` in BOTH repos for exactly this reason, and the
   * mirror is not optional: `riskClass: "high"` still EXECUTES at level 4, and
   * level 4 is reachable on a good trust record. A store that auto-"verified" a
   * payment would be telling a customer their money arrived on the strength of
   * a picture — and in a COD market the correction lands at the door, with a
   * courier holding a parcel nobody will pay for.
   *
   * The sentence below deliberately matches what dakio-api's ADVISORY branch
   * says on the Desk approve path ("recommendation accepted; no automated store
   * change"). One verb, two approve surfaces, one true statement.
   */
  async verify_payment_slip(client, raw) {
    const payload = verifyPaymentSlipPayload.parse(raw);
    const against = payload.orderId ? `order ${payload.orderId}` : "no matched order";
    const amount = payload.claimedAmount != null ? ` for ${taka(payload.claimedAmount)}` : "";
    const trx = payload.trxId ? ` trx ${payload.trxId}` : " no transaction id given";
    return {
      outcome:
        `Payment CLAIM recorded: ${payload.method}${amount},${trx}, against ${against}. ` +
        `Nothing was verified and no store record changed — the order's paid amount is untouched. ` +
        `Match it against your own ${payload.method} statement before you treat it as received.`,
      undoable: false,
      undoData: null,
      // A claim moves no money and closes no sale, so it influences no revenue.
      // Recording the claimed amount here would put a number the shop has not
      // received into the activity metrics.
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: {
        method: payload.method,
        trxId: payload.trxId ?? null,
        claimedAmount: payload.claimedAmount ?? null,
        orderId: payload.orderId ?? null,
        attachmentUrl: payload.attachmentUrl ?? null,
        // The customer's own words are the evidence the founder judges. Kept
        // verbatim: a summary of a payment claim is a summary of the only thing
        // anybody can check.
        customerStatement: payload.customerStatement,
        verified: false,
      },
      // `inbox_conversation:<id>` is NOT in dakio-api's ATTRIBUTABLE map, so
      // `attributeDoorRecord` no-ops — correct, and deliberately not
      // `order:<id>`: stamping the order with this action id would make the
      // Orders door render a by:nova chip claiming Nova touched that sale.
      targetRef: `inbox_conversation:${payload.conversationId}`,
    };
  },

  // ── Stage 10 module 06 — delivery coordination ──────────────────────────

  /**
   * Open a case, or join the one already open for this parcel.
   *
   * `joined` is why this returns what it does. One problem gets one case however
   * many people ask about it, and the OUTCOME sentence says which happened —
   * a founder reading "opened a case" for the third time about one parcel would
   * rightly conclude Nova is not paying attention.
   */
  async open_case(client, raw, context) {
    const payload = openCasePayload.parse(raw);
    const { case: c, joined } = await client.openCase({
      ...payload,
      novaActionId: context?.approvedActionId,
    });
    const asking = (c.refs.conversationIds ?? []).length;
    return {
      outcome: joined
        ? `Joined the open ${c.kind.replace(/_/g, " ")} case for this — "${c.title}" — and added what this customer said. ` +
          `${asking} conversation${asking === 1 ? "" : "s"} now asking about it, and they all get the same answer.`
        : `Opened a ${c.kind.replace(/_/g, " ")} case with the ${c.department} room: "${c.title}".`,
      // A case is CLOSED with a resolution sentence, never deleted. Module 09
      // counts these rows, so a vanished case is a vanished number — and an
      // undo that erased the record of a problem is the one kind this system
      // must not offer.
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: { caseId: c.id, kind: c.kind, department: c.department, status: c.status, joined },
      targetRef: `case:${c.id}`,
    };
  },

  /**
   * Put the phone call in front of the person who can make it.
   *
   * THIS VERB CHANGES NOTHING, and that is the honest shape of what Dakio can
   * do rather than something to apologise for. Against Steadfast, RedX and
   * Pathao we can book a parcel, cancel a parcel, poll its status and receive
   * webhooks — we cannot reschedule, redirect or hold one. So "intervening"
   * with a courier means a human ringing the hub, and what software can usefully
   * do is make sure they ring it holding the tracking id, the last scan, the
   * expected COD and what the customer was already told, instead of assembling
   * all of that first.
   *
   * `ALWAYS_DRAFT` in `authority.ts` is what makes this reach a founder rather
   * than auto-executing into nobody's inbox.
   */
  async flag_courier_issue(client, raw) {
    const payload = flagCourierIssuePayload.parse(raw);
    await client.patchCase(payload.caseId, {
      status: "waiting_founder",
      appendFacts: [{
        source: "nova",
        note: `Flagged for the owner: ${payload.reason} — suggested ask: ${payload.recommendation}`,
        data: { courierType: payload.courierType, trackingId: payload.trackingId },
      }],
    });
    return {
      outcome:
        `Ready for your call to ${payload.courierType}: tracking ${payload.trackingId} on order ${payload.orderId}. ` +
        `${payload.reason} Suggested ask: ${payload.recommendation}. ` +
        `Dakio cannot reschedule or redirect a parcel at any courier — approving this records that you are handling it, it does not contact anyone.`,
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      relatedId: payload.caseId,
      before: null,
      after: {
        courierType: payload.courierType,
        trackingId: payload.trackingId,
        reason: payload.reason,
        recommendation: payload.recommendation,
        contactedCourier: false,
      },
      targetRef: `case:${payload.caseId}`,
    };
  },

  /**
   * Record that the customer confirmed their order, pre-dispatch.
   *
   * The highest-value ping in the product: an unconfirmed COD parcel is the one
   * that comes back. `confirmedText` is the customer's OWN words and is
   * evidence-grade — the server writes `confirmedAt` off it, and a confirmation
   * inferred from an emoji would be a shop claiming a human said yes when they
   * did not.
   */
  async confirm_order_intent(client, raw, context) {
    const payload = confirmOrderIntentPayload.parse(raw);
    const order = await client.updateOrderDelivery(payload.orderId, {
      confirm: true,
      confirmedByActionId: context?.approvedActionId,
    });
    return {
      outcome:
        `Order ${payload.orderId} confirmed with the customer — they said "${payload.confirmedText}". ` +
        `It is marked confirmed for dispatch.`,
      // `confirmedAt` records that a human said yes. Un-saying it is not
      // something software gets to do; an address change resets it, and that is
      // a different event with its own reason.
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: { orderId: order.id, confirmedText: payload.confirmedText },
      targetRef: `order:${payload.orderId}`,
    };
  },

  /**
   * Fix the address or phone before the parcel goes.
   *
   * PRE-DISPATCH ONLY, enforced by the server — once the courier has the parcel
   * the label is theirs. A district change RE-PRICES the order, and any contact
   * change RESETS the confirmation: the customer said yes to a specific address
   * and a specific total, so changing either makes that yes about something that
   * no longer exists.
   */
  async update_order_contact(client, raw) {
    const payload = updateOrderContactPayload.parse(raw);
    const changed = (["address", "city", "district", "phone"] as const).filter(
      (k) => payload[k] !== undefined,
    );
    const order = await client.updateOrderDelivery(payload.orderId, {
      address: payload.address,
      city: payload.city,
      district: payload.district,
      phone: payload.phone,
    });
    return {
      outcome:
        `Updated ${changed.join(", ")} on order ${payload.orderId} before dispatch.` +
        (payload.district
          ? " The district changed, so the delivery charge and total were recalculated — re-confirm the new total with the customer."
          : " The order needs re-confirming with the customer before it goes."),
      // The previous address is in the case facts. An undo here would mean
      // shipping to an address the customer has already said is wrong.
      undoable: false,
      undoData: null,
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: { orderId: order.id, changed },
      targetRef: `order:${payload.orderId}`,
    };
  },

  /**
   * Cancel an order the customer no longer wants.
   *
   * Gated by `inbox.cancelAuto`, which ships false — so on every store today
   * this reaches the founder as a decision. The reason is kept in the
   * customer's own words, because it is the only record of why a sale went away.
   */
  async cancel_order_from_chat(client, raw) {
    const payload = cancelOrderPayload.parse(raw);
    const before = await client.getOrder(payload.orderId);
    await client.updateOrderDelivery(payload.orderId, { status: "cancelled" });
    return {
      outcome:
        `Cancelled order ${payload.orderId} at the customer's request: "${payload.reason}". ` +
        `If it was already booked with the courier, cancel the parcel too.`,
      undoable: true,
      undoData: {
        // The `kind` string is the ONLY bridge between this repo's verb-keyed
        // undoers and dakio-api's kind-keyed UNDO map. Getting it wrong reaches
        // a founder as "No inverse is defined for undefined" — which has
        // shipped twice.
        kind: "uncancel_chat_order",
        orderId: payload.orderId,
        previousStatus: before?.status ?? "placed",
      },
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: before ? { status: before.status } : null,
      after: { orderId: payload.orderId, status: "cancelled", reason: payload.reason },
      targetRef: `order:${payload.orderId}`,
    };
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
   *
   * It is also where a promise is PAID (module 03 D7). Declaring a debt and
   * settling one are the two halves of the same ledger, and both ride this one
   * request: `payload.promise` opens a NovaPromise row inside the outbound's
   * transaction, and `promiseId` on a later reply claims an existing row kept.
   */
  async send_inbox_reply(client, raw, context) {
    const payload = sendInboxReplyPayload.parse(raw);
    // ---- the fulfilment half (module 03 D7) ---------------------------------
    //
    // Which open promise, if any, THIS reply pays back. Read off the PARSED
    // payload: `promiseId` is a declared field on `sendInboxReplyPayload`, and
    // it has to be — zod strips unknown keys, so reading `raw` would be the
    // only way to see a field the schema does not declare, and a field the
    // schema does not declare is one the model is never shown.
    //
    // `open → kept` has exactly two entry points server-side and both need a
    // `keptActionId`: `PATCH /promises/:id` records the claim, and
    // `onOutboundSent` flips the row once Graph confirms the send that claim
    // points at. Nothing in this repo wrote that id before this line existed, so
    // every declared promise aged past its grace window and `runPromiseSweep`
    // marked it `broken` — the founder's desk filling with "Promise broken — X
    // is still waiting" cards about promises Nova answered on time, Nova
    // apologising to customers for debts it had paid (`broken_promise_recent`
    // reaches the 360, and rule 16 makes it own the miss before selling), and
    // `inbox.promise.kept_rate` — the metric this module is named for, computed
    // from these rows per D-37 — reading 0% forever.
    //
    // The four hops this needs are all wired: `promiseId` on
    // `sendInboxReplyPayload` (schemas.ts — without it zod would strip the key
    // before it ever reached here), the tool description and hard rule 16 that
    // tell the model when to set it, and the fulfilment turn's own prompt in
    // `dispatchJobToChannel`. A field the model is never told to fill is a field
    // it never fills, so the schema alone would not have been enough.
    //
    // This executor half decides what "kept" MEANS, and both approve surfaces
    // share it — which is why the settle lives here and not in the tool.
    const fulfilsPromiseId = payload.promiseId?.trim() ?? "";

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

    // The claim is made with the SAME `novaActionId` the reply was booked
    // under, because that is what the route resolves to PROOF: the outbound
    // behind that action being `sent`/`partial` keeps the promise now, a
    // `queued`/`sending` one ARMS it (the row stays `open` and `onOutboundSent`
    // flips it when Graph confirms), and a `canceled`/`failed` one is refused
    // 409 NOT_SENT. So this call can never turn an undelivered reply into a kept
    // promise — the server decides, exactly the way it decides identity. Arming
    // is the normal outcome here, since `replyInThread` returns at QUEUE time,
    // seconds to minutes before the bubbles land.
    let promiseOutcome = "";
    let promiseStatus: string | null = null;
    if (fulfilsPromiseId) {
      try {
        const settled = await client.settlePromise(fulfilsPromiseId, {
          status: "kept",
          keptActionId: novaActionId,
        });
        // The RETURNED row is the authority, never the request: asking to keep
        // and having kept are different facts, and only the server knows which
        // one happened.
        promiseStatus = settled.promise.status;
        promiseOutcome =
          settled.promise.status === "kept"
            ? ` Promise ${fulfilsPromiseId} settled kept.`
            : ` Promise ${fulfilsPromiseId} is claimed against this reply and settles kept the moment the send is confirmed.`;
      } catch (err) {
        // A failed settle does NOT un-send the reply, so it must not fail the
        // action. Throwing here would record nothing executed for bubbles that
        // are already queued — the mirror of this executor's own rule that a
        // message the customer will never see must never read as sent. The
        // usual cause is a 409 the route means as an ANSWER (ALREADY_SETTLED —
        // the sweep got there first; SWEEP_ONLY; NOT_SENT), so the honest record
        // is "replied, debt still open, here is why".
        promiseStatus = "unsettled";
        promiseOutcome = ` The reply went out but promise ${fulfilsPromiseId} was NOT settled (${
          err instanceof InboxSendRefused ? err.code : String(err)
        }) — the debt is still on the books.`;
      }
    }

    return {
      outcome: `Queued ${bubbles} ${bubbles === 1 ? "message" : "messages"} to the customer (${payload.language}, ${payload.intent}), first one due ${result.scheduledAt}.${promiseOutcome}`,
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
        // Both halves of the ledger on the receipt: what this reply PROMISED and
        // which promise it PAID. `null` on each is the honest default — most
        // replies do neither.
        promiseDeclared: payload.promise ? payload.promise.kind : null,
        fulfilsPromiseId: fulfilsPromiseId || null,
        promiseStatus,
      },
      targetRef: `inbox_message:${result.firstMessageId}`,
    };
  },

  /**
   * Hand the thread to the founder. The route really does lock Nova out:
   * `escalatedAt` + `handledBy:'founder'`, after which every `/reply` on the
   * thread is refused LOCKED until the founder gives it back.
   *
   * MODULE 08 SHIPPED THE SERVER HALF. `dakio-api/src/lib/novaInboxHandover.js`
   * (mounted at `routes/novaInbox.js`) now queues the deterministic holding
   * line, authors the priority-1 escalation Decision carrying the context
   * brief, and on a RE-trigger refreshes that brief instead of stacking a
   * second ask. So `decisionId` and `holdingSent` are real values now, not the
   * `null`/`false` placeholders the prologue comment here used to describe.
   *
   * WHY THERE ARE FOUR OUTCOME SENTENCES AND NOT TWO. This string is the
   * founder's permanent ledger receipt for the hand-off (`actions.ts` writes it
   * onto the NovaAction and repeats it as the live-feed detail), so every
   * clause has to be a fact the ROUTE reported, never one this executor
   * assumed. Two clauses are claims the executor cannot observe:
   *
   *  - "the customer was told someone is looking at it" — gated on
   *    `holdingSent`, forwarded and never synthesized.
   *  - "the brief was updated" — gated on `briefUpdated`. `refreshEscalation`
   *    deliberately answers `false` in the cases where it writes nothing: a
   *    legacy thread with no `escalationDecisionId`, a missing Decision, or a
   *    linked action that has left `prepared` because the card was already
   *    approved or rejected. That last case is not exotic — until the Design-7
   *    hand-back exists, `escalatedAt` survives a tap-send, so an answered
   *    thread stays escalated and EVERY later trigger on it lands there. This
   *    executor discarding `briefUpdated` is what made the sentence a shipped
   *    lie on the commonest path; reading it is the whole fix.
   *  - `briefUpdated` absent (an older dakio-api, or the demo backend, which
   *    keeps no brief to update): claim nothing about the brief rather than
   *    guess in either direction.
   *
   * All four sentences are byte-pinned in `evals/inbox/run.ts` §13, so none of
   * them can quietly re-word itself into a claim nobody checked.
   *
   * TYPE RESIDUE, NAMED AND OWNED. `briefUpdated` is on the wire and in the
   * dakio-api route's own JSDoc, but it is not yet declared on
   * `InboxHandoverResult` (`agent/lib/types.ts`) — that file is outside this
   * fix's scope, so the field is read through a local widening instead of a
   * cast-free property access. OWNER: whoever next lands a `types.ts` change
   * for module 08 should add `briefUpdated?: boolean` to `InboxHandoverResult`
   * and delete the widening below; nothing else has to move with it.
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
    // See TYPE RESIDUE above. Compared with `=== true` / `=== false` and never
    // for truthiness, so "the server did not tell us" stays a third state and
    // does not silently collapse into "the server said no".
    const { briefUpdated } = result as InboxHandoverResult & { briefUpdated?: boolean };
    const alreadyClause =
      briefUpdated === true
        ? "the brief was updated rather than asking twice."
        : briefUpdated === false
          ? "there was no open card left to update, so nothing was changed."
          : "I did not ask twice.";
    return {
      outcome: result.alreadyEscalated
        ? `Conversation ${payload.conversationId} was already with you (${payload.reason}); ${alreadyClause}`
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
        // The fact the sentence above was derived from, on the receipt beside
        // it: `null` means the route never said, which is not the same as `false`.
        briefUpdated: briefUpdated ?? null,
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
    // `mergeCustomerRecordsInTx` is idempotent: when only one of the two rows is
    // still there — the founder deleted the other from the merchant UI while the
    // card sat prepared, or this pair was already approved on the Desk — it
    // moves nothing and answers `alreadyMerged:true` with four zero counts.
    // Reporting THAT as "Merged two customer records into X" writes a ledger row
    // and a founder receipt for an operation that did not happen on this run.
    // dakio-api's executor for the same verb (`src/lib/novaExecutors.js`)
    // already branches; this is one verb with two approve surfaces (a Desk tap
    // runs that one, `approve_action` in chat runs this one), and they have to
    // say the same true thing.
    //
    // Read off the object rather than the type: the flag IS on the wire
    // (`mergeCustomersHandler` returns the record verbatim and `request()` does
    // no field stripping), but `StoreClient.mergeCustomers`'s declared return
    // shape in agent/lib/store/client.ts does not name it yet — that widening
    // belongs to the client file and is called out in the module-03 fix report.
    const alreadyMerged = (result as { alreadyMerged?: boolean }).alreadyMerged === true;
    return {
      outcome: alreadyMerged
        ? `Nothing to merge — only ${result.survivorCustomerId} still exists; these two records were already folded together.`
        : `Merged two customer records into ${result.survivorCustomerId} — ${result.ordersMoved} orders, ${result.channelsMoved} channels, ${result.conversationsMoved} conversations and ${result.promisesMoved} promises now point at one person.`,
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
        // On the receipt as well as in the sentence: the counts are all zero on
        // a no-op run, and zero-because-nothing-moved must be readable as
        // something other than zero-because-the-records-were-empty.
        alreadyMerged,
      },
      // `customer:<id>` is NOT in dakio-api's ATTRIBUTABLE map
      // (src/lib/novaLedger.js), so `attributeDoorRecord` no-ops with
      // {attributed:false} — correct: there is no door record to stamp.
      targetRef: `customer:${result.survivorCustomerId}`,
    };
  },

  /**
   * Module 04 D7. Books a `followup` NovaJob and nothing else — the reply it
   * will eventually compose is a separate `send_inbox_reply`, gated on its own,
   * with a fresh NBA block because the world moves between the promise and the
   * knock.
   *
   * The server owns everything that makes the commitment safe: it validates the
   * delay against the journey's stage, shifts `dueAt` out of quiet hours,
   * supersedes this conversation's existing nudge, and refuses a chain past two
   * unanswered follow-ups. Those refusals arrive as {@link InboxSendRefused}
   * and propagate — a follow-up the server declined must never be recorded as
   * one Nova made, or the founder's commitments list shows a knock that will
   * never come.
   */
  async schedule_follow_up(client, raw, context) {
    const payload = scheduleFollowUpPayload.parse(raw);
    // Same rule as `send_inbox_reply`: on the approve path the prepared row's
    // id is the stable key both approve surfaces already agree on, so a Desk
    // tap and a chat approve of one draft book ONE commitment. On the direct
    // path no ledger row exists yet, so a fresh id is minted and the route's
    // `w()` cache keys on it for the duration of this call's retries.
    const approved = typeof context?.approvedActionId === "string" && context.approvedActionId.length > 0;
    const scheduledByActionId = approved ? context!.approvedActionId! : randomUUID();
    const result = await client.scheduleFollowup({
      conversationId: payload.conversationId,
      ...(payload.journeyId ? { journeyId: payload.journeyId } : {}),
      delay: payload.delay,
      reason: payload.reason,
      plannedIntent: payload.plannedIntent,
      scheduledByActionId,
      // No `promiseId`, ever, from this path. It is not on the model's schema
      // (see schemas.ts) because a nudge that carried one would survive the
      // customer writing back — module 03's cancel hook skips promise-backed
      // rows deliberately, and that exemption belongs to debts alone.
    });
    return {
      outcome:
        `Scheduled a follow-up on this conversation for ${result.dueAt} (${payload.delay}): ${payload.reason}.` +
        (result.superseded
          ? ` It replaces the follow-up that was already pending — one outstanding commitment per conversation.`
          : ""),
      undoable: true,
      // `kind` is what dakio-api's `runUndo` dispatches on — it looks the
      // inverse up in `UNDO[undoData.kind]` (`src/lib/novaExecutors.js`), NOT
      // by verb name. An undoData without it reaches a founder pressing Undo on
      // the Decision Desk as "No inverse is defined for undefined", which is
      // the exact bug commit 79d5d83 fixed on `link_customer_identity` last
      // module. The receiving half is `UNDO.cancel_followup`; this key is the
      // only thing that connects the two.
      //
      // nova-ai's own `undoers` map below stays keyed by VERB name, because
      // `scripts/check-undo-coverage.ts` matches undoer keys against executor
      // names in both directions. Two maps, two keying schemes, both correct.
      undoData: { kind: "cancel_followup", jobId: result.jobId },
      // A commitment claims no revenue. The order it may eventually help close
      // is attributed to the reply that closes it, under D11's direct-cause
      // rule — a follow-up does not get credit for existing.
      revenueInfluence: 0,
      relatedId: payload.conversationId,
      before: null,
      after: { jobId: result.jobId, dueAt: result.dueAt, superseded: result.superseded },
      targetRef: `inbox_conversation:${payload.conversationId}`,
    };
  },
};

export const undoers: Partial<Record<ActionType, Undoer>> = {
  /**
   * Module 06. Put a cancelled order back the way it was.
   *
   * Only the ORDER is restored. If the parcel had already been booked and the
   * cancellation reached the courier, that booking is gone and nothing here can
   * un-cancel it. The sentence says so rather than implying the parcel is back
   * on its way — a founder who reads "restored" and stops checking is exactly
   * how a customer ends up waiting for something nobody is sending.
   */
  async cancel_order_from_chat(client, undoData) {
    const previous = String(undoData.previousStatus ?? "placed");
    await client.updateOrder({ id: String(undoData.orderId), status: previous as OrderStatus });
    return (
      `Restored order ${String(undoData.orderId)} to ${previous}. ` +
      `If the parcel had already been booked with a courier, that booking is NOT restored — rebook it.`
    );
  },
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
  /**
   * Module 04 D7. Keyed by the VERB name, like every entry here; the stored
   * `undoData.kind` is `cancel_followup`, which is what dakio-api's own `UNDO`
   * map dispatches on. Same two-maps arrangement as the link above.
   *
   * `cancelled:false` is not a failure — it means the row settled before the
   * founder pressed Undo (it fired, or a newer commitment superseded it, or the
   * customer wrote back and the ingest hook cancelled it). The commitment is
   * gone either way, so the sentence says which happened rather than reporting
   * a no-op as a rollback.
   */
  async schedule_follow_up(client, undoData) {
    const jobId = String(undoData.jobId);
    const { cancelled } = await client.cancelFollowup(jobId);
    return cancelled
      ? `Cancelled the scheduled follow-up (job ${jobId}) — nothing will be sent, and the ledger row recording that it was scheduled stays, because it was.`
      : `The follow-up (job ${jobId}) was already settled — fired, superseded, or cancelled when the customer wrote back — so there was nothing left to cancel.`;
  },
  /**
   * Module 05 D4. Keyed by the VERB name, like every entry here; the stored
   * `undoData.kind` is `cancel_chat_order`, which is what dakio-api's own `UNDO`
   * map dispatches on. Same two-maps arrangement as the two above.
   *
   * CANCELS, never deletes. An order is a financial record and a courier may
   * already have been told about it, so the inverse of "placed" is "cancelled" —
   * the row, its items and its receipt all stay readable. dakio-api's
   * `UNDO.cancel_chat_order` additionally refuses anything past PENDING, which
   * is the guarantee that matters and the one this side cannot make: a parcel
   * that has been picked up is not undone by a founder tapping a button, and
   * the server is the only thing that knows where it is.
   */
  async create_order_from_chat(client, undoData) {
    const orderId = String(undoData.orderId);
    const label = undoData.orderNumber ? String(undoData.orderNumber) : orderId;
    await client.updateOrder({ id: orderId, status: "cancelled" });
    return `Cancelled order ${label}. The order row stays — it is a financial record and it really was placed — and the customer must be told, because they were given this number in the thread.`;
  },
  /**
   * Module 05 D6. `deactivate_chat_discount` is the stored `undoData.kind`.
   *
   * Deactivating, not deleting, and the reason is the same one that makes
   * `create_discount`'s undoer deactivate: if the customer already redeemed the
   * code, the discount happened, and erasing the row would erase the receipt
   * explaining a sale that is short by exactly that amount. A deactivated
   * coupon simply stops working from now on, which is what the founder means.
   */
  async offer_chat_discount(client, undoData) {
    // `couponId` — dakio-api's field name, because the executor writes dakio-api's
    // field name. See the comment beside that `undoData` for why the wire payload
    // does not use this repo's `discountId`.
    const discount = await client.updateDiscount(String(undoData.couponId), { active: false });
    return `Deactivated coupon ${discount.code} — it will not apply again. If the customer already used it, that discount stands and the order still shows it.`;
  },
};
