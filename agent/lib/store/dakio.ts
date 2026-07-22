/**
 * DakioStoreClient — the live HTTP implementation of {@link StoreClient}
 * (Phase 02). It talks to the Dakio Express backend over HTTPS:
 *
 *   - agent data (config/memory/activity/actions/reports/experiments/playbooks/
 *     inbox) ↔ `/api/v1/agent-data/*`
 *   - commerce reads (products/customers/orders/carts/discounts/expenses/
 *     suppliers/purchase-orders/campaigns/couriers/trending) ← `/api/v1/store/*`
 *
 * The backend returns already-Nova-shaped JSON, so this client is a thin
 * adapter: fetch → unwrap. All impedance (Decimal→number, status maps, derived
 * customer segment/LTV, stock summing) lives server-side in `routes/novaStore.js`.
 *
 * SCOPE — Phase 2.1 shipped read-only commerce + full agent-data. Phase 2.2
 * adds commerce mutations: products, orders (status/courier), abandoned-cart
 * recovery state, discounts, purchase orders. Campaign writes, social posts,
 * support-ticket status, and customer messaging remain {@link NotImplementedError}
 * — not oversights but gaps with no honest Dakio backing (campaigns are a
 * read-only product decision; the rest have no ticket-status store or
 * customer↔Meta-conversation link to write through). A mis-configured
 * autonomy level fails loudly on these rather than pretending to act. Gap
 * groups with no live source yet (couriers, trending, campaign insights) read
 * as empty. See `docs/blueprint/02-findings-live-dakio.md`.
 *
 * Auth: a per-tenant Nova service token (Bearer). Tenancy is enforced server-
 * side from the token; this client never sends a store id in the body.
 */

import type {
  AbandonedCart,
  ActionRecord,
  ActionStatus,
  ActivityEntry,
  AutonomyConfig,
  Campaign,
  CartRecoveryState,
  Courier,
  Customer,
  CustomerMessage,
  Discount,
  ExpenseEntry,
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
import type { StoreClient } from "./client";
import { DEFAULT_GUARDRAILS } from "../nova/autonomy";

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not available until Phase 2.2 (live commerce mutations).`);
    this.name = "NotImplementedError";
  }
}

export interface DakioClientConfig {
  baseUrl: string;
  /** Per-tenant Nova service token (Bearer). */
  token: string;
  /** Retry budget for 429/5xx. Default 3. */
  maxRetries?: number;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Return null instead of throwing on 404 (for get-by-id). */
  nullOn404?: boolean;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class DakioStoreClient implements StoreClient {
  private readonly base: string;
  private readonly token: string;
  private readonly maxRetries: number;

  constructor(
    private readonly storeId: string,
    config: DakioClientConfig,
  ) {
    this.base = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.maxRetries = config.maxRetries ?? 3;
  }

  now(): string {
    return new Date().toISOString();
  }

  // --- HTTP core ------------------------------------------------------------

  private url(path: string, query?: RequestOptions["query"]): string {
    const u = new URL(this.base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const isWrite = method !== "GET" && method !== "HEAD";
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    // Stable idempotency key per logical call, reused across retries so a
    // replayed write is deduped server-side (blueprint §Idempotency).
    if (isWrite) headers["idempotency-key"] = crypto.randomUUID();

    const url = this.url(path, opts.query);
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (err) {
        // Network error — retry with backoff.
        lastErr = err;
        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw new Error(`Dakio ${method} ${path} failed: ${String(err)}`);
      }

      if (res.status === 404 && opts.nullOn404) {
        return null as T;
      }
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await this.backoff(attempt);
        continue;
      }
      // Non-retryable (or budget exhausted): surface the taxonomy.
      const detail = await res.text().catch(() => "");
      throw new Error(`Dakio ${method} ${path} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    throw new Error(`Dakio ${method} ${path} exhausted retries: ${String(lastErr)}`);
  }

  private backoff(attempt: number): Promise<void> {
    // Exponential + jitter: ~150ms, 300ms, 600ms …
    const base = 150 * 2 ** attempt;
    const jitter = base * 0.25 * Math.random();
    return new Promise((r) => setTimeout(r, base + jitter));
  }

  private get<T>(path: string, query?: RequestOptions["query"], nullOn404 = false): Promise<T> {
    return this.request<T>(path, { query, nullOn404 });
  }

  // ==========================================================================
  // Catalog (read)
  // ==========================================================================

  async listProducts(filter?: { status?: Product["status"]; category?: string }): Promise<Product[]> {
    const { products } = await this.get<{ products: Product[] }>("/api/v1/store/products", {
      status: filter?.status,
      category: filter?.category,
    });
    return products;
  }

  async getProduct(id: string): Promise<Product | null> {
    return this.get<Product | null>(`/api/v1/store/products/${encodeURIComponent(id)}`, undefined, true);
  }

  async createProduct(product: Omit<Product, "id" | "createdAt">): Promise<Product> {
    return this.request<Product>("/api/v1/store/products", { method: "POST", body: product });
  }

  async updateProduct(
    id: string,
    patch: Partial<Pick<Product, "price" | "compareAtPrice" | "stock" | "status" | "supplierId" | "cost">>,
  ): Promise<Product> {
    return this.request<Product>(`/api/v1/store/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  async listTrendingProducts(): Promise<TrendingProduct[]> {
    const { trending } = await this.get<{ trending: TrendingProduct[] }>("/api/v1/store/trending");
    return trending;
  }

  // ==========================================================================
  // Customers (read)
  // ==========================================================================

  async listCustomers(filter?: { segment?: Customer["segment"] }): Promise<Customer[]> {
    const { customers } = await this.get<{ customers: Customer[] }>("/api/v1/store/customers", {
      segment: filter?.segment,
    });
    return customers;
  }

  async getCustomer(id: string): Promise<Customer | null> {
    return this.get<Customer | null>(`/api/v1/store/customers/${encodeURIComponent(id)}`, undefined, true);
  }

  // ==========================================================================
  // Orders (read; status/courier mutations are Phase 2.2)
  // ==========================================================================

  async listOrders(filter?: { sinceDays?: number; status?: OrderStatus }): Promise<Order[]> {
    const { orders } = await this.get<{ orders: Order[] }>("/api/v1/store/orders", {
      sinceDays: filter?.sinceDays,
      status: filter?.status,
    });
    return orders;
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.get<Order | null>(`/api/v1/store/orders/${encodeURIComponent(id)}`, undefined, true);
  }

  async updateOrder(patch: { id: string; status?: OrderStatus; courierId?: string }): Promise<Order> {
    const { id, ...body } = patch;
    return this.request<Order>(`/api/v1/store/orders/${encodeURIComponent(id)}`, { method: "PATCH", body });
  }

  // ==========================================================================
  // Abandoned carts (read; recovery mutation is Phase 2.2)
  // ==========================================================================

  async listAbandonedCarts(state?: CartRecoveryState): Promise<AbandonedCart[]> {
    const { carts } = await this.get<{ carts: AbandonedCart[] }>("/api/v1/store/carts");
    return state === undefined ? carts : carts.filter((c) => c.recoveryState === state);
  }

  async updateCart(
    id: string,
    patch: { recoveryState?: CartRecoveryState; recoveryMessage?: string | null },
  ): Promise<AbandonedCart> {
    return this.request<AbandonedCart>(`/api/v1/store/carts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  // ==========================================================================
  // Marketing (campaigns read-only Meta; social posts are a gap)
  // ==========================================================================

  async listCampaigns(status?: Campaign["status"]): Promise<Campaign[]> {
    const { campaigns } = await this.get<{ campaigns: Campaign[] }>("/api/v1/store/campaigns");
    return status === undefined ? campaigns : campaigns.filter((c) => c.status === status);
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const campaigns = await this.listCampaigns();
    return campaigns.find((c) => c.id === id) ?? null;
  }

  async createCampaign(): Promise<Campaign> {
    throw new NotImplementedError("createCampaign");
  }

  async updateCampaign(): Promise<Campaign> {
    throw new NotImplementedError("updateCampaign");
  }

  // Social posts: no live Dakio source (Meta content-publishing not integrated).
  async listSocialPosts(): Promise<SocialPost[]> {
    return [];
  }

  async createSocialPost(): Promise<SocialPost> {
    throw new NotImplementedError("createSocialPost");
  }

  async updateSocialPost(): Promise<SocialPost> {
    throw new NotImplementedError("updateSocialPost");
  }

  async listDiscounts(activeOnly?: boolean): Promise<Discount[]> {
    const { discounts } = await this.get<{ discounts: Discount[] }>("/api/v1/store/discounts", {
      activeOnly: activeOnly === true ? true : undefined,
    });
    return discounts;
  }

  async createDiscount(discount: Omit<Discount, "id" | "createdAt">): Promise<Discount> {
    return this.request<Discount>("/api/v1/store/discounts", { method: "POST", body: discount });
  }

  async updateDiscount(id: string, patch: { active: boolean }): Promise<Discount> {
    return this.request<Discount>(`/api/v1/store/discounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  // ==========================================================================
  // Support & messaging — Phase 2.2 (map to Meta inbox + email). Reads empty.
  // ==========================================================================

  async listSupportTickets(): Promise<SupportTicket[]> {
    return [];
  }

  async getSupportTicket(): Promise<SupportTicket | null> {
    return null;
  }

  async addTicketMessage(): Promise<SupportTicket> {
    throw new NotImplementedError("addTicketMessage");
  }

  async updateTicketStatus(): Promise<SupportTicket> {
    throw new NotImplementedError("updateTicketStatus");
  }

  async listCustomerMessages(): Promise<CustomerMessage[]> {
    return [];
  }

  async addCustomerMessage(): Promise<CustomerMessage> {
    throw new NotImplementedError("addCustomerMessage");
  }

  // ==========================================================================
  // Suppliers & logistics (read; couriers are a gap)
  // ==========================================================================

  async listSuppliers(): Promise<Supplier[]> {
    const { suppliers } = await this.get<{ suppliers: Supplier[] }>("/api/v1/store/suppliers");
    return suppliers;
  }

  async getSupplier(id: string): Promise<Supplier | null> {
    return this.get<Supplier | null>(`/api/v1/store/suppliers/${encodeURIComponent(id)}`, undefined, true);
  }

  async listPurchaseOrders(status?: PurchaseOrder["status"]): Promise<PurchaseOrder[]> {
    const { purchaseOrders } = await this.get<{ purchaseOrders: PurchaseOrder[] }>(
      "/api/v1/store/purchase-orders",
      { status },
    );
    return purchaseOrders;
  }

  async createPurchaseOrder(po: Omit<PurchaseOrder, "id" | "createdAt" | "total">): Promise<PurchaseOrder> {
    return this.request<PurchaseOrder>("/api/v1/store/purchase-orders", { method: "POST", body: po });
  }

  async updatePurchaseOrder(id: string, patch: { status: PurchaseOrder["status"] }): Promise<PurchaseOrder> {
    return this.request<PurchaseOrder>(`/api/v1/store/purchase-orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  async listCouriers(): Promise<Courier[]> {
    const { couriers } = await this.get<{ couriers: Courier[] }>("/api/v1/store/couriers");
    return couriers;
  }

  async getCourier(id: string): Promise<Courier | null> {
    const couriers = await this.listCouriers();
    return couriers.find((c) => c.id === id) ?? null;
  }

  // ==========================================================================
  // Finance (read)
  // ==========================================================================

  async listExpenses(sinceDays?: number): Promise<ExpenseEntry[]> {
    const { expenses } = await this.get<{ expenses: ExpenseEntry[] }>("/api/v1/store/expenses", { sinceDays });
    return expenses;
  }

  // ==========================================================================
  // Nova agent data (persisted in Dakio via /api/v1/agent-data/*)
  // ==========================================================================

  async getAutonomy(): Promise<AutonomyConfig> {
    const { autonomy } = await this.get<{ autonomy: AutonomyConfig | null }>("/api/v1/agent-data/config");
    return autonomy ?? { level: 2, guardrails: DEFAULT_GUARDRAILS, updatedAt: this.now() };
  }

  async setAutonomy(config: AutonomyConfig): Promise<AutonomyConfig> {
    const { autonomy } = await this.request<{ autonomy: AutonomyConfig }>("/api/v1/agent-data/config", {
      method: "PUT",
      body: { autonomy: config },
    });
    return autonomy;
  }

  async listMemory(namespace?: MemoryNamespace): Promise<MemoryEntry[]> {
    const { entries } = await this.get<{ entries: MemoryEntry[] }>("/api/v1/agent-data/memory", { namespace });
    return entries;
  }

  async upsertMemory(entry: MemoryUpsert): Promise<MemoryEntry> {
    return this.request<MemoryEntry>("/api/v1/agent-data/memory", { method: "POST", body: entry });
  }

  async deleteMemory(namespace: MemoryNamespace, key: string): Promise<boolean> {
    const { deleted } = await this.request<{ deleted: boolean }>("/api/v1/agent-data/memory", {
      method: "DELETE",
      body: { namespace, key },
    });
    return deleted;
  }

  async setMemoryEmbedding(namespace: MemoryNamespace, key: string, embedding: number[]): Promise<boolean> {
    const { ok } = await this.request<{ ok: boolean }>("/api/v1/agent-data/memory/embedding", {
      method: "POST",
      body: { namespace, key, embedding },
    });
    return ok;
  }

  async listActivity(filter?: {
    sinceDays?: number;
    department?: ActivityEntry["department"];
  }): Promise<ActivityEntry[]> {
    const { entries } = await this.get<{ entries: ActivityEntry[] }>("/api/v1/agent-data/activity", {
      sinceDays: filter?.sinceDays,
      department: filter?.department,
    });
    return entries;
  }

  async addActivity(entry: Omit<ActivityEntry, "id" | "at">): Promise<ActivityEntry> {
    return this.request<ActivityEntry>("/api/v1/agent-data/activity", { method: "POST", body: entry });
  }

  async updateActivity(
    id: string,
    patch: Partial<Pick<ActivityEntry, "revenueInfluence" | "revenueBasis" | "revenueProvenance">>,
  ): Promise<ActivityEntry> {
    return this.request<ActivityEntry>(`/api/v1/agent-data/activity/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  async listPlaybooks(status?: NovaPlaybook["status"]): Promise<NovaPlaybook[]> {
    const { playbooks } = await this.get<{ playbooks: NovaPlaybook[] }>("/api/v1/agent-data/playbooks", { status });
    return playbooks;
  }

  async upsertPlaybook(
    playbook: Omit<NovaPlaybook, "id" | "createdAt"> & { id?: string },
  ): Promise<NovaPlaybook> {
    return this.request<NovaPlaybook>("/api/v1/agent-data/playbooks", { method: "POST", body: playbook });
  }

  async updatePlaybookStatus(id: string, status: NovaPlaybook["status"]): Promise<NovaPlaybook> {
    return this.request<NovaPlaybook>(`/api/v1/agent-data/playbooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { status },
    });
  }

  async listExperiments(status?: NovaExperiment["status"]): Promise<NovaExperiment[]> {
    const { experiments } = await this.get<{ experiments: NovaExperiment[] }>("/api/v1/agent-data/experiments", {
      status,
    });
    return experiments;
  }

  async getExperiment(id: string): Promise<NovaExperiment | null> {
    return this.get<NovaExperiment | null>(
      `/api/v1/agent-data/experiments/${encodeURIComponent(id)}`,
      undefined,
      true,
    );
  }

  async createExperiment(experiment: Omit<NovaExperiment, "id" | "startedAt">): Promise<NovaExperiment> {
    return this.request<NovaExperiment>("/api/v1/agent-data/experiments", { method: "POST", body: experiment });
  }

  async updateExperiment(
    id: string,
    patch: Partial<Pick<NovaExperiment, "actual" | "status" | "evaluatedAt" | "actionIds">>,
  ): Promise<NovaExperiment> {
    return this.request<NovaExperiment>(`/api/v1/agent-data/experiments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  // The dakio-api receipt wire shape uses `expected_impact` (PRD §12 naming);
  // TypeScript uses `expectedImpact` everywhere. Map at the boundary only.
  private receiptToWire(receipt: ActionRecord["receipt"]): Record<string, unknown> {
    const { expectedImpact, ...rest } = receipt;
    return { ...rest, expected_impact: expectedImpact };
  }

  private actionFromWire(row: Record<string, unknown>): ActionRecord {
    const wire = row.receipt as (Record<string, unknown> & { expected_impact?: string }) | null;
    const receipt = wire
      ? (() => {
          const { expected_impact, ...rest } = wire;
          return { ...rest, expectedImpact: expected_impact ?? "" };
        })()
      : null;
    return { ...(row as unknown as ActionRecord), receipt: receipt as ActionRecord["receipt"] };
  }

  async listActions(status?: ActionStatus): Promise<ActionRecord[]> {
    const { actions } = await this.get<{ actions: Record<string, unknown>[] }>("/api/v1/agent-data/actions", { status });
    return actions.map((a) => this.actionFromWire(a));
  }

  async getAction(id: string): Promise<ActionRecord | null> {
    const row = await this.get<Record<string, unknown> | null>(
      `/api/v1/agent-data/actions/${encodeURIComponent(id)}`,
      undefined,
      true,
    );
    return row ? this.actionFromWire(row) : null;
  }

  async addAction(record: Omit<ActionRecord, "id" | "createdAt">): Promise<ActionRecord> {
    const body = { ...record, receipt: this.receiptToWire(record.receipt) };
    const row = await this.request<Record<string, unknown>>("/api/v1/agent-data/actions", { method: "POST", body });
    return this.actionFromWire(row);
  }

  async updateAction(
    id: string,
    patch: Partial<Pick<ActionRecord, "status" | "outcome" | "undoData" | "undoable" | "decidedAt" | "executedAt">>,
  ): Promise<ActionRecord> {
    const row = await this.request<Record<string, unknown>>(`/api/v1/agent-data/actions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
    return this.actionFromWire(row);
  }

  async listReports(filter?: { kind?: NovaReport["kind"]; limit?: number }): Promise<NovaReport[]> {
    const { reports } = await this.get<{ reports: NovaReport[] }>("/api/v1/agent-data/reports", {
      kind: filter?.kind,
      limit: filter?.limit,
    });
    return reports;
  }

  async addReport(report: Omit<NovaReport, "id" | "createdAt">): Promise<NovaReport> {
    return this.request<NovaReport>("/api/v1/agent-data/reports", { method: "POST", body: report });
  }

  // ==========================================================================
  // Inbox — inbound store events (Phase 2.3)
  // ==========================================================================

  async listInboxEvents(filter?: { processed?: boolean }): Promise<InboxEvent[]> {
    const { events } = await this.get<{ events: InboxEvent[] }>("/api/v1/agent-data/inbox", {
      processed: filter?.processed,
    });
    return events;
  }

  async markEventProcessed(id: string): Promise<InboxEvent> {
    return this.request<InboxEvent>(`/api/v1/agent-data/inbox/${encodeURIComponent(id)}`, { method: "PATCH" });
  }

  // ==========================================================================
  // Proactive job queue (Phase 05)
  //
  // No Idempotency-Key header on these — unlike commerce mutations, claim/
  // complete/release are idempotent by construction: claim only leases
  // currently-due rows (a retry just finds fewer or none left), and
  // complete/release both recompute their result from the job's current
  // server-side state rather than from client-supplied deltas, so replaying
  // either is a harmless no-op / re-application of the same outcome.
  // ==========================================================================

  async listJobDefs(): Promise<NovaJobDef[]> {
    const { jobDefs } = await this.get<{ jobDefs: NovaJobDef[] }>("/api/v1/agent-data/job-defs");
    return jobDefs;
  }

  async upsertJobDef(
    kind: JobKind,
    input: { cadence: string; tz: string; enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<NovaJobDef> {
    return this.request<NovaJobDef>(`/api/v1/agent-data/job-defs/${encodeURIComponent(kind)}`, {
      method: "PUT",
      body: input,
    });
  }

  async claimDueJobs(limit: number): Promise<NovaJob[]> {
    const { jobs } = await this.request<{ jobs: NovaJob[] }>("/api/v1/agent-data/jobs/claim", {
      method: "POST",
      body: { limit },
    });
    return jobs;
  }

  async completeJob(id: string, leaseToken: string, sessionId?: string): Promise<void> {
    await this.request(`/api/v1/agent-data/jobs/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: { leaseToken, sessionId },
    });
  }

  async releaseJob(id: string, leaseToken: string, error: string): Promise<void> {
    await this.request(`/api/v1/agent-data/jobs/${encodeURIComponent(id)}/release`, {
      method: "POST",
      body: { leaseToken, error },
    });
  }
}
