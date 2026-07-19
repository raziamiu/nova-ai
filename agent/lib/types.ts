/**
 * Nova domain model.
 *
 * These types describe everything the Dakio store exposes to Nova (catalog,
 * orders, marketing, logistics, finance) plus everything Nova persists back
 * into the store (memory, activity, prepared actions, reports).
 *
 * All money values are USD dollars. All timestamps are ISO 8601 strings.
 */

// ---------------------------------------------------------------------------
// Catalog & inventory
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  price: number;
  /** Strike-through price shown in the storefront, if discounted. */
  compareAtPrice: number | null;
  /** Unit cost from the current supplier. */
  cost: number;
  stock: number;
  reorderPoint: number;
  supplierId: string;
  status: "active" | "draft" | "archived";
  rating: number;
  reviewCount: number;
  /** Units sold per week, most recent week last (8 weeks). */
  weeklyVelocity: number[];
  tags: string[];
  createdAt: string;
}

export interface TrendingProduct {
  id: string;
  name: string;
  category: string;
  /** 0-100 composite of search volume + social traction. */
  demandScore: number;
  /** 0-100, higher = more crowded. */
  competitionScore: number;
  estimatedUnitCost: number;
  suggestedPrice: number;
  estimatedMarginPct: number;
  source: string;
  insight: string;
}

// ---------------------------------------------------------------------------
// Customers, orders, carts
// ---------------------------------------------------------------------------

export type CustomerSegment = "vip" | "repeat" | "new" | "at-risk";

export interface Customer {
  id: string;
  name: string;
  email: string;
  segment: CustomerSegment;
  ordersCount: number;
  lifetimeValue: number;
  lastOrderAt: string | null;
  notes: string;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export type OrderStatus =
  | "placed"
  | "paid"
  | "fulfilled"
  | "delivered"
  | "rto" // returned to origin — delivery failed
  | "refund_requested"
  | "refunded"
  | "cancelled";

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  status: OrderStatus;
  courierId: string | null;
  placedAt: string;
  deliveredAt: string | null;
  region: string;
}

export type CartRecoveryState =
  | "none" // nothing done yet
  | "message_prepared"
  | "message_sent"
  | "recovered"
  | "lost";

export interface AbandonedCart {
  id: string;
  customerId: string;
  items: OrderItem[];
  value: number;
  abandonedAt: string;
  recoveryState: CartRecoveryState;
  recoveryMessage: string | null;
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export type CampaignChannel = "meta" | "google" | "tiktok" | "email" | "sms";
export type CampaignStatus = "active" | "paused" | "scheduled" | "completed";

export interface CampaignDayStat {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  dailyBudget: number;
  productIds: string[];
  startedAt: string;
  /** Most recent day last (up to 14 days). */
  dailyStats: CampaignDayStat[];
  notes: string;
}

export type SocialPostStatus = "draft" | "scheduled" | "published";

export interface SocialPost {
  id: string;
  platform: "instagram" | "tiktok" | "facebook";
  format: "reel" | "post" | "story";
  caption: string;
  productIds: string[];
  status: SocialPostStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
}

export interface Discount {
  id: string;
  code: string;
  percentOff: number;
  scope: "order" | "product";
  productIds: string[];
  /** Customer this code was issued to, if targeted. */
  customerId: string | null;
  expiresAt: string;
  active: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export type TicketStatus = "open" | "waiting_on_customer" | "escalated" | "resolved";

export interface SupportTicket {
  id: string;
  customerId: string;
  orderId: string | null;
  subject: string;
  category: "order_tracking" | "refund" | "product_question" | "complaint" | "other";
  status: TicketStatus;
  openedAt: string;
  messages: { from: "customer" | "nova" | "owner"; text: string; at: string }[];
}

export interface CustomerMessage {
  id: string;
  customerId: string;
  channel: "email" | "sms" | "chat";
  purpose:
    | "cart_recovery"
    | "support_reply"
    | "sales_reply"
    | "upsell"
    | "winback"
    | "order_update";
  subject: string | null;
  body: string;
  relatedId: string | null; // cart id, ticket id, order id …
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Suppliers & logistics
// ---------------------------------------------------------------------------

export interface SupplierOffer {
  productId: string;
  unitCost: number;
  leadTimeDays: number;
}

export interface Supplier {
  id: string;
  name: string;
  country: string;
  /** 0-1 fraction of POs delivered on time. */
  reliabilityScore: number;
  /** 0-1 quality audit score. */
  qualityScore: number;
  offers: SupplierOffer[];
  /** Days of delay on currently open POs, 0 if none. */
  currentDelayDays: number;
  notes: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  total: number;
  status: "draft" | "placed" | "in_transit" | "received" | "cancelled";
  createdAt: string;
  expectedAt: string;
}

export interface Courier {
  id: string;
  name: string;
  costPerShipment: number;
  avgDeliveryDays: number;
  /** 0-1 fraction delivered within promise. */
  onTimeRate: number;
  /** 0-1 fraction returned to origin. */
  rtoRate: number;
  regions: string[];
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export interface ExpenseEntry {
  id: string;
  date: string; // YYYY-MM-DD
  category: "ads" | "shipping" | "software" | "refunds" | "cogs" | "fees" | "other";
  amount: number;
  note: string;
}

// ---------------------------------------------------------------------------
// Nova agent data (persisted in the store alongside business data)
// ---------------------------------------------------------------------------

/**
 * PRD autonomy levels:
 * 0 observation only · 1 recommendations · 2 prepared actions ·
 * 3 autonomous low-risk · 4 business operator (guardrails).
 */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface Guardrails {
  /** Largest discount Nova may ever issue, in percent. */
  maxDiscountPct: number;
  /** Largest single price change, in percent of current price. */
  maxPriceChangePct: number;
  /** Largest daily-budget change on a campaign, in percent. */
  maxBudgetChangePct: number;
  /** Never let a price change push margin below this percent. */
  minMarginPct: number;
  /** Purchase orders above this total always need approval. */
  maxAutoPurchaseOrderTotal: number;
  /** Refunds above this amount always need approval. */
  maxAutoRefundTotal: number;
}

export interface AutonomyConfig {
  level: AutonomyLevel;
  guardrails: Guardrails;
  updatedAt: string;
}

export type RiskClass = "low" | "medium" | "high";

export const NOVA_DEPARTMENTS = [
  "ceo",
  "marketing",
  "sales",
  "support",
  "product_research",
  "inventory",
  "supplier_manager",
  "courier_manager",
  "finance",
  "growth",
] as const;

export type NovaDepartment = (typeof NOVA_DEPARTMENTS)[number];

/** Every mutation Nova can perform on the store. */
export type ActionType =
  | "update_campaign"
  | "create_campaign"
  | "publish_social_post"
  | "update_price"
  | "create_discount"
  | "send_customer_message"
  | "resolve_ticket"
  | "create_purchase_order"
  | "switch_supplier"
  | "assign_courier"
  | "import_product";

/**
 * The model must justify every action it takes — this rides along on every
 * action tool call and is stored on the action record (PRD trust system).
 */
export interface ActionJustification {
  /** Why Nova is doing this, stated with evidence. */
  reason: string;
  /** What Nova expects to happen, quantified where possible. */
  expectedImpact: string;
  /** Nova's own confidence, 0-1. */
  confidence: number;
}

export type ActionStatus =
  | "executed" // ran immediately under current autonomy level
  | "prepared" // queued, waiting for owner approval
  | "blocked" // guardrail or autonomy level forbids it
  | "rejected" // owner said no
  | "undone"; // executed, then rolled back

export interface ActionRecord {
  id: string;
  type: ActionType;
  department: NovaDepartment;
  title: string;
  /** Tool input that produced (or will produce) the mutation. */
  payload: Record<string, unknown>;
  justification: ActionJustification;
  riskClass: RiskClass;
  status: ActionStatus;
  /** Human-readable outcome, set when executed. */
  outcome: string | null;
  /** Whether this action can be rolled back after execution. */
  undoable: boolean;
  /** Snapshot the executor needs to roll back. */
  undoData: Record<string, unknown> | null;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface ActivityEntry {
  id: string;
  at: string;
  department: NovaDepartment;
  kind: "action" | "analysis" | "communication" | "report" | "alert";
  title: string;
  detail: string;
  /** Human-equivalent minutes of work this saved the founder. */
  minutesSaved: number;
  /** Revenue this activity influenced, when measurable. */
  revenueInfluence: number;
  actionId: string | null;
}

export type MemoryNamespace =
  | "goals"
  | "brand"
  | "preferences"
  | "rules"
  | "insights"
  | "experiments"
  | "customers";

export interface MemoryEntry {
  namespace: MemoryNamespace;
  key: string;
  value: string;
  updatedAt: string;
}

export interface NovaReport {
  id: string;
  kind: "morning" | "night_plan" | "weekly_strategy" | "pulse" | "custom";
  title: string;
  /** Markdown body, rendered by the Dakio dashboard. */
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Seed container
// ---------------------------------------------------------------------------

export interface StoreSeed {
  products: Product[];
  trendingProducts: TrendingProduct[];
  customers: Customer[];
  orders: Order[];
  abandonedCarts: AbandonedCart[];
  campaigns: Campaign[];
  socialPosts: SocialPost[];
  discounts: Discount[];
  supportTickets: SupportTicket[];
  customerMessages: CustomerMessage[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  couriers: Courier[];
  expenses: ExpenseEntry[];
  autonomy: AutonomyConfig;
  memory: MemoryEntry[];
  activity: ActivityEntry[];
  actions: ActionRecord[];
  reports: NovaReport[];
}
