/**
 * The boundary between Nova and the Dakio store.
 *
 * Nova only ever talks to a `StoreClient`. Today that resolves to a
 * per-tenant in-memory demo backend (`backend.ts`), one seeded dataset per
 * store. When the real Express store API is ready, implement this same
 * interface with `fetch()` calls and swap the constructor in
 * `storeFor` (`resolve.ts`) — no tool, subagent, or schedule changes required.
 *
 * The store persists Nova's own data too (memory, activity, prepared
 * actions, reports), matching the Dakio design where the store server saves
 * all agent data.
 *
 * Every data-access method is async (a real implementation is a network
 * call). `now()` is the one exception — it is a local clock read, not a
 * request, so callers can build timestamps without awaiting a round trip.
 *
 * There is no process-wide client. A `StoreClient` is always tenant-bound and
 * resolved per call via `storeFor(ctx)` in `resolve.ts` — see `requireStore`
 * in `lib/tenant.ts` for how the tenant is derived from verified auth.
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
  DecisionRecord,
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
  Supplier,
  SupportTicket,
  TicketStatus,
  TrendingProduct,
} from "../types";

export interface StoreClient {
  /** Local clock read, ISO 8601. Not a request — safe to call without awaiting. */
  now(): string;

  // Catalog
  listProducts(filter?: { status?: Product["status"]; category?: string }): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  createProduct(product: Omit<Product, "id" | "createdAt">): Promise<Product>;
  updateProduct(
    id: string,
    patch: Partial<
      Pick<Product, "price" | "compareAtPrice" | "stock" | "status" | "supplierId" | "cost">
    >,
  ): Promise<Product>;
  listTrendingProducts(): Promise<TrendingProduct[]>;

  // Customers
  listCustomers(filter?: { segment?: Customer["segment"] }): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;

  // Orders
  listOrders(filter?: { sinceDays?: number; status?: OrderStatus }): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  updateOrder(patch: { id: string; status?: OrderStatus; courierId?: string }): Promise<Order>;

  // Abandoned carts
  listAbandonedCarts(state?: CartRecoveryState): Promise<AbandonedCart[]>;
  updateCart(
    id: string,
    patch: { recoveryState?: CartRecoveryState; recoveryMessage?: string | null },
  ): Promise<AbandonedCart>;

  // Marketing
  listCampaigns(status?: Campaign["status"]): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | null>;
  createCampaign(campaign: Omit<Campaign, "id" | "dailyStats">): Promise<Campaign>;
  updateCampaign(
    id: string,
    patch: Partial<Pick<Campaign, "status" | "dailyBudget" | "notes">>,
  ): Promise<Campaign>;
  listSocialPosts(status?: SocialPost["status"]): Promise<SocialPost[]>;
  createSocialPost(post: Omit<SocialPost, "id">): Promise<SocialPost>;
  updateSocialPost(
    id: string,
    patch: Partial<Pick<SocialPost, "status" | "scheduledFor" | "publishedAt">>,
  ): Promise<SocialPost>;
  listDiscounts(activeOnly?: boolean): Promise<Discount[]>;
  createDiscount(discount: Omit<Discount, "id" | "createdAt">): Promise<Discount>;
  updateDiscount(id: string, patch: { active: boolean }): Promise<Discount>;

  // ---- Grow Lab (read-only, Phase 06) ----
  //
  // The six founder-facing Grow modules. Read-only here on purpose: Grow
  // WRITES land through the action pipeline into the store's shared
  // `growService`, so a Nova-authored campaign obeys exactly the same rules a
  // founder's does. Wiring those writes is Stage 3+ (phases 09–12); until
  // then Nova can see the doors and reason about them, not act in them.
  //
  // Every row carries `createdBy`/`novaActionId` — Nova must be able to tell
  // its own rows from the founder's before it proposes anything.

  listGrowCampaigns(status?: GrowCampaign["status"]): Promise<GrowCampaign[]>;
  listGrowPosts(status?: GrowPost["status"]): Promise<GrowPost[]>;
  listGrowBroadcasts(): Promise<GrowBroadcast[]>;
  listGrowIdeas(status?: GrowIdea["status"]): Promise<GrowIdea[]>;
  /** The target for `month` ('YYYY-MM'), or the current month when omitted. */
  getGrowGoal(month?: string): Promise<GrowGoal | null>;

  // Support & messaging
  listSupportTickets(status?: TicketStatus): Promise<SupportTicket[]>;
  getSupportTicket(id: string): Promise<SupportTicket | null>;
  addTicketMessage(
    ticketId: string,
    message: { from: "nova" | "owner"; text: string },
  ): Promise<SupportTicket>;
  updateTicketStatus(ticketId: string, status: TicketStatus): Promise<SupportTicket>;
  listCustomerMessages(filter?: {
    purpose?: CustomerMessage["purpose"];
    sinceDays?: number;
  }): Promise<CustomerMessage[]>;
  addCustomerMessage(message: Omit<CustomerMessage, "id" | "sentAt">): Promise<CustomerMessage>;

  // Suppliers & logistics
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | null>;
  listPurchaseOrders(status?: PurchaseOrder["status"]): Promise<PurchaseOrder[]>;
  createPurchaseOrder(
    po: Omit<PurchaseOrder, "id" | "createdAt" | "total">,
  ): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: string, patch: { status: PurchaseOrder["status"] }): Promise<PurchaseOrder>;
  listCouriers(): Promise<Courier[]>;
  getCourier(id: string): Promise<Courier | null>;

  // Finance
  listExpenses(sinceDays?: number): Promise<ExpenseEntry[]>;

  // ---- Nova agent data (the store persists these too) ----

  getAutonomy(): Promise<AutonomyConfig>;
  /**
   * Stage 1: everything the authority seam needs, composed in ONE read per
   * turn — level, earned ceiling, guardrails (versioned), door modes, duty
   * states, and today's committed spend. Implementations MUST throw rather
   * than return a partial state: `evaluateAuthority` fails closed on error,
   * and a silently-empty state would read as "no locks, no limits".
   */
  getAuthority(): Promise<AuthorityState>;
  /**
   * Replace the no-touch lock list, writing a NEW guardrails version.
   * Guardrail rows are immutable so a receipt can always be re-read against
   * the limits that judged it; this never edits the current row in place.
   */
  setNoTouch(locks: string[]): Promise<string[]>;

  // ---- Decisions (E-9, Stage 2) ----
  //
  // One record per gated action, rendered on every surface. The store owns
  // queue position and status transitions so two surfaces cannot disagree.
  listDecisions(filter?: { status?: DecisionRecord["status"]; tag?: string; limit?: number }): Promise<DecisionRecord[]>;
  addDecision(decision: Omit<DecisionRecord, "id" | "createdAt" | "queuePos" | "status" | "decidedBy" | "decidedAt" | "bundleRef" | "frozenByLock">): Promise<DecisionRecord>;
  updateDecision(id: string, patch: Partial<Pick<DecisionRecord, "status" | "surfacedIn" | "queuePos" | "frozenByLock" | "decidedBy" | "decidedAt">>): Promise<DecisionRecord>;
  setAutonomy(config: AutonomyConfig): Promise<AutonomyConfig>;

  listMemory(namespace?: MemoryNamespace): Promise<MemoryEntry[]>;
  upsertMemory(entry: MemoryUpsert): Promise<MemoryEntry>;
  deleteMemory(namespace: MemoryNamespace, key: string): Promise<boolean>;
  /**
   * Attach an embedding to an existing entry without touching its value or
   * `updatedAt` — the embed worker's write-back for the retrieval index.
   */
  setMemoryEmbedding(
    namespace: MemoryNamespace,
    key: string,
    embedding: number[],
  ): Promise<boolean>;

  listActivity(filter?: {
    sinceDays?: number;
    department?: ActivityEntry["department"];
  }): Promise<ActivityEntry[]>;
  addActivity(entry: Omit<ActivityEntry, "id" | "at">): Promise<ActivityEntry>;
  /** Update an activity in place — used by the nightly attribution pass. */
  updateActivity(
    id: string,
    patch: Partial<Pick<ActivityEntry, "revenueInfluence" | "revenueBasis" | "revenueProvenance">>,
  ): Promise<ActivityEntry>;

  // Procedural memory — playbooks (reflection proposes, owner promotes)
  listPlaybooks(status?: NovaPlaybook["status"]): Promise<NovaPlaybook[]>;
  upsertPlaybook(playbook: Omit<NovaPlaybook, "id" | "createdAt"> & { id?: string }): Promise<NovaPlaybook>;
  updatePlaybookStatus(id: string, status: NovaPlaybook["status"]): Promise<NovaPlaybook>;

  // Experiments — hypotheses evaluated against actuals
  listExperiments(status?: NovaExperiment["status"]): Promise<NovaExperiment[]>;
  getExperiment(id: string): Promise<NovaExperiment | null>;
  createExperiment(experiment: Omit<NovaExperiment, "id" | "startedAt">): Promise<NovaExperiment>;
  updateExperiment(
    id: string,
    patch: Partial<Pick<NovaExperiment, "actual" | "status" | "evaluatedAt" | "actionIds">>,
  ): Promise<NovaExperiment>;

  listActions(status?: ActionStatus): Promise<ActionRecord[]>;
  getAction(id: string): Promise<ActionRecord | null>;
  addAction(record: Omit<ActionRecord, "id" | "createdAt">): Promise<ActionRecord>;
  updateAction(
    id: string,
    patch: Partial<
      Pick<ActionRecord, "status" | "outcome" | "undoData" | "undoable" | "decidedAt" | "executedAt">
    >,
  ): Promise<ActionRecord>;
  /**
   * by:nova attribution (Stage 0): stamp the door record a just-executed
   * action touched (`targetRef` = "type:id") with the action id, so the door
   * UI can render the chip + receipt drawer. Metadata, never authority —
   * implementations must not throw on unattributable refs.
   */
  attributeDoorRecord(targetRef: string, actionId: string): Promise<void>;

  listReports(filter?: { kind?: NovaReport["kind"]; limit?: number }): Promise<NovaReport[]>;
  addReport(report: Omit<NovaReport, "id" | "createdAt">): Promise<NovaReport>;

  // Inbox — inbound store events (Phase 2.3)
  listInboxEvents(filter?: { processed?: boolean }): Promise<InboxEvent[]>;
  markEventProcessed(id: string): Promise<InboxEvent>;

  // ---- Proactive job queue (Phase 05) ----

  listJobDefs(): Promise<NovaJobDef[]>;
  upsertJobDef(
    kind: JobKind,
    input: { cadence: string; tz: string; enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<NovaJobDef>;
  /** Expands due job-defs and drains debounced events into jobs, then atomically leases up to `limit` due rows for this tenant. Each returned job carries its own fresh `leaseToken`. */
  claimDueJobs(limit: number): Promise<NovaJob[]>;
  /** `leaseToken` must be the value the job was claimed with — a stale (superseded) lease's call is a safe no-op, never overwriting a newer lease's outcome. */
  completeJob(id: string, leaseToken: string, sessionId?: string): Promise<void>;
  /** Requeues with backoff below the attempts cap, or marks `failed` at the cap. Same stale-lease-safe contract as completeJob. */
  releaseJob(id: string, leaseToken: string, error: string): Promise<void>;
}
