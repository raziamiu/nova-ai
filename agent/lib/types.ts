/**
 * Nova domain model.
 *
 * These types describe everything the Dakio store exposes to Nova (catalog,
 * orders, marketing, logistics, finance) plus everything Nova persists back
 * into the store (memory, activity, prepared actions, reports).
 *
 * All money values are ৳ (BDT), Dakio's currency. All timestamps are ISO 8601
 * strings.
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

/* ── Grow Lab ────────────────────────────────────────────────────────────
 *
 * The six founder-facing Grow modules (Campaigns, Content Studio, Broadcast,
 * Research, Growth, Goals) — real Dakio rows, read via `/api/v1/store/grow/*`.
 *
 * These are deliberately distinct from {@link Campaign} and {@link SocialPost}
 * above: those model Meta ad insights, these model the merchant's own Grow Lab
 * records. Same words, different things — the `Grow` prefix keeps them apart.
 *
 * Every row carries `createdBy` and `novaActionId` so Nova can tell its own
 * work from the founder's and link a row back to the receipt explaining it.
 * Attribution is metadata: a null `novaActionId` never means a row is invalid.
 */

/** Who authored a Grow row. Nova's rows are always explained by a receipt. */
export type GrowAuthor = "founder" | "nova";

export interface GrowCampaign {
  id: string;
  name: string;
  /** Sales | Awareness | Launch */
  goal: string;
  status: "Draft" | "Scheduled" | "Live" | "Paused" | "Ended";
  productIds: string[];
  /** FB | IG | WA | SMS | EMAIL */
  channels: string[];
  startsAt: string | null;
  endsAt: string | null;
  /**
   * Planned spend in ৳. Dakio has no ads-management scope, so this figure is
   * never actually spent — never describe it as money that went out.
   */
  budget: number | null;
  createdBy: GrowAuthor;
  novaActionId: string | null;
  createdAt: string;
}

export interface GrowPost {
  id: string;
  /** REEL | PHOTO | CAROUSEL | STORY | TEXT */
  type: string;
  title: string;
  caption: string;
  mediaUrl: string | null;
  /** IG | FB — only FB can actually publish today. */
  channels: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  status: "Draft" | "Scheduled" | "Published" | "Failed";
  campaignId: string | null;
  /** Set once a real publish happened, e.g. `{ fb: "123_456" }`. */
  externalIds: Record<string, string> | null;
  /** Columns exist; no insights ingester writes them yet, so null ≠ zero. */
  metrics: Record<string, number> | null;
  createdBy: GrowAuthor;
  novaActionId: string | null;
  createdAt: string;
}

export interface GrowBroadcast {
  id: string;
  name: string;
  audienceKey: string;
  audienceLabel: string;
  /** WA | SMS | EMAIL */
  channel: string;
  message: string;
  scheduledAt: string | null;
  sentAt: string | null;
  /**
   * Never "Sent" today: Dakio has no merchant→customer channel, so broadcasts
   * are prepared and held. Do not report one as delivered.
   */
  status: "Draft" | "Scheduled" | "Sending" | "Sent" | "Failed";
  recipientCount: number;
  /** Held back by the 7-day cool-off the product promises. */
  skippedCount: number;
  deliveredCount: number;
  readCount: number;
  ordersCount: number;
  revenue: number;
  createdBy: GrowAuthor;
  novaActionId: string | null;
  createdAt: string;
}

export interface GrowIdea {
  id: string;
  /** trend | product */
  kind: string;
  label: string;
  source: string | null;
  note: string | null;
  supplier: string | null;
  costPrice: number | null;
  sellPrice: number | null;
  status: "saved" | "queued" | "imported" | "dismissed";
  /** Set once the idea became a real draft Product. */
  productId: string | null;
  importedAt: string | null;
  createdBy: GrowAuthor;
  novaActionId: string | null;
  createdAt: string;
}

/** One month's target. Actuals are Nova's own arithmetic over orders. */
export interface GrowGoal {
  id: string;
  /** 'YYYY-MM' in store-local (Bangladesh) time. */
  month: string;
  revenueGoal: number;
  ordersGoal: number;
  createdAt: string;
}

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

// ---------------------------------------------------------------------------
// Stage 1 "Law" — authority (PRD §4, §5, E-1/E-2/E-3/E-5)
// ---------------------------------------------------------------------------

/**
 * The ladder, named. Numeric storage stays 0–4; these are what the founder
 * reads, and what Nova must use when it narrates its own authority.
 */
export const AUTONOMY_LADDER = {
  0: "Observe",
  1: "Suggest",
  2: "Draft",
  3: "Operator",
  4: "Acting CEO",
} as const;

/**
 * How much rope Nova has in a given door. A ceiling, NOT a second level —
 * effective capability is `min(mode, level)`.
 *
 *  manual     — Nova may only suggest; drafts are held.
 *  assisted   — everything lands as a draft for the founder (the default).
 *  autonomous — level semantics apply as written.
 */
export type NovaMode = "manual" | "assisted" | "autonomous";

/**
 * The canonical guardrail trio (E-2) plus the shipped six as a platform
 * superset. Versioned and immutable: a receipt can always be re-read against
 * the limits that were in force when the action ran.
 */
export interface NovaGuardrailsV2 {
  version: number;
  /** ৳ in MINOR units (poisha) — integer arithmetic, no float drift. */
  dailySpendCapMinor: number;
  maxDiscountPct: number;
  /** Freeform founder locks, e.g. ["SAREE PRICING"]. Data, never instructions. */
  noTouch: string[];
  /** The six shipped numeric caps, evaluated after the trio. */
  platform: Guardrails;
}

/** A duty as the authority seam sees it (mirrored per tenant). */
export interface DutyState {
  key: string;
  minLevel: number;
  enabled: boolean;
  doorExists: boolean;
}

/** Everything `evaluateAuthority` needs, composed in one read per turn. */
export interface AuthorityState {
  level: AutonomyLevel;
  /** L4 stays locked until trust is earned; the gate refuses to exceed this. */
  earnedLevel: AutonomyLevel;
  guardrails: NovaGuardrailsV2;
  /** Keyed by scope: "store" | "door:<module>". */
  modes: Record<string, NovaMode>;
  /** Keyed by duty key. Absent = unknown duty, which fails closed. */
  duties: Record<string, DutyState>;
  /** Store-local day spend already executed today, ৳ minor units. */
  spentTodayMinor: number;
}

/**
 * What the seam decides.
 *
 *  execute — do it now
 *  draft   — prepare a full artifact behind its door for approval (L2 shape)
 *  suggest — a recommendation only, no artifact (L1 shape)
 *  refuse  — do not do it, and say which rule said so
 */
export type AuthorityVerdict = "execute" | "draft" | "suggest" | "refuse";

export interface AuthorityDecision {
  verdict: AuthorityVerdict;
  riskClass: RiskClass;
  /**
   * The exact rule that decided, e.g. `founder_only:bulk_refund`,
   * `guardrail:daily_spend_cap`, `no_touch:saree pricing`, `duty:min_level`.
   * Owner-safe, reproducible, and the string the escalation card shows.
   */
  rule: string;
  /** Founder-facing English explanation. */
  explanation: string;
  /** Founder-facing Bangla explanation (bn+en, §14 NFR). */
  explanationBn: string;
  /** Which guardrail version judged this, for the receipt. */
  guardrailsVersion: number;
  /** Present when a refusal should be raised to the founder, not dropped. */
  escalation?: { reason: string; rule: string; raisedAt: string };
}

export type RiskClass = "low" | "medium" | "high";

export const NOVA_DEPARTMENTS = [
  "ceo",
  "marketing",
  "sales",
  "support",
  "product_research",
  "inventory",
  "operations",
  "shipping",
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
  | "import_product"
  /** Founder-only (PRD 5.4): Nova may propose, never execute. */
  | "bulk_refund";

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


/**
 * E-9 Decision — a gated action, asked as a question the founder can answer.
 *
 * One record, rendered on every surface. `surfacedIn` records WHERE it has
 * been shown so a single approve can clear it everywhere at once; duplicating the
 * decision per surface is how two copies end up disagreeing about whether it
 * was already answered.
 */
export interface DecisionRecord {
  id: string;
  tag: NovaDepartment;
  kind: "proposal" | "escalation" | "promotion";
  impactLabel: string;
  title: string;
  paramsLine: string;
  why: string;
  /** The E-8 action this asks about; payload, receipt and undo live there. */
  actionId: string;
  bundleRef: string | null;
  status: "queued" | "approved" | "later" | "rejected" | "frozen" | "expired" | "undone";
  queuePos: number;
  surfacedIn: string[];
  /** 1 = pinned (escalation or high risk), 5 = normal. */
  priority: number;
  /** Which no-touch lock froze it — a founder must be told which. */
  frozenByLock: string | null;
  expiresAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

// ── Night shift outputs (E-4 / E-6 / E-7 / E-16, Stage 3) ──────────────────

/** E-6 — one of the three metrics a department's grade was computed from. */
export interface ScoreMetric {
  label: string;
  value: string;
  targetText: string;
  pct: number;
  tone: "good" | "warn" | "bad";
}

/** E-4 — a department's nightly grade, memo, and now/next, with the metrics. */
export interface DepartmentGrade {
  key: NovaDepartment;
  grade: string;
  statusLine?: string | null;
  now?: string | null;
  next?: string[];
  memo?: string | null;
  metrics?: ScoreMetric[];
  gradedAt?: string;
}

export type PlanItemStatus = "DONE" | "IN_PROGRESS" | "WAITING_ON_YOU" | "SCHEDULED" | "NEEDS_DOOR";

/** E-7 — a plan-board row. Over-authority items are born WAITING_ON_YOU with a
 *  decisionRef that the approve transaction flips. */
export interface PlanItem {
  id: string;
  department: NovaDepartment;
  status: PlanItemStatus;
  title: string;
  detail?: string | null;
  progressPct: number;
  decisionRef?: string | null;
  nightShiftDate?: string | null;
}

export interface BriefTile {
  key: string;
  label: string;
  value?: number;
  valueMinor?: number;
  basis: "measured" | "estimated";
  evidenceQuery: string;
}

export interface BriefDecisionRef {
  id: string;
  title: string;
  impactLabel: string;
  priority: number;
  tag?: string;
}

/** E-16 — the structured morning brief. Tiles are computed server-side; the
 *  night shift supplies only the narrative. */
export interface MorningBrief {
  id: string;
  day: string;
  narrative: string;
  tiles: BriefTile[];
  decisionRefs: BriefDecisionRef[];
  plannedVsDone?: unknown;
  openedAt: string | null;
}

// ── Brand voice (E-12) + voice scoring (Stage 4 "Craft") ───────────────────

export type BrandLanguage = "bn" | "en";

export interface BrandRule {
  kind: "do" | "dont";
  /** The phrase or instruction, in English. */
  text: string;
  /** Bangla parity, when the rule is language-specific. */
  textBn?: string;
}

/** E-12 — the structured brand profile. Memory stays the narrative layer; this
 *  is the checkable truth a draft is scored against. One per tenant. */
export interface BrandProfile {
  toneWords: string[];
  palette: string[];
  rules: BrandRule[];
  languages: BrandLanguage[];
  assets: {
    logoRef?: string;
    boilerplateEn?: string;
    boilerplateBn?: string;
    hashtags?: string[];
  };
  /** Below this 0–100 score a draft is flagged off-voice. Default 70. */
  threshold?: number;
}

export type ContentLanguage = "bn" | "en" | "mixed";

export type ContentType =
  | "post" | "reel" | "story" | "captions" | "email" | "sms" | "push" | "product_desc";

export interface VoiceViolation {
  /** Machine slug: banned_phrase | missing_required | language_mismatch | too_long | tone_thin | emoji_over | hashtag_over */
  code: string;
  /** Founder-facing sentence — cites the draft, never an unexplained score (§2.4). */
  message: string;
  /** The offending fragment, when there is one to quote. */
  evidence?: string;
}

export interface VoiceScore {
  score: number;
  flagged: boolean;
  violations: VoiceViolation[];
}

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
  /**
   * Phase 06 — Grow Lab. Optional: the demo store has no Grow modules seeded,
   * so Nova sees them genuinely empty rather than pretending a founder had
   * been working in them.
   */
  /** Stage 1 authority: optional so earlier seeds need not declare them. */
  dailySpendCapMinor?: number;
  noTouch?: string[];
  modes?: Record<string, NovaMode>;
  /** Stage 2 decisions; the demo store starts with an empty desk. */
  decisions?: DecisionRecord[];
  growCampaigns?: GrowCampaign[];
  growPosts?: GrowPost[];
  growBroadcasts?: GrowBroadcast[];
  growIdeas?: GrowIdea[];
  growGoals?: GrowGoal[];
}
