/**
 * Zod input schemas for every Nova action, shared by the action tools and
 * the executors so payload shapes never drift.
 *
 * Every action carries a justification — the PRD trust system requires a
 * reason, expected impact, and confidence on every decision Nova makes.
 */

import { z } from "zod";
import { INBOX_INTENTS } from "./inboxIntents";

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
  // assessment: <reserved slot — schema owned by module 11, and reserved on
  // escalateConversationPayload and createOrderFromChatPayload too. Left out
  // rather than stubbed: an unused field the model can fill is a field that
  // will be filled with fiction.>
});

/**
 * Escalation. `reason` is module 08's closed trigger taxonomy — the model
 * names which trigger fired, it does not invent categories. (`guardrail:<rule>`
 * is also a valid stored reason, but only the authority gate authors it.)
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
] as const;

export const escalateConversationPayload = z.object({
  conversationId: z.string().min(1),
  reason: z
    .enum(ESCALATION_REASONS)
    .describe("Which escalation trigger fired. One of the defined set — never a free-form category."),
  department: z
    .enum(["support", "sales", "finance"])
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
        customerId: z.string().min(1),
        lastDigits: z.string().min(2).max(4),
      })
      .optional()
      .describe(
        "The last 2–4 digits the customer just told you. The SERVER compares — you never see the number you are checking against.",
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
export type ResolveTicketPayload = z.infer<typeof resolveTicketPayload>;
export type CreatePurchaseOrderPayload = z.infer<typeof createPurchaseOrderPayload>;
export type SwitchSupplierPayload = z.infer<typeof switchSupplierPayload>;
export type AssignCourierPayload = z.infer<typeof assignCourierPayload>;
export type GenerateContentPayload = z.infer<typeof generateContentPayload>;
export type ImportProductPayload = z.infer<typeof importProductPayload>;
