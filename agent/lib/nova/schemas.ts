/**
 * Zod input schemas for every Nova action, shared by the action tools and
 * the executors so payload shapes never drift.
 *
 * Every action carries a justification — the PRD trust system requires a
 * reason, expected impact, and confidence on every decision Nova makes.
 */

import { z } from "zod";

export const justificationSchema = z
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
  })
  .describe("Required trust-system justification for this action.");

export const updateCampaignPayload = z.object({
  campaignId: z.string(),
  status: z.enum(["active", "paused"]).optional().describe("New status, if changing."),
  dailyBudget: z.number().positive().optional().describe("New daily budget in USD."),
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

export type UpdateCampaignPayload = z.infer<typeof updateCampaignPayload>;
export type CreateCampaignPayload = z.infer<typeof createCampaignPayload>;
export type PublishSocialPostPayload = z.infer<typeof publishSocialPostPayload>;
export type UpdatePricePayload = z.infer<typeof updatePricePayload>;
export type CreateDiscountPayload = z.infer<typeof createDiscountPayload>;
export type SendCustomerMessagePayload = z.infer<typeof sendCustomerMessagePayload>;
export type ResolveTicketPayload = z.infer<typeof resolveTicketPayload>;
export type CreatePurchaseOrderPayload = z.infer<typeof createPurchaseOrderPayload>;
export type SwitchSupplierPayload = z.infer<typeof switchSupplierPayload>;
export type AssignCourierPayload = z.infer<typeof assignCourierPayload>;
export type ImportProductPayload = z.infer<typeof importProductPayload>;
