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
 * Derived compatibility projection of the receipt ({reason, expectedImpact,
 * confidence}) kept for existing readers. The receipt is the source of truth
 * since Stage 0 — never author a justification directly.
 */
export interface ActionJustification {
  /** Why Nova is doing this, stated with evidence. */
  reason: string;
  /** What Nova expects to happen, quantified where possible. */
  expectedImpact: string;
  /** Nova's own confidence, 0-1. */
  confidence: number;
}

/** One supporting observation behind an action (PRD E-8 receipt.evidence). */
export interface ReceiptEvidence {
  /** Where the observation came from, e.g. "orders", "guardrail", "campaign cmp-…". */
  source: string;
  /** The observation itself, e.g. "0 orders in 30d; 2 campaigns scheduled". */
  note: string;
  /** Optional named metric this evidence cites. */
  metric?: string;
  /** Optional value for the metric. */
  value?: string | number;
  /** Optional evidence window, e.g. "30d". */
  window?: string;
}

/**
 * The PRD E-8 receipt — the founder-facing evidence record on EVERY state
 * change (executed, prepared, and blocked alike). A write missing its receipt
 * is a failed write (§16.2, enforced at the dakio-api layer).
 */
export interface ActionReceipt {
  reason: string;
  expectedImpact: string;
  /** 0-1. */
  confidence: number;
  /** Non-empty for post-Stage-0 rows; empty only on `migrated` backfills. */
  evidence: ReceiptEvidence[];
  /** Display snapshot before the mutation (null for drafts/refusals). */
  before: Record<string, unknown> | null;
  /** Display snapshot after the mutation (null for drafts/refusals). */
  after: Record<string, unknown> | null;
  /** True on rows backfilled from the pre-Stage-0 justification shape. */
  migrated?: boolean;
}

export type ActionStatus =
  | "executed" // ran immediately under current autonomy level
  | "prepared" // queued, waiting for owner approval
  | "blocked" // guardrail or autonomy level forbids it
  | "rejected" // owner said no
  | "undone"; // executed, then rolled back

export type ActionActor = "nova" | "founder" | "system";

export interface ActionRecord {
  id: string;
  type: ActionType;
  department: NovaDepartment;
  title: string;
  /** Tool input that produced (or will produce) the mutation. */
  payload: Record<string, unknown>;
  /** Derived from `receipt` — kept for readers that predate Stage 0. */
  justification: ActionJustification;
  /** The E-8 receipt. Required on every write since Stage 0. */
  receipt: ActionReceipt;
  riskClass: RiskClass;
  status: ActionStatus;
  /** Human-readable outcome, set when executed. */
  outcome: string | null;
  /** Whether this action can be rolled back after execution. */
  undoable: boolean;
  /** Snapshot the executor needs to roll back (internal — not the receipt's display snapshot). */
  undoData: Record<string, unknown> | null;
  /** Who performed it: nova | founder | system. */
  actor: ActionActor;
  /** The door record this action touched, e.g. "coupon:ck…". */
  targetRef: string | null;
  /** E-22 department agent id — null until phase 14. */
  agentId: string | null;
  /** E-5 duty key — null until phase 07 seeds the registry. */
  dutyRef: string | null;
  /** executedAt + 24h on undoable executed actions (undo is a right with a clock). */
  undoDeadline: string | null;
  undoneAt: string | null;
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
  /**
   * Business entity this activity relates to (cart id, ticket id, order id …).
   * Lets the nightly attribution pass join, e.g., a cart-recovery message to
   * the order it recovered and replace the heuristic influence with actuals.
   */
  relatedId?: string | null;
  /**
   * How `revenueInfluence` was derived. `estimated` = heuristic at write time;
   * `measured` = an attribution pass matched it to a real outcome (with a note).
   */
  revenueBasis?: "estimated" | "measured";
  /** Provenance for a measured influence (e.g. the matched order id). */
  revenueProvenance?: string | null;
}

export type MemoryNamespace =
  | "goals"
  | "brand"
  | "preferences"
  | "rules"
  | "insights"
  | "experiments"
  | "customers";

/**
 * Where a memory came from. Governs trust and owner-visibility (Phase 04):
 * `owner` = the founder told Nova; `nova` = Nova wrote it during a turn;
 * `reflection` = distilled by a nightly reflection job; `system` = seeded.
 */
export type MemorySource = "owner" | "nova" | "reflection" | "system";

/** Audit trail tying a learned memory back to the episodes that produced it. */
export interface MemoryProvenance {
  /** Action ids this memory was distilled from (rejections, experiments). */
  actionIds?: string[];
  /** Session that wrote it, when known. */
  sessionId?: string;
  /** Free-form note, e.g. the reflection summary line. */
  note?: string;
}

export interface MemoryEntry {
  namespace: MemoryNamespace;
  key: string;
  value: string;
  updatedAt: string;
  /**
   * Fields added in Phase 04. Optional so Phase 1–3 seeds and writers that
   * only carry {namespace,key,value} still type-check; the service and
   * backend normalize missing values to defaults (source "owner", weight 1).
   */
  source?: MemorySource;
  provenance?: MemoryProvenance | null;
  /** Retrieval boost; decays over time and via the forgetting pass. */
  weight?: number;
  /** Optional TTL — the entry stops being retrieved after this instant. */
  expiresAt?: string | null;
  /**
   * Semantic embedding used for vector recall. Filled asynchronously by the
   * embed worker (an "outbox": entries with `embedding == null` are pending).
   * Never rendered into the model prompt — an index, not content.
   */
  embedding?: number[] | null;
}

/** The relaxed input accepted by `upsertMemory` — Phase 04 fields optional. */
export interface MemoryUpsert {
  namespace: MemoryNamespace;
  key: string;
  value: string;
  source?: MemorySource;
  provenance?: MemoryProvenance | null;
  weight?: number;
  expiresAt?: string | null;
  embedding?: number[] | null;
}

// ---------------------------------------------------------------------------
// Procedural memory — playbooks (reflection can propose; owner promotes)
// ---------------------------------------------------------------------------

export type PlaybookStatus = "candidate" | "active" | "retired";

export interface NovaPlaybook {
  id: string;
  name: string;
  description: string;
  /** The procedure body, served as a dynamic skill when `active` (Phase 06). */
  markdown: string;
  status: PlaybookStatus;
  /** What this playbook was distilled from (action ids, source note). */
  createdFrom: MemoryProvenance | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Experiments — hypotheses evaluated against actuals (data flywheel)
// ---------------------------------------------------------------------------

export type ExperimentStatus = "running" | "won" | "lost" | "inconclusive";

export interface NovaExperiment {
  id: string;
  hypothesis: string;
  /** Actions that enacted the experiment (a campaign change, a price test). */
  actionIds: string[];
  /** What the experiment moves, e.g. "roas7d" or "revenue7d". */
  metric: string;
  baseline: number;
  target: number;
  actual: number | null;
  status: ExperimentStatus;
  startedAt: string;
  evaluatedAt: string | null;
}

export interface NovaReport {
  id: string;
  kind: "morning" | "night_plan" | "weekly_strategy" | "pulse" | "custom";
  title: string;
  /** Markdown body, rendered by the Dakio dashboard. */
  body: string;
  /** Phase 05 — a job-filed report passes its job's dedupeKey so a re-leased rerun re-files the SAME row instead of a duplicate. Omitted for ad hoc (non-job) reports. */
  dedupeKey?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Inbox — inbound store events (Phase 2.3). Dakio enqueues these on real
// commerce mutations (order created/updated, cart abandoned); Nova drains
// unprocessed ones on its regular schedule cadence instead of only ever
// discovering them by polling reads. Persisted store-side (Nova is stateless),
// same as memory/actions/activity/reports.
// ---------------------------------------------------------------------------

export type InboxEventType = "order.created" | "order.updated" | "cart.abandoned";

export interface InboxEvent {
  id: string;
  eventType: InboxEventType;
  /** Shape depends on eventType — see `emitOrderCreated`/`emitOrderUpdated`/`emitCartAbandoned` in dakio-api's novaEvents.js. */
  payload: Record<string, unknown>;
  receivedAt: string;
  processedAt: string | null;
}

// ---------------------------------------------------------------------------
// Proactive job queue (Phase 05). Per-tenant daily rhythm: a JobDef is the
// tenant's cadence config for a job kind (edited by the founder eventually —
// Phase 06); a Job is one due/leased/done unit of work, expanded from a def's
// occurrence or enqueued by the event→job mapper. Persisted store-side, same
// as memory/actions/activity/reports/inbox — Nova itself holds no job state.
// ---------------------------------------------------------------------------

export type JobKind = "morning_report" | "pulse" | "cart_sweep" | "night_ops" | "weekly_strategy" | "reflection";
export type JobStatus = "due" | "leased" | "done" | "failed" | "skipped";

export interface NovaJobDef {
  kind: JobKind;
  /** 5-field cron string (minute hour dom month dow; dom/month must be '*'), interpreted in `tz`. */
  cadence: string;
  tz: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
}

export interface NovaJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  dueAt: string;
  /** 1 = approval-surfacing/critical … 9 = lowest (pulse). */
  priority: number;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  dedupeKey: string;
  leaseUntil: string | null;
  /** Fencing value for this specific lease — pass it back to completeJob/releaseJob so a stale (superseded) lease's call is a safe no-op. */
  leaseToken: string | null;
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
  /** Phase 04 — optional so Phase 1–3 seeds don't need to declare them. */
  playbooks?: NovaPlaybook[];
  experiments?: NovaExperiment[];
  /** Phase 2.3 — optional; the demo backend has no external event source, so seeds that omit it simply start with an empty inbox. */
  inboxEvents?: InboxEvent[];
  /** Phase 05 — optional so earlier-phase seeds don't need to declare them; DemoStore lazily initializes an empty queue. */
  jobDefs?: NovaJobDef[];
  jobs?: NovaJob[];
}
