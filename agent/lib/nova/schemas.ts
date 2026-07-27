/**
 * Zod input schemas for every Nova action, shared by the action tools and
 * the executors so payload shapes never drift.
 *
 * Every action carries a justification — the PRD trust system requires a
 * reason, expected impact, and confidence on every decision Nova makes.
 */

import { z } from "zod";
import { INBOX_INTENTS } from "./inboxIntents";
import type { NovaDepartment } from "../types";

export const receiptEvidenceSchema = z.object({
  source: z
    .string()
    .min(2)
    .describe("Where this observation came from — a tool, metric, or record, e.g. 'orders', 'campaign cmp-4'."),
  note: z
    .string()
    .min(5)
    .describe("The observation itself, e.g. '0 orders in 30d; 2 campaigns scheduled'."),
  metric: z.string().optional().describe("Named metric this evidence cites, if any."),
  value: z.union([z.string(), z.number()]).optional().describe("The metric's value."),
  window: z.string().optional().describe("Evidence window, e.g. '30d'."),
});

/**
 * The model-authored half of the PRD E-8 receipt. `before`/`after` display
 * snapshots are appended by the executor at run time; a write missing its
 * receipt is a FAILED write (§16.2) — the API enforces it, this schema makes
 * the model argue it.
 */
export const receiptSchema = z
  .object({
    reason: z
      .string()
      .min(10)
      .describe("Why this action, citing the specific data that supports it."),
    expectedImpact: z
      .string()
      .min(5)
      .describe("What is expected to happen, quantified where possible."),
    confidence: z.number().min(0).max(1).describe("Nova's confidence, 0 to 1."),
    evidence: z
      .array(receiptEvidenceSchema)
      .min(1)
      .describe("At least one concrete supporting observation. No claim without evidence."),
  })
  .describe("Required trust-system receipt for this action (PRD §16.2: no write without one).");

export type ReceiptInput = z.infer<typeof receiptSchema>;

export const updateCampaignPayload = z.object({
  campaignId: z.string(),
  status: z.enum(["active", "paused"]).optional().describe("New status, if changing."),
  dailyBudget: z.number().positive().optional().describe("New daily budget in ৳ (BDT, the store display currency)."),
  note: z.string().optional().describe("Note to append to the campaign log."),
});

export const createCampaignPayload = z.object({
  name: z.string().min(3),
  channel: z.enum(["meta", "google", "tiktok", "email", "sms"]),
  dailyBudget: z.number().positive(),
  productIds: z.array(z.string()).min(1),
  startNow: z.boolean().describe("true = launch active, false = create as scheduled."),
  notes: z.string().describe("Strategy note: audience, angle, creative direction."),
});

export const publishSocialPostPayload = z.object({
  platform: z.enum(["instagram", "tiktok", "facebook"]),
  format: z.enum(["reel", "post", "story"]),
  caption: z.string().min(10),
  productIds: z.array(z.string()),
  scheduledFor: z
    .string()
    .optional()
    .describe("ISO timestamp to schedule for; omit to publish immediately."),
});

export const updatePricePayload = z.object({
  productId: z.string(),
  newPrice: z.number().positive(),
  compareAtPrice: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe("Strike-through price; null clears it."),
});

export const createDiscountPayload = z.object({
  code: z.string().min(3).describe("Discount code, e.g. COMEBACK10."),
  percentOff: z.number().min(1).max(90),
  scope: z.enum(["order", "product"]),
  productIds: z.array(z.string()).optional().describe("Required when scope is product."),
  customerId: z
    .string()
    .nullable()
    .optional()
    .describe("Issue to one customer only (cart recovery, winback)."),
  expiresInDays: z.number().int().min(1).max(90),
});

export const sendCustomerMessagePayload = z.object({
  customerId: z.string(),
  channel: z.enum(["email", "sms", "chat"]),
  purpose: z.enum([
    "cart_recovery",
    "support_reply",
    "sales_reply",
    "upsell",
    "winback",
    "order_update",
  ]),
  subject: z.string().nullable().optional().describe("Email subject; null for sms/chat."),
  body: z.string().min(10).describe("Message body, in the brand voice."),
  relatedId: z
    .string()
    .nullable()
    .optional()
    .describe("Cart, ticket, or order id this message is about."),
});

/* ── Front Office (Stage 10 module 02) ──────────────────────────────────────
 *
 * The two customer-conversation verbs. `send_inbox_reply` is the only path to
 * a customer-visible byte on Messenger/Instagram, and it is a SCHEMA before it
 * is a message: 1–3 bubbles as an array (canonical C-12 — there is no `|||`
 * divider), each hard-capped, so an overlong wall of text is a validation
 * error the model must fix by shortening. Nothing is ever truncated silently.
 */

/** Hard per-bubble cap. ~220 chars is the instruction-level soft target. */
export const INBOX_CHUNK_MAX_CHARS = 320;
/** Hard bubble count. Three short messages read human; four read like a bot. */
export const INBOX_MAX_CHUNKS = 3;

export const inboxChunkSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(INBOX_CHUNK_MAX_CHARS)
    .describe(
      "One chat bubble, exactly as the customer will see it. Aim for under ~220 characters; over 320 is rejected — split the thought or say less, never send a wall.",
    ),
});

/**
 * The closed promise taxonomy (module 03 D7). Byte-equal to the
 * `NovaPromise.kind` column and to `PromiseKind` in types.ts — the model names
 * which KIND of debt it just took on, it does not invent categories.
 */
export const PROMISE_KINDS = [
  "follow_up_info",
  "delivery_eta",
  "courier_check",
  "restock_notify",
  "refund",
  "replacement",
  "callback_founder",
  "price_hold",
  "other",
] as const;

export const sendInboxReplyPayload = z.object({
  conversationId: z.string().min(1).describe("The conversation you are replying in."),
  inReplyToMessageId: z
    .string()
    .min(1)
    .describe(
      "The newest inbound message id you had read when you composed this. It is the staleness anchor: if the customer wrote again since, the send is refused and you re-read instead of answering a stale question.",
    ),
  chunks: z
    .array(inboxChunkSchema)
    .min(1)
    .max(INBOX_MAX_CHUNKS)
    .describe(
      "1–3 bubbles. Split at natural points (greeting/ack ‖ the fact ‖ the nudge). A one-fact answer is ONE bubble.",
    ),
  intent: z
    .enum(INBOX_INTENTS)
    .describe(
      "What this exchange is about. Decides the department the work is attributed to and whether it may auto-send. Use 'general' when you genuinely cannot tell — never a flattering guess.",
    ),
  purpose: z
    .string()
    .min(2)
    .optional()
    .describe(
      "Why this specific message exists, when it is not a plain answer: 'cart_recovery' | 'holding' | 'escalation_draft' | 'review_ask'. An escalation draft never auto-sends.",
    ),
  language: z
    .enum(["bn", "banglish", "en"])
    .describe(
      "The script/register you are replying in — mirror the customer's latest message. Digits stay Latin in every language.",
    ),
  // NO `timing` field, deliberately. Register rule 13 tells the model pacing is
  // handled outside it, and this schema has to agree: a model-settable
  // `{mode:'instant'}` skips `computeSchedule` entirely — the 2.5s floor, the
  // hour bands, the night batch — and a model that reads "the customer is
  // waiting" as reason to set it every turn would silently retire the one
  // control the whole anti-bot-tell engine has. Every case a model could
  // legitimately hurry for is ALREADY computed server-side by `bypassReason`
  // (closing window, escalation purposes, urgency lexicon, COD intents, a phone
  // number in the inbound). The one producer that genuinely knows better is the
  // approve path — the founder already waited — and it sets `timing` on the
  // wire request without going through this payload (see `send_inbox_reply`).
  disclosure: z
    .object({ asked: z.boolean(), given: z.boolean() })
    .optional()
    .describe("Set when the customer asked whether they are talking to a bot, and whether you told them."),
  // Module 03 D7. Declared at send time, never mined from the text afterwards:
  // the model that just wrote "kal janabo" is the only thing that knows what it
  // meant by it, and an NLP pass over outbound copy would both miss debts and
  // invent them. dakio-api writes the NovaPromise row inside the same
  // transaction as the outbound and deletes it if the send is canceled — an
  // unsent promise was never made.
  promise: z
    .object({
      text: z
        .string()
        .min(3)
        .describe("The commitment itself, in the customer's own language, as you said it."),
      kind: z
        .enum(PROMISE_KINDS)
        .describe("Which kind of debt this is. One of the defined set — never a free-form category."),
      dueAtISO: z
        .string()
        .min(10)
        .describe("When the customer expects to hear back, ISO 8601. Never name a time you have no tool path to."),
    })
    .optional()
    .describe(
      "REQUIRED whenever this reply commits to a future action or answer ('janachchi', 'kal janabo', 'stock asle inform korbo'). A committing reply without this field is a debt with no ledger row.",
    ),
  // The other half of `promise`: that field OPENS a debt, this one CLOSES one.
  // Without it there is no way for a reply to say "this is the answer I owed
  // you", so every declared promise would age past its due date and be swept
  // `broken` — Nova reporting itself, in the founder's own scorecard, as a page
  // that never keeps its word.
  //
  // It is a claim, not a settlement: dakio-api decides. A claim against an
  // already-sent reply keeps the promise now; against a still-queued one it
  // ARMS and settles when the send is confirmed; against a canceled or failed
  // one it is refused. Only a message that actually reached the customer can
  // pay a debt (module 03 D8) — which is why the model cannot simply assert it.
  promiseId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The id of the open promise this reply FULFILS, from the 360 block's promises list. Set it only when this message actually delivers the answer you owed — never to tidy up a debt you have not paid.",
    ),
  // assessment: <reserved slot — schema owned by module 11, and reserved on
  // escalateConversationPayload and createOrderFromChatPayload too. Left out
  // rather than stubbed: an unused field the model can fill is a field that
  // will be filled with fiction.>
});

/**
 * Escalation. `reason` is module 08's closed trigger taxonomy — the model
 * names which trigger fired, it does not invent categories. (`guardrail:<rule>`
 * is also a valid stored reason, but only the authority gate authors it.)
 *
 * ELEVEN SLUGS. Module 05 (FD-4) added the last two, and the reason it had to
 * is worth keeping: neither of them is a failure, and every one of the nine
 * above says something went wrong. `tool_failure` was the nearest fit for both
 * and it is the wrong sentence twice over — it maps to holding template H2
 * ("Nova is not sure"), and the founder-facing label reads "Nova could not
 * check". Neither is true when the shop's own rules are what stopped Nova.
 *
 *  - `guardrail_blocked` — Nova had the answer and was not permitted to act on
 *    it: a chat order the fake-order guard refused, a plan limit, a discount
 *    past the ceiling. The customer must NEVER hear the reason (an order
 *    refused for suspected fraud, explained, is an accusation), so H7 says only
 *    that the owner will confirm this one personally. The block reason rides
 *    the founder brief and nothing else.
 *  - `policy_gap` — the customer asked something the shop has never answered
 *    (exchange window, wholesale terms, warranty). Nova is not confused and
 *    must not say it is; there is simply no configured answer to give, so H8
 *    says the owner is being asked for the shop's rule. Module 05's
 *    `TenantPolicy` table is the surface that eventually closes these; an
 *    absent row is exactly what this slug reports.
 *
 * Adding a slug is a THREE-FILE change in one commit, in this order: this list
 * (the source of truth), dakio-api's `src/lib/novaInboxHandover.js` mirror plus
 * its `HOLDING_TEMPLATE_BY_REASON` / `REASON_LABEL` entries, and the pinning
 * test that asserts the two lists byte-identical. `handoverHandler` 422s on a
 * slug it has not been told about, so a half-landed widening fails at runtime,
 * on a real thread, not at build time.
 */
export const ESCALATION_REASONS = [
  "human_ask",
  "anger",
  "payment_dispute",
  "legal",
  "lost",
  "negotiation",
  "vip",
  "tool_failure",
  "fraud_risk",
  // Stage 10 module 05 (FD-4). Appended, never inserted: the dakio-api mirror
  // and its pinning test compare ORDER as well as membership.
  "guardrail_blocked",
  "policy_gap",
] as const;

export const escalateConversationPayload = z.object({
  conversationId: z.string().min(1),
  reason: z
    .enum(ESCALATION_REASONS)
    .describe("Which escalation trigger fired. One of the defined set — never a free-form category."),
  // The range of `DEPARTMENT_BY_INTENT` (`./inboxIntents.ts`), not a hand-picked
  // subset of it, and not the whole of `NOVA_DEPARTMENTS` either — a customer
  // hand-off never lands in `inventory` or `ceo`. Module 08 widened it from
  // {support, sales, finance}: the map routes `delivery_eta`/`delivery_issue`/
  // `address_confirm`/`cod_confirm` to `shipping` and `ad_reply` to `marketing`,
  // so on the old three-value enum the model could not name the room a delivery
  // escalation actually belongs to, and every parcel problem landed in support.
  // Widen this and the map together or they disagree, and then the same thread
  // routes one way when Nova replies and another when Nova hands over.
  department: z
    .enum(["support", "sales", "finance", "shipping", "marketing"])
    .describe("Which room owns this hand-off, so it lands in front of the right person."),
  summary: z
    .string()
    .min(10)
    .describe("What happened and what the customer needs, in English, in a few lines the founder can act on."),
  summaryBn: z.string().min(5).describe("The same brief in Bangla — the founder reads whichever they prefer."),
  suggestedReply: z
    .string()
    .optional()
    .describe("The reply you would have sent. It is a DRAFT for the founder — it never auto-sends."),
  suggestedAction: z
    .string()
    .optional()
    .describe("The concrete next step you recommend, e.g. 'refund 1 unit, courier lost it'."),
  factsChecked: z
    .array(
      z.object({
        source: z.string().min(2).describe("The tool or record you read, e.g. 'order 4172'."),
        note: z.string().min(5).describe("What it actually said."),
      }),
    )
    .default([])
    .describe("Everything you verified before escalating, so the founder does not re-check it."),
});

/* ── Front Office (Stage 10 module 03) ──────────────────────────────────────
 *
 * Identity. The SERVER resolves it — these two payloads carry an assertion and
 * an evidence label, never a resolved answer, because a model that could name
 * the customerId to link to is a model that can be talked into naming someone
 * else's.
 */

/**
 * Identity link (module 03 D4). Exactly one of `phone` / `verify` — the server
 * normalizes, variant-matches and decides. It LINKS, it never CREATES:
 * Customers materialize through orders, and chat must not invent one.
 */
export const linkCustomerPayload = z
  .object({
    conversationId: z.string().min(1).describe("The conversation you are linking."),
    phone: z
      .string()
      .optional()
      .describe(
        "A phone the customer stated AS THEIR OWN, first person. Never a number given about someone else, and never one you inferred.",
      ),
    verify: z
      .object({
        // OPTIONAL, and advisory only. The server tests the conversation's own
        // `proposedCustomerId` and NOTHING else — it reads this field solely to
        // record on the failure receipt that a caller named a different
        // candidate (dakio-api `lib/customerLink.js` `linkByDigitCheck`, which
        // ignores it for selection). It is optional because
        // `InboxThread.proposal` is basis-only by design: the model is never
        // told WHO the candidate is, so a required id made this rung
        // unreachable from the customer plane — there was no valid value to
        // put in it. A caller that could choose the candidate could walk the
        // customer table two digits at a time, which is the attack the
        // propose/confirm split exists to stop. The wire now says what the
        // server already enforced.
        customerId: z.string().min(1).optional(),
        lastDigits: z.string().min(2).max(4),
      })
      .optional()
      .describe(
        "The last 2–4 digits the customer just told you. The SERVER compares them against the candidate IT proposed — you never see the number you are checking against, and you never choose who is checked.",
      ),
  })
  .refine((v) => (v.phone == null) !== (v.verify == null), {
    message: "exactly one of phone | verify",
  });

/**
 * Late-merge of two Customer rows (module 03 D5). The model never picks the
 * survivor — D5 fixes that server-side (more orders; tie → older) — so this
 * payload names the pair and the evidence, nothing else. A payload that named
 * a survivor would let the model choose whose records get rewritten. Proposed
 * by the merge sweep or by a link collision; never invoked mid-conversation.
 */
export const mergeCustomerRecordsPayload = z.object({
  customerIdA: z.string().min(1),
  customerIdB: z.string().min(1),
  basis: z
    .enum(["phone_variant", "link_collision"])
    .describe("Why these two look like one person."),
});

/* ── Front Office (Stage 10 module 04) ──────────────────────────────────────
 *
 * The commitment verb. A follow-up is a PROMISE with a clock on it, so the
 * payload names when, why, and what it expects to be about — and nothing else.
 * The customer's number, name and address are not in it and must never be: the
 * server resolves the thread from `conversationId` and reaches the person
 * through the channel that already exists.
 */

/**
 * The delays a follow-up may be booked at (D7). Byte-equal to `FollowupDelay`
 * in types.ts and to the route's own allow-list — three copies of one taxonomy,
 * because the model names the delay, zod rejects anything else, and Postgres
 * stores the string. A value present in only two of the three is a delay that
 * either cannot be chosen or cannot be booked.
 *
 * Closed, and short. The absent option is the important one: there is no
 * "15m" and no free-form minutes field, because a model that can book a
 * follow-up ten minutes out can build a pressure loop out of a customer who
 * simply has not answered yet. `3d` is legal only in the delivered/retained
 * stages; the NBA block's `allowedDelays` is what narrows the list per stage,
 * and the ROUTE re-checks it — this enum is the outer bound, not the gate.
 */
export const FOLLOWUP_DELAYS = ["2h", "4h", "24h", "3d"] as const;

export const scheduleFollowUpPayload = z.object({
  conversationId: z
    .string()
    .min(1)
    .describe("The conversation you are committing to come back to."),
  journeyId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The journey id from the NBA block's `journey.id`. Omit it only when the block gave you none — the server resolves the thread either way.",
    ),
  delay: z
    .enum(FOLLOWUP_DELAYS)
    .describe(
      "How long to wait. PICK FROM the NBA block's `allowedDelays` for this stage — anything else is refused server-side. There is deliberately no shorter option: chasing someone within the hour is pressure, not a follow-up.",
    ),
  reason: z
    .string()
    .min(5)
    .describe(
      "Why you are coming back, in one line the shop owner can read on their commitments list — 'size chart pathabo, XL stock check kore'. Not the message itself: you compose that when the follow-up fires and the world has moved.",
    ),
  plannedIntent: z
    .enum(INBOX_INTENTS)
    .describe(
      "What you expect the follow-up to be about. It decides which room the work is attributed to, and it is a plan, not a commitment — the reply you actually send declares its own intent.",
    ),
  // NOT a model-settable field, and this is why: `promiseId` marks a job as
  // module 03 debt repayment, which exempts it from supersession AND from the
  // inbound cancel hook. A model that could set it here could make an ordinary
  // nudge survive the customer writing back to say "thanks, sorted" — the exact
  // barge-in the cancel hook exists to prevent. Promise-backed follow-ups are
  // enqueued server-side by `novaPromises.js` inside the reply transaction; a
  // reply pays a debt by setting `promiseId` on `sendInboxReplyPayload`, never
  // by scheduling one here.
});

/* ── Front Office (Stage 10 module 05) ──────────────────────────────────────
 *
 * The selling verbs. Three rules bind all three payloads, and every one of them
 * is a rule about what is ABSENT:
 *
 * 1. NO MINOR UNITS. dakio-api holds money in WHOLE TAKA — `Order.total`,
 *    `OrderItem.unitPrice` and `Coupon.amount` are Decimals in taka, and
 *    `Tenant.deliveryInsideDhaka = 60` is sixty taka, not sixty poisha. Only
 *    the guardrail REGISTRY is denominated in poisha (`inbox.highValueMinor`,
 *    `dailySpendCapMinor`), and `novaBrief.js`'s `takaToMinor` is the one
 *    converter. A field here named `…Minor` would be a lying name on a wire
 *    that carries taka, and the first reader to trust it ships a 100× error at
 *    a real customer. There is no `Minor` field below and there must never be.
 * 2. NO PRICE LEVER. There is no `discount`, no `paid`, no `unitPrice` and no
 *    `total` on any of these payloads. The server prices the order from the DB
 *    and refuses an item priced more than ±1 taka off `sellingPrice`; the only
 *    honest way to sell below list is a Coupon row, which is what
 *    `offer_chat_discount` mints. The merchant order route accepts a raw client
 *    `discount` that flows unvalidated into the total — that is precisely the
 *    lever these payloads exist not to hand a model.
 * 3. NO CUSTOMER RECORD. The customer's identity is resolved by the SERVER from
 *    the thread; the 360 block deliberately shows the model a MASKED phone and
 *    no street address. Everything a chat order needs about the buyer therefore
 *    has to come from what the customer typed in this thread, which is also why
 *    those fields are on the payload rather than looked up.
 */

/**
 * One line of a chat order. `productId` is the only field the server prices
 * from; `variantId` is the size/colour the customer actually confirmed.
 *
 * `productName` is REQUIRED and is not redundant. It is the text a no-touch
 * lock is matched against (`TARGET_TEXT.create_order_from_chat` in
 * `authority.ts`): with ids alone, a founder who locked "শাড়ি" could not stop a
 * chat order for a saree, because an id matches no word a founder would type.
 * It is match-and-display only — the server resolves the product from
 * `productId` and never reads this string, so a wrong name cannot change what
 * is sold, only what a lock can see.
 */
export const chatOrderItemSchema = z.object({
  productId: z.string().min(1).describe("The product id from the product read. Never a name you matched yourself."),
  variantId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The variant id when the customer named a size/colour ('XL hobe?'). Omit ONLY for a product with no variants — an order for a sized product with no variantId is an order nobody can pick.",
    ),
  productName: z
    .string()
    .min(1)
    .describe("The product's name as the shop lists it, in the shop's own script. Recorded on the card and matched against the owner's no-touch locks."),
  qty: z.number().int().positive().describe("How many units the customer confirmed."),
});

/**
 * A chat order (module 05 D4/D5).
 *
 * `confirmedByCustomer: z.literal(true)` is the load-bearing field. It is not a
 * boolean the model may weigh — the schema is UNSATISFIABLE without the literal
 * `true`, so the tool cannot be called at all except as an assertion that the
 * customer was read the itemized total and said yes in their own words. A
 * `boolean` here would let a model that thinks the intent is obvious book a COD
 * parcel nobody agreed to; the customer then refuses it at the door, and the
 * shop pays the return.
 */
export const createOrderFromChatPayload = z.object({
  conversationId: z.string().min(1).describe("The conversation this order was agreed in."),
  customerName: z.string().min(1).describe("The name the customer gave for the parcel."),
  customerPhone: z
    .string()
    .min(1)
    .describe("The number the customer stated in this thread, as they typed it. The server normalizes and validates it — do not reformat it yourself."),
  customerCity: z.string().min(1).describe("City/upazila for delivery, as stated."),
  customerDistrict: z
    .string()
    .min(1)
    .describe("District, as stated. It decides the shipping charge server-side (inside vs outside Dhaka) — never quote a delivery charge you computed yourself."),
  customerAddress: z
    .string()
    .optional()
    .describe("House/road/area line, when the customer gave one."),
  items: z.array(chatOrderItemSchema).min(1).describe("What they are buying, exactly as read back and confirmed."),
  couponCode: z
    .string()
    .optional()
    .describe(
      "A coupon the customer already holds, or one you issued with offer_chat_discount. The server re-validates it (active, expiry, maxUses, minOrder) and refuses the order if it does not hold — it is never applied on trust.",
    ),
  confirmedByCustomer: z
    .literal(true)
    .describe(
      "Set ONLY after you read back the items, the delivery charge, the total and COD, and the customer answered with an explicit yes ('হ্যাঁ', 'ji', 'ok den'). Silence, an emoji, or 'hmm' is not a confirmation. There is no false value for this field: if they have not agreed, you do not call this tool.",
    ),
  // assessment: <reserved slot — schema owned by module 11, and reserved on
  // sendInboxReplyPayload and escalateConversationPayload too.>
});

/**
 * A bounded discount offered inside a chat (module 05 D6).
 *
 * `mechanism` is the whole design. A discount is ALWAYS a Coupon row, never a
 * price change: `update_price` is a store-wide act with its own margin
 * guardrail, and a haggle answered by repricing the product silently discounts
 * every other customer buying it that day. `free_delivery` carries no amount at
 * all — the server resolves it to that district's own shipping charge, because
 * the model is not told the delivery table and a model-guessed 60 taka on an
 * outside-Dhaka order is a discount the shop did not agree to.
 */
export const CHAT_DISCOUNT_MECHANISMS = ["percent", "fixed", "free_delivery"] as const;

export const offerChatDiscountPayload = z
  .object({
    conversationId: z.string().min(1).describe("The conversation you are negotiating in."),
    customerId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The customer id from the 360 block, when the thread is linked. Supply it whenever you have it: it is the ONLY thing the once-per-N-days frequency guard can match on, and omitting it means the guard silently never fires for this customer.",
      ),
    mechanism: z
      .enum(CHAT_DISCOUNT_MECHANISMS)
      .describe(
        "'free_delivery' first — it is the BD shopkeeper's move and costs the least margin. 'percent'/'fixed' only when free delivery does not close it.",
      ),
    percentOff: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Required for mechanism 'percent'. Whole percent. The owner's ceiling is enforced server-side and a request past it is refused, not trimmed."),
    // WHOLE TAKA, and the name says so by not saying otherwise. `Coupon.amount`
    // is numeric(65,30) in taka; 100 here is one hundred taka.
    amount: z
      .number()
      .positive()
      .optional()
      .describe("Required for mechanism 'fixed'. WHOLE TAKA off the order — 100 means ৳100, not 100 poisha."),
    expiresHours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .describe("How long the code stays live. 48 is the default the script offers; a coupon with no deadline is a permanent discount."),
    reason: z
      .string()
      .min(5)
      .describe("Why this customer, now — 'second ask on a ৳1,720 cart, offered free delivery instead of a percent'. The owner reads this on the card."),
  })
  // The arms of `mechanism` carry different required fields and zod cannot
  // express that from the enum alone. Refusing here rather than in the executor
  // matters: an unsatisfiable payload is a validation error the model can fix on
  // the same turn, while a missing amount discovered server-side is a failed
  // action the customer waits through.
  .refine((v) => v.mechanism !== "percent" || v.percentOff != null, {
    message: "mechanism 'percent' requires percentOff",
  })
  .refine((v) => v.mechanism !== "fixed" || v.amount != null, {
    message: "mechanism 'fixed' requires amount (whole taka)",
  })
  .refine((v) => v.mechanism !== "free_delivery" || (v.percentOff == null && v.amount == null), {
    message: "mechanism 'free_delivery' takes no amount — the server resolves the district's shipping charge",
  });

/**
 * Payment-slip CLAIM INTAKE (module 05 D7). Read the verb name honestly: it
 * files what the customer asserted, it does not verify anything.
 *
 * Dakio has no payment-gateway API and Meta attachments are lossy, so nothing
 * in this system can read a bKash screenshot and know money moved. This payload
 * therefore records a CLAIM — and `Order.paid` is never touched by it. The verb
 * is in `ALWAYS_DRAFT` in both repos for exactly this reason: a level-4 store
 * must not be able to auto-"verify" a payment nobody read.
 *
 * `claimedAmount` is WHOLE TAKA. It is what the customer SAID they sent, not
 * what anyone confirmed, and it is optional because plenty of customers send a
 * screenshot and no number.
 */
export const verifyPaymentSlipPayload = z.object({
  conversationId: z.string().min(1).describe("The conversation the claim was made in."),
  orderId: z
    .string()
    .min(1)
    .optional()
    .describe("The order the customer says this pays for, when you can identify one. Omit rather than guess — a claim filed against the wrong order is worse than an unmatched one."),
  method: z.enum(["bkash", "nagad", "rocket", "bank", "other"]).describe("How they say they paid."),
  trxId: z
    .string()
    .min(1)
    .optional()
    .describe("The transaction id exactly as the customer typed it. Never correct, pad or re-case it — the owner matches this string by eye against a statement."),
  claimedAmount: z
    .number()
    .positive()
    .optional()
    .describe("The amount the customer says they sent, in WHOLE TAKA. 2350 means ৳2,350. Omit when they did not say."),
  attachmentUrl: z
    .string()
    .min(1)
    .optional()
    .describe("The slip image from the thread, if one arrived. A payment claim often comes as an attachment-only message with no text at all."),
  customerStatement: z
    .string()
    .min(3)
    .describe("What the customer actually said, in their words. This is the evidence the owner judges — never your summary of it, and never a claim you inferred."),
});

// ── Stage 10 module 06 — delivery coordination ───────────────────────────────

/**
 * The case kinds, byte-identical to `CASE_KINDS` in dakio-api's
 * `src/lib/novaCase.js`. `wholesale_inquiry` is deliberately NOT here: v1 treats
 * a wholesale ask as a plain sales escalation, and a kind nothing can open reads
 * as supported to the next person who greps for it.
 */
export const CASE_KINDS = [
  "delivery_stuck",
  "failed_attempt",
  "payment_unverified",
  "damaged_item",
  "address_change_postdispatch",
  "restock_wait",
] as const;

/**
 * Which room owns each kind — byte-identical to `DEPARTMENT_BY_KIND` in
 * dakio-api's `src/lib/novaCase.js`, which is the authority.
 *
 * The SERVER decides the case's department; this copy exists only so
 * `open_case`'s tool can route the founder's DECISION CARD to the same desk the
 * case itself lands on. A shipping case whose approval card sits in support is
 * one the shipping room never sees. Same mirroring convention as `CASE_KINDS`
 * directly above, and pinned by the eval for the same reason: a drift here is
 * silent, and shows up as cards quietly arriving in the wrong room.
 */
export const DEPARTMENT_BY_CASE_KIND = {
  delivery_stuck: "shipping",
  failed_attempt: "shipping",
  address_change_postdispatch: "shipping",
  payment_unverified: "finance",
  damaged_item: "support",
  restock_wait: "inventory",
} as const satisfies Record<(typeof CASE_KINDS)[number], NovaDepartment>;

export const openCasePayload = z.object({
  kind: z.enum(CASE_KINDS).describe("What KIND of problem this is. It decides which room owns it — you do not choose the department."),
  conversationId: z.string().min(1).describe("The thread this was raised in."),
  orderId: z
    .string()
    .min(1)
    .optional()
    .describe("The order this is about, when there is one. Supply it whenever you can: it is what makes a second person asking about the SAME parcel join this case instead of opening a duplicate."),
  productId: z
    .string()
    .min(1)
    .optional()
    .describe("For a restock wait — the product they are waiting for."),
  title: z
    .string()
    .min(5)
    .max(160)
    .describe("One line the owner reads on their desk. Name the order and the problem: 'Order #KQ3-8FZM stuck with Steadfast 5 days'. Not a paragraph."),
  factsNote: z
    .string()
    .min(3)
    .max(600)
    .describe("What you know RIGHT NOW, in a sentence or two — including what the customer said, in their words. This gets quoted back to them, so do not write anything you would not want read out."),
});

export const flagCourierIssuePayload = z.object({
  caseId: z.string().min(1).describe("The case this belongs to. Open one first if there is none."),
  orderId: z.string().min(1),
  courierType: z.string().min(1).describe("Which courier — steadfast, redx or pathao."),
  trackingId: z.string().min(1).describe("The tracking id exactly as stored. The owner reads this out on the phone."),
  reason: z
    .string()
    .min(10)
    .describe("What is actually wrong, from the scans and the thread. Facts only — 'no scan since Tuesday, customer says nobody called' — never a theory about why."),
  recommendation: z
    .string()
    .min(5)
    .describe("What you would ask the courier for. The owner makes the call; this is the ask you would make, not a decision you made."),
});

export const confirmOrderIntentPayload = z.object({
  orderId: z.string().min(1),
  conversationId: z.string().min(1),
  confirmedText: z
    .string()
    .min(1)
    .describe("The customer's OWN confirming message, verbatim — 'ji', 'হ্যাঁ', 'ok den'. This is the evidence that a human said yes. Never your paraphrase, never an emoji you read as agreement, and never a message you are still waiting for."),
});

/**
 * The FIELDS, without the refinement.
 *
 * Split out because `.refine()` returns a `ZodEffects`, which has no `.extend`
 * — and every action tool builds its input as `payload.extend({ receipt })`.
 * The tool re-applies `atLeastOneContactField` on top of its own extension, so
 * the rule is authored once here and enforced on both shapes.
 */
export const updateOrderContactFields = z.object({
  orderId: z.string().min(1),
  conversationId: z.string().min(1),
  address: z.string().min(5).optional().describe("The full new address as they typed it."),
  city: z.string().min(1).optional(),
  district: z.string().min(1).optional().describe("The district decides the delivery charge, so changing it re-prices the order."),
  phone: z.string().min(1).optional().describe("A corrected contact number."),
});

/** An update that changes nothing is not an update. */
export const atLeastOneContactField = {
  check: (p: { address?: string; city?: string; district?: string; phone?: string }) =>
    Boolean(p.address || p.city || p.district || p.phone),
  message: "Give at least one field to change — an update that changes nothing is not an update.",
} as const;

export const updateOrderContactPayload = updateOrderContactFields.refine(
  atLeastOneContactField.check,
  { message: atLeastOneContactField.message },
);

export const cancelOrderPayload = z.object({
  orderId: z.string().min(1),
  conversationId: z.string().min(1),
  reason: z
    .string()
    .min(5)
    .describe("Why they want it cancelled, in their words. The owner sees this, and it is the only record of why a sale went away."),
});

export const resolveTicketPayload = z.object({
  ticketId: z.string(),
  reply: z.string().min(10).describe("Reply to the customer, in the brand voice."),
  newStatus: z.enum(["resolved", "waiting_on_customer", "escalated"]),
});

export const createPurchaseOrderPayload = z.object({
  supplierId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitCost: z
    .number()
    .positive()
    .optional()
    .describe("Override unit cost; defaults to the supplier's offer for this product."),
});

export const switchSupplierPayload = z.object({
  productId: z.string(),
  newSupplierId: z.string(),
});

export const assignCourierPayload = z.object({
  orderId: z.string(),
  courierId: z.string(),
});

export const importProductPayload = z.object({
  trendingProductId: z.string(),
  price: z
    .number()
    .positive()
    .optional()
    .describe("Launch price; defaults to the research feed's suggested price."),
  activate: z.boolean().describe("true = live immediately, false = import as draft."),
});

/** Stage 4 "Craft" (E-11). The model writes the copy; the tool scores + files it. */
export const CONTENT_TYPES = [
  "post", "reel", "story", "captions", "email", "sms", "push", "product_desc",
] as const;

export const generateContentPayload = z.object({
  type: z
    .enum(CONTENT_TYPES)
    .describe("What kind of content this is — post/reel/story/captions/email/sms/push/product_desc."),
  title: z
    .string()
    .min(2)
    .describe("Short internal title for the founder's review list — not published."),
  text: z
    .string()
    .min(1)
    .describe(
      "The draft copy you wrote, in the store's brand voice. This is exactly what the founder reviews; write it as it would publish.",
    ),
  language: z
    .enum(["bn", "en", "mixed"])
    .optional()
    .describe("Declared language; detected from the text when omitted."),
  topic: z
    .string()
    .optional()
    .describe("One line on what this is about and why now — recorded with the draft, not published."),
  contentId: z
    .string()
    .optional()
    .describe(
      "Pass an existing draft's id to file a REVISION (the request-changes loop): your new text replaces the body, the prior version is kept, and it returns to review.",
    ),
  note: z
    .string()
    .optional()
    .describe("When revising, the founder's change request you're addressing — recorded on the version."),
});

export type UpdateCampaignPayload = z.infer<typeof updateCampaignPayload>;
export type CreateCampaignPayload = z.infer<typeof createCampaignPayload>;
export type PublishSocialPostPayload = z.infer<typeof publishSocialPostPayload>;
export type UpdatePricePayload = z.infer<typeof updatePricePayload>;
export type CreateDiscountPayload = z.infer<typeof createDiscountPayload>;
export type SendCustomerMessagePayload = z.infer<typeof sendCustomerMessagePayload>;
export type SendInboxReplyPayload = z.infer<typeof sendInboxReplyPayload>;
export type EscalateConversationPayload = z.infer<typeof escalateConversationPayload>;
export type LinkCustomerPayload = z.infer<typeof linkCustomerPayload>;
export type MergeCustomerRecordsPayload = z.infer<typeof mergeCustomerRecordsPayload>;
export type ScheduleFollowUpPayload = z.infer<typeof scheduleFollowUpPayload>;
export type ChatOrderItem = z.infer<typeof chatOrderItemSchema>;
export type CreateOrderFromChatPayload = z.infer<typeof createOrderFromChatPayload>;
export type OfferChatDiscountPayload = z.infer<typeof offerChatDiscountPayload>;
export type VerifyPaymentSlipPayload = z.infer<typeof verifyPaymentSlipPayload>;
export type ResolveTicketPayload = z.infer<typeof resolveTicketPayload>;
export type CreatePurchaseOrderPayload = z.infer<typeof createPurchaseOrderPayload>;
export type SwitchSupplierPayload = z.infer<typeof switchSupplierPayload>;
export type AssignCourierPayload = z.infer<typeof assignCourierPayload>;
export type GenerateContentPayload = z.infer<typeof generateContentPayload>;
export type ImportProductPayload = z.infer<typeof importProductPayload>;
