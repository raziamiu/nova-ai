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
  Customer,
  CustomerMessage,
  Discount,
  ExpenseEntry,
  GrowBroadcast,
  GrowCampaign,
  GrowGoal,
  GrowIdea,
  GrowPost,
  InboxEvent,
  JobKind,
  MemoryEntry,
  MemoryNamespace,
  MemoryUpsert,
  NovaExperiment,
  NovaJob,
  NovaJobDef,
  NovaPlaybook,
  NovaReport,
  Order,
  OrderStatus,
  Product,
  PurchaseOrder,
  SocialPost,
  StoreSeed,
  Supplier,
  SupportTicket,
  TicketStatus,
  TrendingProduct,
} from "../types";
import type { StoreClient } from "./client";
import { DUTIES, DOORS } from "../duties";
import { SPEND_MINOR } from "../nova/authority";
import { createSeed } from "./seed";
import { lastOccurrenceAtOrBefore } from "../jobs/cron";
import { randomUUID } from "node:crypto";

// 1 = approval-surfacing/critical … 9 = lowest. Mirrors dakio-api's
// novaJobs.js — no dedicated approval-surfacing job kind exists yet.
const PRIORITY_BY_KIND: Record<JobKind, number> = {
  morning_report: 3,
  night_ops: 3,
  weekly_strategy: 4,
  reflection: 6,
  cart_sweep: 5,
  pulse: 9,
};
const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const CART_SWEEP_DEBOUNCE_MINUTES = 30;

function backoffMinutes(attempts: number): number {
  return Math.min(30, 2 ** attempts);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class DemoStore implements StoreClient {
  private readonly data: StoreSeed;
  private idCounter = 9000;

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
