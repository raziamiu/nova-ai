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
  BrandProfile,
  Campaign,
  CartRecoveryState,
  ContentDraftInput,
  ContentItem,
  Courier,
  Customer,
  CustomerMessage,
  DecisionRecord,
  DepartmentGrade,
  Discount,
  ExpenseEntry,
  GrowBroadcast,
  GrowCampaign,
  GrowGoal,
  GrowIdea,
  GrowPost,
  InboxEvent,
  InboxHandoverRequest,
  InboxHandoverResult,
  InboxPromise,
  InboxReplyRequest,
  InboxReplyResult,
  InboxThread,
  IntentObservedRequest,
  IntentObservedResult,
  JobKind,
  LinkCustomerRequest,
  LinkCustomerResult,
  MemoryEntry,
  MemoryNamespace,
  MemoryUpsert,
  NbaBlock,
  NovaExperiment,
  NovaJob,
  NovaJobDef,
  MorningBrief,
  NovaPlaybook,
  NovaReport,
  Order,
  OrderStatus,
  PlanItem,
  Product,
  PromiseSettleRequest,
  PurchaseOrder,
  ScheduleFollowupRequest,
  ScheduleFollowupResult,
  SocialPost,
  Supplier,
  SupportTicket,
  TicketStatus,
  TrendingProduct,
} from "../types";

/**
 * The inbox reply route's refusal codes (module 02 D10 guard ladder). Every
 * one of them is a 409 with a receipted **blocked** ledger row on the server —
 * a refused send is never silence.
 *
 *  THREAD_OFF     the founder switched Nova off for this thread
 *  LOCKED         the founder holds the thread (takeover, or answered first)
 *  STALE          the customer wrote again — re-read before answering
 *  WINDOW_CLOSED  outside Meta's 24h window; v1 refuses honestly, never tags
 *  LOOP_GUARD     too many consecutive Nova messages since the last inbound
 */
export type InboxRefusalCode =
  | "THREAD_OFF"
  | "LOCKED"
  | "STALE"
  | "WINDOW_CLOSED"
  | "LOOP_GUARD"
  | "RATE_LIMITED";

/**
 * A send the server refused. Thrown (never swallowed into a fake success) so
 * the turn cannot report a message the customer will never see. The model is
 * instructed not to retry `LOCKED` — a founder-held thread stays the founder's.
 */
export class InboxSendRefused extends Error {
  readonly code: InboxRefusalCode | string;
  readonly status: number;
  constructor(code: InboxRefusalCode | string, message: string, status = 409) {
    super(message);
    this.name = "InboxSendRefused";
    this.code = code;
    this.status = status;
  }
}

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

  // ---- Night shift outputs (E-4/E-6/E-7/E-16, Stage 3) ----
  /** Upsert a department's grade AND replace its day's score metrics in one call. */
  setDepartment(dept: DepartmentGrade): Promise<DepartmentGrade>;
  /** Author a plan-board row (WAITING_ON_YOU items carry a decisionRef). */
  addPlanItem(item: Omit<PlanItem, "id">): Promise<PlanItem>;
  /** File the morning brief; tiles are computed server-side from real rows. */
  fileBrief(input: { day?: string; narrative?: string }): Promise<MorningBrief>;
  /** The structured brand voice (E-12) a draft is scored against. Returns
   *  sensible defaults when the founder hasn't configured one yet. */
  getBrandProfile(): Promise<BrandProfile>;
  /** File a scored content draft (E-11). `id` present = a regeneration round. */
  fileContent(input: ContentDraftInput): Promise<ContentItem>;

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
   * Approve-time execution for verbs the agent has NO local executor for —
   * the backend owns executors for advisory verbs and its own doors (grow
   * campaigns, coupons). Runs the backend approve pipeline: claims the linked
   * Decision (so a chat approve can't race a Desk tap into a double
   * execution), executes through the backend registry, and reports honestly
   * whether anything ran. Throws with the backend's reason on a settled or
   * frozen decision.
   */
  executePreparedAction(actionId: string): Promise<{ executed: boolean; note: string }>;
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

  // ---- Front Office — customer conversations (Stage 10, module 02) ----
  //
  // Three calls, one rule: dakio-api decides. It owns the thread lock, the
  // 24h window, the loop cap, the pacing engine and the Meta credentials, so
  // Nova can propose a reply and can be told no — it can never send.

  /**
   * Read the thread: conversation state, the last `messages` (≤50, newest
   * last), and the server-assembled customer block. The transcript is CUSTOMER
   * TEXT and every caller must frame it `untrusted()` before it reaches the
   * model. Returns null when the conversation does not exist for this tenant.
   */
  getInboxConversation(conversationId: string, opts?: { messages?: number }): Promise<InboxThread | null>;
  /**
   * Queue a reply. Success means QUEUED, not delivered — the human-timing
   * engine schedules each bubble and the outbound ledger records what actually
   * happened. Throws {@link InboxSendRefused} when a guard says no.
   */
  replyInThread(conversationId: string, input: InboxReplyRequest): Promise<InboxReplyResult>;
  /**
   * Hand the thread to the founder: locks Nova out, sends the deterministic
   * holding line, and files the brief as a Decision. Never gated at any tier —
   * escalation must always be possible.
   */
  handoverConversation(conversationId: string, input: InboxHandoverRequest): Promise<InboxHandoverResult>;

  // ---- Front Office — identity and promises (Stage 10, module 03) ----
  //
  // Same rule, one layer down: the SERVER owns identity. Nova asserts what the
  // customer said; dakio-api normalizes, variant-matches and decides. A
  // `matched:false` is an answer, not a fault — the honest default for a thread
  // is unlinked, and nothing here may invent a Customer to make a turn tidier.

  /**
   * Assert a self-stated phone, or submit a digit check. Success means the
   * SERVER decided — read `matched`: false with `mergeProposed` means two
   * records collide and the thread deliberately stays unlinked. Never creates a
   * Customer. Idempotent server-side on `novaActionId`.
   */
  linkCustomer(conversationId: string, input: LinkCustomerRequest): Promise<LinkCustomerResult>;
  /**
   * Reverse a link: clears the join and KEEPS the verified channel address
   * (D4). The address is a fact that was established; forgetting it to undo a
   * join would forget something true.
   */
  unlinkCustomer(conversationId: string): Promise<{ unlinked: boolean }>;
  /**
   * Read the commitments ledger. `status` defaults to open server-side; the
   * nightly sweep and the founder brief are the two readers.
   */
  listPromises(filter?: { status?: string; customerId?: string; limit?: number }): Promise<InboxPromise[]>;
  /**
   * Settle a promise. `kept` is only honest after a message actually SENT — a
   * draft sitting unapproved keeps nothing. `broken` is sweep-only and the
   * route rejects it here. Transitions are validated server-side (open → kept |
   * released only), so a replayed settle is a no-op, not a second transition,
   * and losing the race to the sweep is a refusal rather than an overwrite.
   */
  settlePromise(promiseId: string, input: PromiseSettleRequest): Promise<{ ok: boolean; promise: InboxPromise }>;
  /**
   * Merge two Customer rows in one transaction. The SURVIVOR is chosen
   * server-side (more orders; tie → older) — the caller names the pair, not the
   * winner. Not reversible; only ever reached through an approved Decision.
   */
  mergeCustomers(input: { customerIdA: string; customerIdB: string; basis: string }): Promise<{
    survivorCustomerId: string;
    mergedCustomerId: string;
    ordersMoved: number;
    channelsMoved: number;
    conversationsMoved: number;
    promisesMoved: number;
  }>;

  // ---- Front Office — lifecycle & NBA (Stage 10, module 04) ----
  //
  // Same rule again, one layer up: the SERVER decides what forward means. The
  // journey stage is a deterministic reducer's output and the eligible-candidate
  // list is computed from it, so Nova reads a scaffold it did not build and
  // chooses INSIDE it. Nothing here sets a stage, and nothing here sends: the
  // one write that touches a customer books a job for later, and the reply that
  // job eventually composes goes through `replyInThread` and the full gate like
  // any other.

  /**
   * Read the D6 NBA block for a thread: stage, goal, window, quiet hours, touch
   * budget, the eligible candidates and why the rest are not.
   *
   * ⚠️ RESERVED SURFACE — NO CALLER TODAY, and saying so is the alternative to a
   * method that looks wired. The live path is INLINE: every turn, including a
   * fired follow-up's, reads `get_conversation` → `thread.nba`, which dakio-api
   * re-assembles fresh on that read, so nothing in this repo needs a second
   * fetch. The route (`GET /api/v1/inbox/nba/:conversationId`) is mounted,
   * tested and named as a consumed contract by module 07 — it is kept for the
   * caller that wants "what is legal on this thread right now?" without opening
   * the whole conversation. Wire it or leave it; do not read its existence as
   * evidence that some turn depends on it.
   *
   * `null` is a real answer, not a fault, and it means one of two honest
   * things — this thread has no journey row yet (nothing real has happened to
   * it), or this server predates module 04. A caller must treat a missing block
   * as "no scaffold, answer the person anyway", never as a reason to refuse: a
   * customer waiting for a price does not care that the lifecycle engine is
   * down.
   */
  getNba(conversationId: string): Promise<NbaBlock | null>;
  /**
   * Book a follow-up: a `followup` NovaJob at `now + delay`, quiet-hour
   * shifted, superseding this conversation's existing NBA nudge if it has one.
   *
   * The server validates the delay against the journey's stage and rejects a
   * chain past `chainCount` 2 — after two unanswered follow-ups Nova stops
   * until the customer comes back. Those refusals arrive as
   * {@link InboxSendRefused}, because they are ANSWERS about what is legal, not
   * transport faults to retry.
   */
  scheduleFollowup(input: ScheduleFollowupRequest): Promise<ScheduleFollowupResult>;
  /**
   * Cancel a booked follow-up — the inverse of `scheduleFollowup`, and the only
   * thing the `schedule_follow_up` undoer can call.
   *
   * `cancelled:false` means the row was already settled (fired, superseded, or
   * cancelled by the customer writing back). That is an outcome, not an error:
   * the commitment is gone either way, which is what the founder asked for.
   *
   * The service-plane `POST /api/v1/inbox/followups/:jobId/cancel` IS built and
   * mounted (dakio-api `routes/novaInbox.js`), beside module 04's merchant-plane
   * `POST /api/nova/followups/:jobId/cancel` — same `updateMany`,
   * `lastError:'cancelled:undo'`. This carried a "SERVER COUNTERPART NOT YET
   * BUILT" warning until that landed and kept it afterwards; the undo has been
   * end-to-end since. `schedule_follow_up` returns `undoable:true` and
   * `scripts/check-undo-coverage.ts` requires an engineered inverse, not a
   * comment promising one — and now it has one.
   */
  cancelFollowup(jobId: string): Promise<{ cancelled: boolean }>;
  /**
   * Report the turn back to the reducer (D5 pass 2, D12): the intent the model
   * classified and the NBA candidate it chose.
   *
   * This is the ONLY way a model judgement becomes a stage transition, and it
   * still never sets one — the server's table reads the intent slug and decides.
   * Posting `nbaAction: "do_nothing"` is what makes chosen silence a counted
   * row rather than a turn that looks dropped.
   */
  postIntentObserved(journeyId: string, input: IntentObservedRequest): Promise<IntentObservedResult>;

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
