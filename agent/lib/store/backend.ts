/**
 * In-memory demo implementation of the Dakio store.
 *
 * Plays the role of the Express store server: holds business data and
 * Nova's agent data, and applies mutations. State lives for the duration of
 * the process (one continuous demo "day" per server run) and is seeded with
 * a realistic dataset anchored to the current wall-clock time.
 *
 * Every StoreClient method is declared `async` to satisfy the interface,
 * even though the in-memory data access itself never actually awaits
 * anything — that's the point: callers already treat every store call as a
 * network round trip, so swapping this class for an HTTP client later is a
 * one-line change in `client.ts`, not a ripple through the agent.
 */

import type {
  AbandonedCart,
  ActionRecord,
  ActionStatus,
  ActivityEntry,
  AuthorityState,
  AutonomyConfig,
  Campaign,
  CartRecoveryState,
  Courier,
  BrandProfile,
  Customer,
  CustomerMessage,
  ContentDraftInput,
  ContentItem,
  DecisionRecord,
  DepartmentGrade,
  Discount,
  ExpenseEntry,
  GrowBroadcast,
  GrowCampaign,
  GrowGoal,
  GrowIdea,
  GrowPost,
  InboxConversationView,
  InboxEvent,
  InboxHandoverRequest,
  InboxHandoverResult,
  InboxMessageView,
  InboxPromise,
  InboxReplyRequest,
  InboxReplyResult,
  InboxThread,
  JobKind,
  LinkCustomerRequest,
  LinkCustomerResult,
  MemoryEntry,
  MemoryNamespace,
  MemoryUpsert,
  MorningBrief,
  NovaExperiment,
  NovaJob,
  NovaJobDef,
  NovaPlaybook,
  NovaReport,
  Order,
  OrderStatus,
  PlanItem,
  Product,
  PromiseKind,
  PromiseSettleRequest,
  PurchaseOrder,
  SocialPost,
  StoreSeed,
  Supplier,
  SupportTicket,
  TicketStatus,
  TrendingProduct,
} from "../types";
import type { StoreClient } from "./client";
import { InboxSendRefused } from "./client";
import { DUTIES, DOORS } from "../duties";
import { SPEND_MINOR } from "../nova/authority";
import { NOVA_MAX_CONSECUTIVE_OUTBOUND } from "../nova/inboxIntents";
import { createSeed } from "./seed";
import { lastOccurrenceAtOrBefore } from "../jobs/cron";
import { randomUUID } from "node:crypto";

// 1 = approval-surfacing/critical … 9 = lowest. Mirrors dakio-api's
// novaJobs.js — no dedicated approval-surfacing job kind exists yet.
const PRIORITY_BY_KIND: Record<JobKind, number> = {
  inbox_reply: 1, // reserved fast-lane band — a waiting customer outranks everything
  morning_report: 3,
  night_ops: 3,
  // Stage 10 module 03: a promise coming due is work the customer is already
  // expecting, so it rides the same band as the morning report rather than the
  // sweeps' band. Canonical C-15 — one unified kind, priority 3.
  followup: 3,
  weekly_strategy: 4,
  reflection: 6,
  // Stage 10 module 03: nightly/quiet-lane housekeeping. Nobody is waiting on
  // any of these, and all three author work for the founder rather than the
  // customer, so they sit with reflection at the bottom of the useful band.
  promise_sweep: 6,
  identity_merge_sweep: 6,
  conversation_distill: 6,
  cart_sweep: 5,
  pulse: 9,
};
const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const CART_SWEEP_DEBOUNCE_MINUTES = 30;

function backoffMinutes(attempts: number): number {
  return Math.min(30, 2 ** attempts);
}

/**
 * The demo's phone fold (Stage 10 module 03). Deliberately a SIMPLIFIED stand-in
 * for dakio-api's `normalizePhone`/`phoneVariants` (`src/lib/customerRisk.js`),
 * which is the only real matcher and the only one module 03 pins with tests:
 * digits only, then the `88` country code dropped so `+8801…`, `8801…` and
 * `01…` fold to one string. It is named `demo…` so nobody mistakes it for the
 * shipped ladder and re-implements identity matching on this side of the wire.
 */
function demoNormalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D+/g, "");
  return digits.startsWith("88") ? digits.slice(2) : digits;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One demo conversation: the thread row, its transcript, and the queued sends.
 * Kept OUT of `StoreSeed` deliberately — a seeded dataset would imply real
 * customers wrote in, and the demo backend has no Meta webhook. Threads exist
 * here only when a caller explicitly seeds one (see `seedInboxConversation`).
 */
interface DemoInboxThread {
  conversation: InboxConversationView;
  messages: InboxMessageView[];
  customer: Record<string, unknown> | null;
  /** Module 03 D2: basis-only, and never the candidate's id or data. */
  proposal: { basis: string } | null;
  /**
   * Module 03 provenance. Internal demo state, NOT part of the wire view —
   * `conversationOut` does not expose which rung of the ladder wrote the join,
   * and inventing that field here would invent a contract dakio-api never made.
   */
  customerLinkSource: string | null;
  /** A normalized in-thread phone that matched ZERO customers (D4). */
  claimedPhone: string | null;
  outbounds: {
    id: string;
    novaActionId: string;
    chunks: { text: string }[];
    status: string;
    scheduledAt: string;
  }[];
}

/** What a test/demo caller may set when materializing a thread. */
export interface DemoInboxSeed {
  id: string;
  platform?: string;
  senderName?: string | null;
  customerId?: string | null;
  handledBy?: string | null;
  novaLockedAt?: string | null;
  novaEnabled?: boolean;
  lastIntent?: string | null;
  windowExpiresAt?: string | null;
  customer?: Record<string, unknown> | null;
  /**
   * Module 03 D2. Seedable because nothing in {@link StoreClient} can write a
   * proposal — the PATCH that sets it is a merchant/service route Nova does not
   * call — so an unlinked-but-proposed thread is only reachable by seeding one.
   */
  proposal?: { basis: string } | null;
  messages?: {
    direction: "in" | "out";
    actor: string;
    text: string;
    sentAt?: string;
    id?: string;
    purpose?: string | null;
    novaActionId?: string | null;
  }[];
}

/**
 * What a test/demo caller may set when materializing a promise. Same
 * discipline as {@link DemoInboxSeed}: a promise exists only because a reply
 * was actually queued, so the demo never conjures one on read.
 */
export interface DemoPromiseSeed {
  id?: string;
  conversationId?: string | null;
  customerId?: string | null;
  channelKind?: string;
  madeBy?: "nova" | "founder";
  text: string;
  kind: PromiseKind;
  /** ISO 8601. Defaults to 24h out — a plausible "kal janabo". */
  dueAt?: string;
  status?: InboxPromise["status"];
}

export class DemoStore implements StoreClient {
  private readonly data: StoreSeed;
  private idCounter = 9000;
  /** Front Office threads. Empty until a caller seeds one — never invented. */
  private readonly inbox = new Map<string, DemoInboxThread>();
  /** The commitments ledger (module 03 D7). Empty until a reply makes a promise. */
  private readonly promises: InboxPromise[] = [];
  /**
   * The demo's phone book (module 03 D4). Empty until a caller seeds it, for
   * exactly the reason threads are: `Customer` in this backend has no phone
   * column, so a `linkCustomer` that matched anyway would be inventing the one
   * fact the whole identity ladder rests on. Unseeded, every link honestly
   * answers `matched:false`.
   */
  private readonly customerPhones: { phone: string; customerId: string }[] = [];

  constructor(seed?: StoreSeed) {
    this.data = seed ?? createSeed(Date.now());
  }

  now(): string {
    return new Date().toISOString();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  private sinceCutoff(sinceDays: number): number {
    return Date.now() - sinceDays * DAY_MS;
  }

  private mustFind<T>(value: T | undefined, kind: string, id: string): T {
    if (value === undefined) {
      throw new Error(`${kind} not found: ${id}`);
    }
    return value;
  }

  // ---- Catalog ----

  async listProducts(filter?: { status?: Product["status"]; category?: string }): Promise<Product[]> {
    return this.data.products.filter(
      (p) =>
        (filter?.status === undefined || p.status === filter.status) &&
        (filter?.category === undefined || p.category === filter.category),
    );
  }

  async getProduct(id: string): Promise<Product | null> {
    return this.data.products.find((p) => p.id === id || p.sku === id) ?? null;
  }

  async createProduct(product: Omit<Product, "id" | "createdAt">): Promise<Product> {
    const created: Product = {
      ...product,
      id: this.nextId("prod"),
      createdAt: this.now(),
    };
    this.data.products.push(created);
    return created;
  }

  async updateProduct(
    id: string,
    patch: Partial<
      Pick<Product, "price" | "compareAtPrice" | "stock" | "status" | "supplierId" | "cost">
    >,
  ): Promise<Product> {
    const product = this.mustFind(
      this.data.products.find((p) => p.id === id),
      "Product",
      id,
    );
    Object.assign(product, patch);
    return product;
  }

  async listTrendingProducts(): Promise<TrendingProduct[]> {
    return this.data.trendingProducts;
  }

  // ---- Customers ----

  async listCustomers(filter?: { segment?: Customer["segment"] }): Promise<Customer[]> {
    return this.data.customers.filter(
      (c) => filter?.segment === undefined || c.segment === filter.segment,
    );
  }

  async getCustomer(id: string): Promise<Customer | null> {
    return this.data.customers.find((c) => c.id === id) ?? null;
  }

  // ---- Orders ----

  async listOrders(filter?: { sinceDays?: number; status?: OrderStatus }): Promise<Order[]> {
    const cutoff = filter?.sinceDays !== undefined ? this.sinceCutoff(filter.sinceDays) : null;
    return this.data.orders.filter(
      (o) =>
        (cutoff === null || Date.parse(o.placedAt) >= cutoff) &&
        (filter?.status === undefined || o.status === filter.status),
    );
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.data.orders.find((o) => o.id === id) ?? null;
  }

  async updateOrder(patch: { id: string; status?: OrderStatus; courierId?: string }): Promise<Order> {
    const order = this.mustFind(
      this.data.orders.find((o) => o.id === patch.id),
      "Order",
      patch.id,
    );
    if (patch.status !== undefined) order.status = patch.status;
    if (patch.courierId !== undefined) order.courierId = patch.courierId;
    return order;
  }

  // ---- Abandoned carts ----

  async listAbandonedCarts(state?: CartRecoveryState): Promise<AbandonedCart[]> {
    return this.data.abandonedCarts.filter(
      (c) => state === undefined || c.recoveryState === state,
    );
  }

  async updateCart(
    id: string,
    patch: { recoveryState?: CartRecoveryState; recoveryMessage?: string | null },
  ): Promise<AbandonedCart> {
    const cart = this.mustFind(
      this.data.abandonedCarts.find((c) => c.id === id),
      "Cart",
      id,
    );
    if (patch.recoveryState !== undefined) cart.recoveryState = patch.recoveryState;
    if (patch.recoveryMessage !== undefined) cart.recoveryMessage = patch.recoveryMessage;
    return cart;
  }

  // ---- Marketing ----

  async listCampaigns(status?: Campaign["status"]): Promise<Campaign[]> {
    return this.data.campaigns.filter((c) => status === undefined || c.status === status);
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    return this.data.campaigns.find((c) => c.id === id) ?? null;
  }

  async createCampaign(campaign: Omit<Campaign, "id" | "dailyStats">): Promise<Campaign> {
    const created: Campaign = { ...campaign, id: this.nextId("cmp"), dailyStats: [] };
    this.data.campaigns.push(created);
    return created;
  }

  async updateCampaign(
    id: string,
    patch: Partial<Pick<Campaign, "status" | "dailyBudget" | "notes">>,
  ): Promise<Campaign> {
    const campaign = this.mustFind(
      this.data.campaigns.find((c) => c.id === id),
      "Campaign",
      id,
    );
    Object.assign(campaign, patch);
    return campaign;
  }

  async listSocialPosts(status?: SocialPost["status"]): Promise<SocialPost[]> {
    return this.data.socialPosts.filter((p) => status === undefined || p.status === status);
  }

  async createSocialPost(post: Omit<SocialPost, "id">): Promise<SocialPost> {
    const created: SocialPost = { ...post, id: this.nextId("post") };
    this.data.socialPosts.push(created);
    return created;
  }

  async updateSocialPost(
    id: string,
    patch: Partial<Pick<SocialPost, "status" | "scheduledFor" | "publishedAt">>,
  ): Promise<SocialPost> {
    const post = this.mustFind(
      this.data.socialPosts.find((p) => p.id === id),
      "Social post",
      id,
    );
    Object.assign(post, patch);
    return post;
  }

  async listDiscounts(activeOnly?: boolean): Promise<Discount[]> {
    return this.data.discounts.filter((d) => !activeOnly || d.active);
  }

  async createDiscount(discount: Omit<Discount, "id" | "createdAt">): Promise<Discount> {
    const created: Discount = {
      ...discount,
      id: this.nextId("disc"),
      createdAt: this.now(),
    };
    this.data.discounts.push(created);
    return created;
  }

  /**
   * Stage 1 authority state, composed from the demo seed.
   *
   * The demo store starts with no locks and no per-door modes — a founder who
   * has configured nothing. Guardrails come from the seeded autonomy config so
   * the demo and the gate agree, and `spentTodayMinor` is summed from actions
   * actually executed today rather than tracked separately, which keeps it
   * honest when a test time-travels a record.
   */
  async getAuthority(): Promise<AuthorityState> {
    const autonomy = this.data.autonomy;
    const startOfDay = new Date(this.now().slice(0, 10) + "T00:00:00.000Z").getTime();
    let spentTodayMinor = 0;
    for (const a of this.data.actions) {
      if (a.status !== "executed" || !a.executedAt) continue;
      if (Date.parse(a.executedAt) < startOfDay) continue;
      const spend = SPEND_MINOR[a.type];
      if (spend) spentTodayMinor += Math.max(0, spend(a.payload as Record<string, unknown>) || 0);
    }
    return {
      level: autonomy.level,
      // No trust formula until phase 08 — the ceiling simply tracks the level.
      earnedLevel: autonomy.level,
      guardrails: {
        version: 1,
        dailySpendCapMinor: this.data.dailySpendCapMinor ?? 500_000,
        maxDiscountPct: autonomy.guardrails.maxDiscountPct,
        noTouch: this.data.noTouch ?? [],
        platform: autonomy.guardrails,
      },
      modes: this.data.modes ?? { store: "autonomous" },
      duties: Object.fromEntries(
        DUTIES.map((d) => [
          d.key,
          { key: d.key, minLevel: d.minLevel, enabled: true, doorExists: DOORS[d.door]?.exists ?? false },
        ]),
      ),
      spentTodayMinor,
    };
  }

  // ---- Decisions (E-9) ----

  async listDecisions(filter?: { status?: DecisionRecord["status"]; tag?: string; limit?: number }): Promise<DecisionRecord[]> {
    const rows = (this.data.decisions ?? [])
      .filter((d) => (filter?.status === undefined || d.status === filter.status) && (filter?.tag === undefined || d.tag === filter.tag))
      // Pinned first, then FIFO. A founder should meet the urgent ask before
      // the queue buries it, but order is otherwise the order they were asked.
      .sort((a, b) => a.priority - b.priority || a.queuePos - b.queuePos);
    return filter?.limit ? rows.slice(0, filter.limit) : rows;
  }

  async addDecision(input: Omit<DecisionRecord, "id" | "createdAt" | "queuePos" | "status" | "decidedBy" | "decidedAt" | "bundleRef" | "frozenByLock">): Promise<DecisionRecord> {
    const all = this.data.decisions ?? (this.data.decisions = []);
    const created: DecisionRecord = {
      ...input,
      id: this.nextId("dec"),
      bundleRef: null,
      status: "queued",
      queuePos: all.reduce((max, d) => Math.max(max, d.queuePos), 0) + 1,
      frozenByLock: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: this.now(),
    };
    all.push(created);
    return created;
  }

  async updateDecision(id: string, patch: Partial<Pick<DecisionRecord, "status" | "surfacedIn" | "queuePos" | "frozenByLock" | "decidedBy" | "decidedAt">>): Promise<DecisionRecord> {
    const decision = this.mustFind((this.data.decisions ?? []).find((d) => d.id === id), "Decision", id);
    // "Later" sends a card to the BACK of the queue rather than dropping it —
    // the founder deferred it, they did not decline it.
    if (patch.status === "later" && patch.queuePos === undefined) {
      const all = this.data.decisions ?? [];
      decision.queuePos = all.reduce((max, d) => Math.max(max, d.queuePos), 0) + 1;
    }
    Object.assign(decision, patch);
    return decision;
  }

  async setNoTouch(locks: string[]): Promise<string[]> {
    this.data.noTouch = [...locks];
    return this.data.noTouch;
  }

  // ---- Grow Lab (read-only) ----
  //
  // The demo seed ships no Grow rows, so these read empty. That is the honest
  // state for a demo store nobody has worked in — Nova should say "nothing in
  // Content Studio yet", not invent a founder's backlog. Seeds may populate
  // the optional collections when a scenario needs them.

  async listGrowCampaigns(status?: GrowCampaign["status"]): Promise<GrowCampaign[]> {
    const rows = this.data.growCampaigns ?? [];
    return status === undefined ? rows : rows.filter((c) => c.status === status);
  }

  async listGrowPosts(status?: GrowPost["status"]): Promise<GrowPost[]> {
    const rows = this.data.growPosts ?? [];
    return status === undefined ? rows : rows.filter((p) => p.status === status);
  }

  async listGrowBroadcasts(): Promise<GrowBroadcast[]> {
    return this.data.growBroadcasts ?? [];
  }

  async listGrowIdeas(status?: GrowIdea["status"]): Promise<GrowIdea[]> {
    const rows = this.data.growIdeas ?? [];
    return status === undefined ? rows : rows.filter((i) => i.status === status);
  }

  async getGrowGoal(month?: string): Promise<GrowGoal | null> {
    const key = month ?? this.now().slice(0, 7);
    return (this.data.growGoals ?? []).find((g) => g.month === key) ?? null;
  }

  async updateDiscount(id: string, patch: { active: boolean }): Promise<Discount> {
    const discount = this.mustFind(
      this.data.discounts.find((d) => d.id === id),
      "Discount",
      id,
    );
    discount.active = patch.active;
    return discount;
  }

  // ---- Support & messaging ----

  async listSupportTickets(status?: TicketStatus): Promise<SupportTicket[]> {
    return this.data.supportTickets.filter((t) => status === undefined || t.status === status);
  }

  async getSupportTicket(id: string): Promise<SupportTicket | null> {
    return this.data.supportTickets.find((t) => t.id === id) ?? null;
  }

  async addTicketMessage(
    ticketId: string,
    message: { from: "nova" | "owner"; text: string },
  ): Promise<SupportTicket> {
    const ticket = this.mustFind(
      this.data.supportTickets.find((t) => t.id === ticketId),
      "Ticket",
      ticketId,
    );
    ticket.messages.push({ ...message, at: this.now() });
    return ticket;
  }

  async updateTicketStatus(ticketId: string, status: TicketStatus): Promise<SupportTicket> {
    const ticket = this.mustFind(
      this.data.supportTickets.find((t) => t.id === ticketId),
      "Ticket",
      ticketId,
    );
    ticket.status = status;
    return ticket;
  }

  async listCustomerMessages(filter?: {
    purpose?: CustomerMessage["purpose"];
    sinceDays?: number;
  }): Promise<CustomerMessage[]> {
    const cutoff = filter?.sinceDays !== undefined ? this.sinceCutoff(filter.sinceDays) : null;
    return this.data.customerMessages.filter(
      (m) =>
        (filter?.purpose === undefined || m.purpose === filter.purpose) &&
        (cutoff === null || Date.parse(m.sentAt) >= cutoff),
    );
  }

  async addCustomerMessage(message: Omit<CustomerMessage, "id" | "sentAt">): Promise<CustomerMessage> {
    const created: CustomerMessage = {
      ...message,
      id: this.nextId("msg"),
      sentAt: this.now(),
    };
    this.data.customerMessages.push(created);
    return created;
  }

  // ---- Suppliers & logistics ----

  async listSuppliers(): Promise<Supplier[]> {
    return this.data.suppliers;
  }

  async getSupplier(id: string): Promise<Supplier | null> {
    return this.data.suppliers.find((s) => s.id === id) ?? null;
  }

  async listPurchaseOrders(status?: PurchaseOrder["status"]): Promise<PurchaseOrder[]> {
    return this.data.purchaseOrders.filter((po) => status === undefined || po.status === status);
  }

  async createPurchaseOrder(po: Omit<PurchaseOrder, "id" | "createdAt" | "total">): Promise<PurchaseOrder> {
    const created: PurchaseOrder = {
      ...po,
      id: this.nextId("po"),
      total: Math.round(po.quantity * po.unitCost * 100) / 100,
      createdAt: this.now(),
    };
    this.data.purchaseOrders.push(created);
    return created;
  }

  async updatePurchaseOrder(id: string, patch: { status: PurchaseOrder["status"] }): Promise<PurchaseOrder> {
    const po = this.mustFind(
      this.data.purchaseOrders.find((p) => p.id === id),
      "Purchase order",
      id,
    );
    po.status = patch.status;
    return po;
  }

  async listCouriers(): Promise<Courier[]> {
    return this.data.couriers;
  }

  async getCourier(id: string): Promise<Courier | null> {
    return this.data.couriers.find((c) => c.id === id) ?? null;
  }

  // ---- Finance ----

  async listExpenses(sinceDays?: number): Promise<ExpenseEntry[]> {
    const cutoff = sinceDays !== undefined ? this.sinceCutoff(sinceDays) : null;
    return this.data.expenses.filter(
      (e) => cutoff === null || Date.parse(`${e.date}T00:00:00Z`) >= cutoff,
    );
  }

  // ---- Nova agent data ----

  async getAutonomy(): Promise<AutonomyConfig> {
    return this.data.autonomy;
  }

  async setAutonomy(config: AutonomyConfig): Promise<AutonomyConfig> {
    this.data.autonomy = config;
    return config;
  }

  async listMemory(namespace?: MemoryNamespace): Promise<MemoryEntry[]> {
    return this.data.memory.filter((m) => namespace === undefined || m.namespace === namespace);
  }

  async upsertMemory(entry: MemoryUpsert): Promise<MemoryEntry> {
    const existing = this.data.memory.find(
      (m) => m.namespace === entry.namespace && m.key === entry.key,
    );
    if (existing) {
      existing.value = entry.value;
      existing.updatedAt = this.now();
      if (entry.source !== undefined) existing.source = entry.source;
      if (entry.provenance !== undefined) existing.provenance = entry.provenance;
      if (entry.weight !== undefined) existing.weight = entry.weight;
      if (entry.expiresAt !== undefined) existing.expiresAt = entry.expiresAt;
      // A changed value invalidates the old embedding; re-embed on next pass
      // unless the caller supplied one alongside the new value.
      existing.embedding = entry.embedding ?? null;
      return existing;
    }
    const created: MemoryEntry = {
      namespace: entry.namespace,
      key: entry.key,
      value: entry.value,
      updatedAt: this.now(),
      source: entry.source ?? "owner",
      provenance: entry.provenance ?? null,
      weight: entry.weight ?? 1.0,
      expiresAt: entry.expiresAt ?? null,
      embedding: entry.embedding ?? null,
    };
    this.data.memory.push(created);
    return created;
  }

  async deleteMemory(namespace: MemoryNamespace, key: string): Promise<boolean> {
    const index = this.data.memory.findIndex(
      (m) => m.namespace === namespace && m.key === key,
    );
    if (index === -1) return false;
    // Hard delete — the row and its embedding go together (compliance).
    this.data.memory.splice(index, 1);
    return true;
  }

  async setMemoryEmbedding(
    namespace: MemoryNamespace,
    key: string,
    embedding: number[],
  ): Promise<boolean> {
    const entry = this.data.memory.find((m) => m.namespace === namespace && m.key === key);
    if (!entry) return false;
    entry.embedding = embedding;
    return true;
  }

  async listActivity(filter?: {
    sinceDays?: number;
    department?: ActivityEntry["department"];
  }): Promise<ActivityEntry[]> {
    const cutoff = filter?.sinceDays !== undefined ? this.sinceCutoff(filter.sinceDays) : null;
    return this.data.activity.filter(
      (a) =>
        (cutoff === null || Date.parse(a.at) >= cutoff) &&
        (filter?.department === undefined || a.department === filter.department),
    );
  }

  async addActivity(entry: Omit<ActivityEntry, "id" | "at">): Promise<ActivityEntry> {
    const created: ActivityEntry = { ...entry, id: this.nextId("act"), at: this.now() };
    this.data.activity.push(created);
    return created;
  }

  async updateActivity(
    id: string,
    patch: Partial<Pick<ActivityEntry, "revenueInfluence" | "revenueBasis" | "revenueProvenance">>,
  ): Promise<ActivityEntry> {
    const activity = this.mustFind(
      this.data.activity.find((a) => a.id === id),
      "Activity",
      id,
    );
    Object.assign(activity, patch);
    return activity;
  }

  // ---- Night shift outputs (E-4/E-6/E-7/E-16) — in-memory twin for evals ----
  private nightDepts: DepartmentGrade[] = [];
  private nightPlan: PlanItem[] = [];
  private nightBriefs: MorningBrief[] = [];

  async setDepartment(dept: DepartmentGrade): Promise<DepartmentGrade> {
    const saved: DepartmentGrade = { ...dept, gradedAt: dept.gradedAt ?? this.now() };
    const idx = this.nightDepts.findIndex((d) => d.key === dept.key);
    if (idx >= 0) this.nightDepts[idx] = saved;
    else this.nightDepts.push(saved);
    return saved;
  }

  async addPlanItem(item: Omit<PlanItem, "id">): Promise<PlanItem> {
    const created: PlanItem = { ...item, id: this.nextId("plan") };
    this.nightPlan.push(created);
    return created;
  }

  async fileBrief(input: { day?: string; narrative?: string }): Promise<MorningBrief> {
    const day = input.day ?? this.now().slice(0, 10);
    const existing = this.nightBriefs.find((b) => b.day === day);
    if (existing) {
      if (input.narrative != null) existing.narrative = input.narrative;
      return existing;
    }
    const created: MorningBrief = {
      id: this.nextId("brief"), day, narrative: input.narrative ?? "",
      tiles: [], decisionRefs: [], openedAt: null,
    };
    this.nightBriefs.push(created);
    return created;
  }

  // A seeded brand voice so evals (and a store that hasn't configured one) have
  // a real profile to score against: warm/handmade/cozy tone, "cheap" and
  // "limited time only" off-limits. The live backend serves the founder's own.
  private brandProfile: BrandProfile = {
    toneWords: ["warm", "handmade", "cozy"],
    palette: [],
    rules: [
      { kind: "dont", text: "cheap" },
      { kind: "dont", text: "limited time only" },
    ],
    languages: ["en", "bn"],
    assets: {},
    threshold: 70,
  };
  async getBrandProfile(): Promise<BrandProfile> {
    return this.brandProfile;
  }

  private nightContent: ContentItem[] = [];
  async fileContent(input: ContentDraftInput): Promise<ContentItem> {
    if (input.id) {
      const existing = this.nightContent.find((c) => c.id === input.id);
      if (existing) {
        Object.assign(existing, { body: input.body, voiceScore: input.voiceScore, violations: input.violations, status: "review" });
        return existing;
      }
    }
    const created: ContentItem = {
      id: this.nextId("content"), type: input.type, title: input.title, language: input.language,
      body: input.body, status: "review", voiceScore: input.voiceScore, violations: input.violations,
      createdAt: this.now(),
    };
    this.nightContent.push(created);
    return created;
  }

  // ---- Procedural memory: playbooks ----

  private get playbooks(): NovaPlaybook[] {
    if (!this.data.playbooks) this.data.playbooks = [];
    return this.data.playbooks;
  }

  async listPlaybooks(status?: NovaPlaybook["status"]): Promise<NovaPlaybook[]> {
    return this.playbooks.filter((p) => status === undefined || p.status === status);
  }

  async upsertPlaybook(
    playbook: Omit<NovaPlaybook, "id" | "createdAt"> & { id?: string },
  ): Promise<NovaPlaybook> {
    const existing = this.playbooks.find(
      (p) => (playbook.id !== undefined && p.id === playbook.id) || p.name === playbook.name,
    );
    if (existing) {
      existing.description = playbook.description;
      existing.markdown = playbook.markdown;
      existing.status = playbook.status;
      existing.createdFrom = playbook.createdFrom;
      return existing;
    }
    const created: NovaPlaybook = {
      id: playbook.id ?? this.nextId("play"),
      name: playbook.name,
      description: playbook.description,
      markdown: playbook.markdown,
      status: playbook.status,
      createdFrom: playbook.createdFrom,
      createdAt: this.now(),
    };
    this.playbooks.push(created);
    return created;
  }

  async updatePlaybookStatus(id: string, status: NovaPlaybook["status"]): Promise<NovaPlaybook> {
    const playbook = this.mustFind(
      this.playbooks.find((p) => p.id === id),
      "Playbook",
      id,
    );
    playbook.status = status;
    return playbook;
  }

  // ---- Experiments ----

  private get experiments(): NovaExperiment[] {
    if (!this.data.experiments) this.data.experiments = [];
    return this.data.experiments;
  }

  async listExperiments(status?: NovaExperiment["status"]): Promise<NovaExperiment[]> {
    return this.experiments.filter((e) => status === undefined || e.status === status);
  }

  async getExperiment(id: string): Promise<NovaExperiment | null> {
    return this.experiments.find((e) => e.id === id) ?? null;
  }

  async createExperiment(experiment: Omit<NovaExperiment, "id" | "startedAt">): Promise<NovaExperiment> {
    const created: NovaExperiment = {
      ...experiment,
      id: this.nextId("exp"),
      startedAt: this.now(),
    };
    this.experiments.push(created);
    return created;
  }

  async updateExperiment(
    id: string,
    patch: Partial<Pick<NovaExperiment, "actual" | "status" | "evaluatedAt" | "actionIds">>,
  ): Promise<NovaExperiment> {
    const experiment = this.mustFind(
      this.experiments.find((e) => e.id === id),
      "Experiment",
      id,
    );
    Object.assign(experiment, patch);
    return experiment;
  }

  async listActions(status?: ActionStatus): Promise<ActionRecord[]> {
    return this.data.actions.filter((a) => status === undefined || a.status === status);
  }

  async getAction(id: string): Promise<ActionRecord | null> {
    return this.data.actions.find((a) => a.id === id) ?? null;
  }

  async addAction(record: Omit<ActionRecord, "id" | "createdAt">): Promise<ActionRecord> {
    const created: ActionRecord = {
      ...record,
      id: this.nextId("action"),
      createdAt: this.now(),
    };
    // Mirror dakio-api's server-computed undo window: 24h from execution on
    // undoable executions (undo is a right with a clock — E-8).
    if (created.status === "executed" && created.undoable && created.executedAt && !created.undoDeadline) {
      created.undoDeadline = new Date(Date.parse(created.executedAt) + 24 * 3600 * 1000).toISOString();
    }
    this.data.actions.push(created);
    return created;
  }

  async updateAction(
    id: string,
    patch: Partial<
      Pick<ActionRecord, "status" | "outcome" | "undoData" | "undoable" | "decidedAt" | "executedAt">
    >,
  ): Promise<ActionRecord> {
    const action = this.mustFind(
      this.data.actions.find((a) => a.id === id),
      "Action",
      id,
    );
    Object.assign(action, patch);
    // Mirror dakio-api stamping: undoneAt on undo; undo window when a prepared
    // action executes as undoable (the approve path).
    if (patch.status === "undone" && !action.undoneAt) {
      action.undoneAt = this.now();
    }
    if (action.status === "executed" && action.undoable && action.executedAt && !action.undoDeadline) {
      action.undoDeadline = new Date(Date.parse(action.executedAt) + 24 * 3600 * 1000).toISOString();
    }
    return action;
  }

  async executePreparedAction(actionId: string): Promise<{ executed: boolean; note: string }> {
    // Mirror of dakio-api's approve pipeline for the in-memory store. The
    // demo store has no door executors, so the two honest outcomes are the
    // advisory acknowledgement and "nothing ran" — never a fabricated effect.
    const ADVISORY = new Set(["suggest_reorder", "suggest_restock", "flag_rto_spike", "flag_risk", "recommend"]);
    const action = this.mustFind(
      this.data.actions.find((a) => a.id === actionId),
      "Action",
      actionId,
    );
    if (action.status !== "prepared") {
      throw new Error(`Action is ${action.status}, not awaiting approval.`);
    }
    if (!ADVISORY.has(action.type)) {
      return { executed: false, note: "No executor is registered for this action yet — nothing ran." };
    }
    action.status = "executed";
    action.outcome = "Acknowledged — recommendation accepted; no automated store change.";
    action.decidedAt = this.now();
    action.executedAt = this.now();
    return { executed: true, note: action.outcome };
  }

  async attributeDoorRecord(_targetRef: string, _actionId: string): Promise<void> {
    // The in-memory demo store has no door tables to stamp; the live backend
    // (dakio.ts → POST /agent-data/attribute) persists the link.
  }

  async listReports(filter?: { kind?: NovaReport["kind"]; limit?: number }): Promise<NovaReport[]> {
    const matching = this.data.reports
      .filter((r) => filter?.kind === undefined || r.kind === filter.kind)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return filter?.limit !== undefined ? matching.slice(0, filter.limit) : matching;
  }

  async addReport(report: Omit<NovaReport, "id" | "createdAt">): Promise<NovaReport> {
    // A dedupeKey collision returns the ORIGINAL report (mirrors dakio-api's
    // novaJobs-safety P2002 handling) — a job that reran after failing to
    // mark itself done must not double-file.
    if (report.dedupeKey) {
      const existing = this.data.reports.find((r) => r.dedupeKey === report.dedupeKey);
      if (existing) return existing;
    }
    const created: NovaReport = {
      ...report,
      id: this.nextId("rpt"),
      createdAt: this.now(),
    };
    this.data.reports.push(created);
    return created;
  }

  // The demo backend has no external event source (no real Dakio webhooks/
  // mutations to react to) — seeds simply start with an empty inbox unless a
  // seed explicitly pre-populates `inboxEvents` for a scenario/eval.
  async listInboxEvents(filter?: { processed?: boolean }): Promise<InboxEvent[]> {
    const events = this.data.inboxEvents ?? [];
    if (filter?.processed === undefined) return events;
    return events.filter((e) => (filter.processed ? e.processedAt !== null : e.processedAt === null));
  }

  async markEventProcessed(id: string): Promise<InboxEvent> {
    const events = (this.data.inboxEvents ??= []);
    const event = this.mustFind(
      events.find((e) => e.id === id),
      "Inbox event",
      id,
    );
    event.processedAt = this.now();
    return event;
  }

  // ---- Front Office — customer conversations (Stage 10, module 02) ----
  //
  // The demo backend plays dakio-api's `/api/v1/inbox/*` surface: it runs the
  // SAME guard ladder (thread off → founder lock → someone already answered →
  // customer double-texted → 24h window → loop cap) and refuses with the same
  // codes, so a refusal path can be exercised without Meta, a webhook, or a
  // database. Two things it deliberately does NOT do, because they are not
  // ours to fake: the human-timing engine (dakio-api computes `scheduledAt`
  // from read/typing delays and hour-of-day bands) and the Graph send. A
  // queued row here is queued, never "delivered".

  /**
   * Materialize a conversation for a demo or eval run. Not part of
   * {@link StoreClient}: the live backend's threads are created by real
   * customers through the Meta webhook, and a demo store that conjured one on
   * first read would be inventing a customer.
   */
  seedInboxConversation(seed: DemoInboxSeed): InboxThread {
    const now = this.now();
    const messages: InboxMessageView[] = (seed.messages ?? []).map((m, index) => ({
      id: m.id ?? `inmsg-${seed.id}-${index + 1}`,
      direction: m.direction,
      actor: m.actor,
      text: m.text,
      attachmentUrl: null,
      attachmentType: null,
      purpose: m.purpose ?? null,
      novaActionId: m.novaActionId ?? null,
      sentAt: m.sentAt ?? now,
      metaTimestamp: m.sentAt ?? now,
    }));
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
    const thread: DemoInboxThread = {
      conversation: {
        id: seed.id,
        platform: seed.platform ?? "messenger",
        senderName: seed.senderName ?? "Demo customer",
        customerId: seed.customerId ?? null,
        handledBy: seed.handledBy ?? null,
        novaLockedAt: seed.novaLockedAt ?? null,
        novaEnabled: seed.novaEnabled ?? true,
        lastIntent: seed.lastIntent ?? null,
        escalatedAt: null,
        lastInboundAt: lastInbound?.sentAt ?? null,
        windowExpiresAt:
          seed.windowExpiresAt ??
          new Date(Date.parse(lastInbound?.sentAt ?? now) + DAY_MS).toISOString(),
        lastMessageAt: messages[messages.length - 1]?.sentAt ?? null,
      },
      messages,
      customer: seed.customer ?? null,
      proposal: seed.proposal ?? null,
      // A seeded link is a human writing the join by hand, which is exactly
      // what `founder_manual` means — the one rung of the ladder a demo can
      // honestly claim. `linkCustomer` overwrites it with the rung it used.
      customerLinkSource: seed.customerId ? "founder_manual" : null,
      claimedPhone: null,
      outbounds: [],
    };
    this.inbox.set(seed.id, thread);
    return {
      conversation: thread.conversation,
      messages: thread.messages,
      customer: thread.customer,
      proposal: thread.proposal,
    };
  }

  async getInboxConversation(
    conversationId: string,
    opts?: { messages?: number },
  ): Promise<InboxThread | null> {
    const thread = this.inbox.get(conversationId);
    if (!thread) return null;
    const limit = Math.min(Math.max(opts?.messages ?? 50, 1), 50);
    return {
      conversation: { ...thread.conversation },
      // Newest last, oldest trimmed first — the tail is what a reply needs.
      messages: thread.messages.slice(-limit).map((m) => ({ ...m })),
      customer: thread.customer,
      // A linked thread has nothing to propose — the proposal is cleared on
      // link or on mismatch, and it is never a substitute for one.
      proposal: thread.conversation.customerId === null ? thread.proposal : null,
    };
  }

  async replyInThread(conversationId: string, input: InboxReplyRequest): Promise<InboxReplyResult> {
    const thread = this.inbox.get(conversationId);
    if (!thread) throw new Error(`Conversation not found: ${conversationId}`);
    const c = thread.conversation;
    const nowMs = Date.parse(this.now());

    // 1. Per-thread founder switch.
    if (c.novaEnabled !== true) {
      throw new InboxSendRefused("THREAD_OFF", `Nova is switched off for conversation ${conversationId}.`);
    }
    // 2. The founder holds the thread. No exceptions, ever — holding and SLA
    //    lines are system sends that never pass through this path.
    if (c.novaLockedAt !== null || c.handledBy === "founder") {
      throw new InboxSendRefused("LOCKED", `The founder has conversation ${conversationId}; Nova does not write on it.`);
    }
    const anchor = thread.messages.find((m) => m.id === input.inReplyToMessageId);
    if (!anchor) {
      // Cannot prove freshness against a message that is not in the thread.
      throw new InboxSendRefused("STALE", `Unknown inReplyToMessageId ${input.inReplyToMessageId}; re-read the thread.`);
    }
    const anchorAt = Date.parse(anchor.sentAt);
    // 3. Someone already answered by hand since the anchor.
    if (
      thread.messages.some(
        (m) =>
          m.direction === "out" &&
          (m.actor === "founder" || m.actor === "founder_external") &&
          Date.parse(m.sentAt) > anchorAt,
      )
    ) {
      throw new InboxSendRefused("LOCKED", "The founder already answered this message.");
    }
    // 4. The customer wrote again — answering the old message now is worse
    //    than not answering at all.
    if (thread.messages.some((m) => m.direction === "in" && Date.parse(m.sentAt) > anchorAt)) {
      throw new InboxSendRefused("STALE", "The customer sent another message; re-read the thread before replying.");
    }
    // 5. Meta's 24h window. v1 refuses honestly — no MESSAGE_TAG, ever.
    if (c.windowExpiresAt !== null && Date.parse(c.windowExpiresAt) <= nowMs) {
      throw new InboxSendRefused("WINDOW_CLOSED", "The 24h messaging window closed; this reply cannot be sent.");
    }
    // 6. Loop breaker: consecutive Nova messages since the last inbound.
    let consecutive = 0;
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const m = thread.messages[i]!;
      if (m.direction === "in") break;
      if (m.actor === "nova") consecutive += 1;
    }
    if (consecutive >= NOVA_MAX_CONSECUTIVE_OUTBOUND) {
      throw new InboxSendRefused(
        "LOOP_GUARD",
        `${consecutive} Nova messages since the customer last wrote — stopping rather than talking to itself.`,
      );
    }

    // Pass. dakio-api would schedule each bubble through the pacing engine;
    // the demo queues them at once and inserts the message rows the ledger
    // links to. `scheduledAt` is honest about that: it is now, not a
    // simulated human delay.
    const scheduledAt = this.now();
    const outboundId = this.nextId("outb");
    const inserted: InboxMessageView[] = input.chunks.map((chunk, index) => ({
      id: `inmsg-${outboundId}-${index + 1}`,
      direction: "out",
      actor: "nova",
      text: chunk.text,
      attachmentUrl: null,
      attachmentType: null,
      purpose: input.purpose ?? null,
      novaActionId: input.novaActionId,
      sentAt: scheduledAt,
      metaTimestamp: scheduledAt,
    }));
    thread.messages.push(...inserted);
    thread.outbounds.push({
      id: outboundId,
      novaActionId: input.novaActionId,
      chunks: input.chunks,
      status: "sent",
      scheduledAt,
    });
    c.lastMessageAt = scheduledAt;
    c.lastIntent = input.intent;
    c.handledBy = "nova";
    // D7: the promise is co-created with the outbound, not after it. dakio-api
    // does this inside the same `$transaction`; the demo does it in the same
    // statement, past every guard above — a promise made on a refused send
    // would be a debt for a message the customer never got.
    if (input.promise) {
      this.promises.push({
        id: this.nextId("prm"),
        customerId: c.customerId,
        conversationId: conversationId,
        channelKind: c.platform,
        madeBy: "nova",
        text: input.promise.text,
        kind: input.promise.kind,
        dueAt: input.promise.dueAtISO,
        status: "open",
        keptAt: null,
        brokenAt: null,
      });
    }
    return {
      outboundId,
      scheduledAt,
      chunks: input.chunks,
      firstMessageId: inserted[0]!.id,
    };
  }

  async handoverConversation(
    conversationId: string,
    input: InboxHandoverRequest,
  ): Promise<InboxHandoverResult> {
    const thread = this.inbox.get(conversationId);
    if (!thread) throw new Error(`Conversation not found: ${conversationId}`);
    const c = thread.conversation;
    // Anti-spam: one open escalation per conversation. A second call updates
    // the brief instead of stacking a second ask on the founder's desk.
    if (c.escalatedAt !== null) {
      return { escalated: true, alreadyEscalated: true, decisionId: null, holdingSent: false };
    }
    c.escalatedAt = this.now();
    c.handledBy = "founder";
    // `novaLockedAt` stays null — no human has acted yet; escalation is Nova
    // stepping back, not the founder stepping in.
    return { escalated: true, decisionId: null, holdingSent: false, alreadyEscalated: false };
  }

  // ---- Front Office — identity and promises (Stage 10, module 03) ----
  //
  // The demo plays dakio-api's decision-making half: it normalizes the phone,
  // counts matches, and answers. What it deliberately does NOT play is the
  // CustomerChannel spoke table (there is no channel model here, so
  // `channelWritten` is always false and `channelsMoved` is always 0) or the
  // psid→customerId memory migration. Both are named rather than faked.

  /**
   * Teach the demo which phone belongs to which customer. Not part of
   * {@link StoreClient}: the live backend reads a real `Customer.phone` column,
   * and a demo store that guessed the mapping would be inventing the single
   * fact the whole identity ladder is built on. Seed the same phone twice to
   * exercise the collision → `mergeProposed` path.
   */
  seedCustomerPhone(phone: string, customerId: string): void {
    this.customerPhones.push({ phone: demoNormalizePhone(phone), customerId });
  }

  /**
   * Materialize a promise for a demo or eval run. Not part of
   * {@link StoreClient}: promises are co-created with a real queued reply
   * (see `replyInThread`), and a store that conjured one would be inventing a
   * debt nobody took on.
   */
  seedPromise(seed: DemoPromiseSeed): InboxPromise {
    const promise: InboxPromise = {
      id: seed.id ?? this.nextId("prm"),
      customerId: seed.customerId ?? null,
      conversationId: seed.conversationId ?? null,
      channelKind: seed.channelKind ?? "messenger",
      madeBy: seed.madeBy ?? "nova",
      text: seed.text,
      kind: seed.kind,
      dueAt: seed.dueAt ?? new Date(Date.parse(this.now()) + DAY_MS).toISOString(),
      status: seed.status ?? "open",
      keptAt: null,
      brokenAt: null,
    };
    this.promises.push(promise);
    return { ...promise };
  }

  async linkCustomer(conversationId: string, input: LinkCustomerRequest): Promise<LinkCustomerResult> {
    const thread = this.inbox.get(conversationId);
    if (!thread) throw new Error(`Conversation not found: ${conversationId}`);
    const c = thread.conversation;

    // The digit check (D3): the caller supplies the digits the customer just
    // said — never the number being checked against. A failed check is an
    // answer, and it clears the proposal rather than leaving a candidate the
    // next turn would re-ask about.
    //
    // WHERE THE CANDIDATE COMES FROM, and how this differs from production:
    // the real route resolves it from the conversation's own
    // `proposedCustomerId` column and IGNORES `verify.customerId`, which is
    // advisory (it lands on the failure receipt and nowhere else). This demo
    // backend has no proposal column beyond the basis label, so it stands in
    // for that lookup with the advisory id — and when there is none, there is
    // no candidate to test, so the check fails, which is exactly what the real
    // route answers for a thread with no live proposal.
    if (input.verify) {
      const candidateId = input.verify.customerId ?? null;
      const known =
        candidateId === null ? undefined : this.customerPhones.find((row) => row.customerId === candidateId);
      const digits = input.verify.lastDigits.replace(/\D+/g, "");
      const passed = known !== undefined && digits.length > 0 && known.phone.endsWith(digits);
      thread.proposal = null;
      if (!passed || candidateId === null) return { matched: false, channelWritten: false };
      c.customerId = candidateId;
      thread.customerLinkSource = "digits_verified";
      return { matched: true, customerId: candidateId, channelWritten: false };
    }

    // The self-stated phone (D4). Zero matches is not a failure: the number is
    // held on the thread so the join materializes later, when an order finally
    // creates the Customer.
    const normalized = demoNormalizePhone(input.phone ?? "");
    const hits = normalized.length === 0 ? [] : this.customerPhones.filter((row) => row.phone === normalized);
    const distinct = [...new Set(hits.map((row) => row.customerId))];
    thread.proposal = null;
    if (distinct.length === 0) {
      thread.claimedPhone = normalized.length > 0 ? normalized : null;
      return { matched: false, channelWritten: false };
    }
    if (distinct.length > 1) {
      // D2's NEVER tier: two records, one number. The thread stays UNLINKED and
      // the merge goes to the founder — guessing a survivor here is exactly the
      // move that shows one customer another customer's orders.
      return { matched: false, channelWritten: false, mergeProposed: true };
    }
    c.customerId = distinct[0]!;
    thread.customerLinkSource = "phone_stated";
    thread.claimedPhone = null;
    return { matched: true, customerId: distinct[0]!, channelWritten: false };
  }

  async unlinkCustomer(conversationId: string): Promise<{ unlinked: boolean }> {
    const thread = this.inbox.get(conversationId);
    if (!thread) throw new Error(`Conversation not found: ${conversationId}`);
    const had = thread.conversation.customerId !== null;
    thread.conversation.customerId = null;
    thread.customerLinkSource = null;
    // The channel address is NOT removed (D4): it is a fact that was
    // established, and undoing a join must not forget something true.
    return { unlinked: had };
  }

  async listPromises(filter?: { status?: string; customerId?: string; limit?: number }): Promise<InboxPromise[]> {
    // `status` defaults to open server-side — the sweep and the brief both want
    // the debts, not the history.
    const status = filter?.status ?? "open";
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 50);
    return this.promises
      .filter(
        (p) =>
          p.status === status &&
          (filter?.customerId === undefined || p.customerId === filter.customerId),
      )
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async settlePromise(
    promiseId: string,
    input: PromiseSettleRequest,
  ): Promise<{ ok: boolean; promise: InboxPromise }> {
    const promise = this.promises.find((p) => p.id === promiseId);
    if (!promise) throw new Error(`Promise not found: ${promiseId}`);
    // The wire is JSON; the type is a promise, not a guard. `broken` is the
    // sweep's word alone — a turn may keep or release a debt, it may never
    // declare its own failure away.
    const requested = String(input.status);
    if (requested !== "kept" && requested !== "released") {
      throw new InboxSendRefused(
        "PROMISE_TRANSITION",
        `"${requested}" is not settleable here; only kept | released are, and 'broken' belongs to the nightly sweep.`,
      );
    }
    if (promise.status !== "open") {
      // Losing this race is an ANSWER, usually "the sweep got there first" —
      // never an overwrite, and never a second transition on one debt.
      throw new InboxSendRefused(
        "PROMISE_SETTLED",
        `Promise ${promiseId} is already ${promise.status}; it does not transition twice.`,
      );
    }
    promise.status = requested === "kept" ? "kept" : "released";
    if (promise.status === "kept") promise.keptAt = this.now();
    return { ok: true, promise: { ...promise } };
  }

  async mergeCustomers(input: { customerIdA: string; customerIdB: string; basis: string }): Promise<{
    survivorCustomerId: string;
    mergedCustomerId: string;
    ordersMoved: number;
    channelsMoved: number;
    conversationsMoved: number;
    promisesMoved: number;
  }> {
    const a = this.mustFind(this.data.customers.find((c) => c.id === input.customerIdA), "Customer", input.customerIdA);
    const b = this.mustFind(this.data.customers.find((c) => c.id === input.customerIdB), "Customer", input.customerIdB);
    if (a.id === b.id) throw new Error(`Cannot merge customer ${a.id} into itself.`);
    // D5's survivor rule, server-side and not the caller's to choose: more
    // orders wins; a tie goes to the older record, because the older row is the
    // one other systems have had longer to reference.
    const ordersOf = (id: string): number => this.data.orders.filter((o) => o.customerId === id).length;
    const aWins =
      ordersOf(a.id) !== ordersOf(b.id)
        ? ordersOf(a.id) > ordersOf(b.id)
        : Date.parse(a.createdAt) <= Date.parse(b.createdAt);
    const survivor = aWins ? a : b;
    const merged = aWins ? b : a;

    let ordersMoved = 0;
    for (const order of this.data.orders) {
      if (order.customerId === merged.id) {
        order.customerId = survivor.id;
        ordersMoved += 1;
      }
    }
    let conversationsMoved = 0;
    for (const thread of this.inbox.values()) {
      if (thread.conversation.customerId === merged.id) {
        thread.conversation.customerId = survivor.id;
        conversationsMoved += 1;
      }
    }
    let promisesMoved = 0;
    for (const promise of this.promises) {
      if (promise.customerId === merged.id) {
        promise.customerId = survivor.id;
        promisesMoved += 1;
      }
    }
    for (const row of this.customerPhones) {
      if (row.customerId === merged.id) row.customerId = survivor.id;
    }
    // Recomputed from the repointed rows, never summed from the two stale
    // aggregates: two half-truths added together is a third wrong number.
    const survivorOrders = this.data.orders.filter((o) => o.customerId === survivor.id);
    survivor.ordersCount = survivorOrders.length;
    survivor.lifetimeValue = survivorOrders.reduce((sum, o) => sum + o.total, 0);
    // The demo drops the merged row because it has no `mergedIntoId` tombstone
    // column to record the redirect in. What actually happens to the loser row
    // is dakio-api's transaction to decide.
    this.data.customers.splice(this.data.customers.indexOf(merged), 1);

    return {
      survivorCustomerId: survivor.id,
      mergedCustomerId: merged.id,
      ordersMoved,
      // There is no CustomerChannel model in this backend, so this is honestly
      // zero rather than a plausible-looking count.
      channelsMoved: 0,
      conversationsMoved,
      promisesMoved,
    };
  }

  // ---- Proactive job queue (Phase 05) ----
  //
  // Single in-process array — no SKIP LOCKED or transaction needed (there is
  // no concurrent access within one JS event-loop tick), but the expand/lease
  // sequencing mirrors dakio-api's novaJobs.js exactly so both backends
  // behave identically to callers.

  async listJobDefs(): Promise<NovaJobDef[]> {
    return this.data.jobDefs ?? [];
  }

  async upsertJobDef(
    kind: JobKind,
    input: { cadence: string; tz: string; enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<NovaJobDef> {
    lastOccurrenceAtOrBefore(input.cadence, input.tz, new Date()); // throws on invalid cadence/tz — fail closed, matching novaJobs.js
    const defs = (this.data.jobDefs ??= []);
    const existing = defs.find((d) => d.kind === kind);
    const updated: NovaJobDef = {
      kind,
      cadence: input.cadence,
      tz: input.tz,
      enabled: input.enabled ?? true,
      config: input.config ?? {},
      updatedAt: this.now(),
    };
    if (existing) Object.assign(existing, updated);
    else defs.push(updated);
    return existing ?? updated;
  }

  private drainCartAbandonedEventsToJobs(now: Date): void {
    const events = (this.data.inboxEvents ??= []);
    const jobs = (this.data.jobs ??= []);
    const pending = events.filter((e) => e.eventType === "cart.abandoned" && e.processedAt === null);
    if (pending.length === 0) return;

    const bucketMs = CART_SWEEP_DEBOUNCE_MINUTES * 60_000;
    const buckets = new Map<number, typeof pending>();
    for (const e of pending) {
      const bucketStart = Math.floor(Date.parse(e.receivedAt) / bucketMs) * bucketMs;
      const list = buckets.get(bucketStart) ?? [];
      list.push(e);
      buckets.set(bucketStart, list);
    }

    for (const [bucketStart, bucketEvents] of buckets) {
      const dedupeKey = `cart_sweep:event-window:${new Date(bucketStart).toISOString()}`;
      if (jobs.some((j) => j.dedupeKey === dedupeKey)) continue; // already expanded this window
      jobs.push({
        id: this.nextId("job"),
        kind: "cart_sweep",
        payload: { triggeredBy: "event", eventCount: bucketEvents.length },
        dueAt: new Date(bucketStart + bucketMs).toISOString(),
        priority: PRIORITY_BY_KIND.cart_sweep,
        status: "due",
        attempts: 0,
        lastError: null,
        dedupeKey,
        leaseUntil: null,
        leaseToken: null,
      });
    }
    for (const e of pending) e.processedAt = now.toISOString();
  }

  private expandDueDefs(now: Date): void {
    const defs = this.data.jobDefs ?? [];
    const jobs = (this.data.jobs ??= []);
    for (const def of defs) {
      if (!def.enabled || def.cadence === "event") continue;
      const occurrence = lastOccurrenceAtOrBefore(def.cadence, def.tz, now);
      if (!occurrence || occurrence.getTime() > now.getTime()) continue;
      const dedupeKey = `${def.kind}:${occurrence.toISOString()}`;
      if (jobs.some((j) => j.dedupeKey === dedupeKey)) continue;
      jobs.push({
        id: this.nextId("job"),
        kind: def.kind,
        payload: def.config,
        dueAt: occurrence.toISOString(),
        priority: PRIORITY_BY_KIND[def.kind] ?? 5,
        status: "due",
        attempts: 0,
        lastError: null,
        dedupeKey,
        leaseUntil: null,
        leaseToken: null,
      });
    }
  }

  async claimDueJobs(limit: number): Promise<NovaJob[]> {
    const now = new Date();
    const jobs = (this.data.jobs ??= []);

    // Watchdog: a stale lease (past its window) is due again.
    for (const j of jobs) {
      if (j.status === "leased" && j.leaseUntil && Date.parse(j.leaseUntil) < now.getTime()) {
        j.status = "due";
        j.leaseUntil = null;
        j.leaseToken = null;
      }
    }

    this.drainCartAbandonedEventsToJobs(now);
    this.expandDueDefs(now);

    const due = jobs
      .filter((j) => j.status === "due" && Date.parse(j.dueAt) <= now.getTime())
      .sort((a, b) => a.priority - b.priority || Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(0, limit);

    const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
    for (const j of due) {
      j.status = "leased";
      j.attempts += 1;
      j.leaseUntil = leaseUntil;
      // Fresh token per lease — a re-lease of this same row (e.g. after the
      // watchdog reclaims a slow job) gets a DIFFERENT token, so a stale
      // caller's later complete/release (see below) is a safe no-op instead
      // of overwriting a newer lease's outcome. Mirrors novaJobs.js exactly.
      j.leaseToken = randomUUID();
    }
    return due;
  }

  async completeJob(id: string, leaseToken: string): Promise<void> {
    const jobs = (this.data.jobs ??= []);
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status !== "leased" || job.leaseToken !== leaseToken) return; // superseded lease — leave it alone
    job.status = "done";
    job.leaseUntil = null;
  }

  async releaseJob(id: string, leaseToken: string, error: string): Promise<void> {
    const jobs = (this.data.jobs ??= []);
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status !== "leased" || job.leaseToken !== leaseToken) return; // superseded lease — leave whatever currently owns it alone
    job.lastError = error;
    job.leaseUntil = null;
    if (job.attempts >= MAX_ATTEMPTS) {
      job.status = "failed";
      return;
    }
    job.status = "due";
    job.dueAt = new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString();
  }
}
