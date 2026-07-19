/**
 * In-memory demo implementation of the Dakio store.
 *
 * Plays the role of the Express store server: holds business data and
 * Nova's agent data, and applies mutations. State lives for the duration of
 * the process (one continuous demo "day" per server run) and is seeded with
 * a realistic dataset anchored to the current wall-clock time.
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
  MemoryEntry,
  MemoryNamespace,
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
import { createSeed } from "./seed";

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

  listProducts(filter?: { status?: Product["status"]; category?: string }): Product[] {
    return this.data.products.filter(
      (p) =>
        (filter?.status === undefined || p.status === filter.status) &&
        (filter?.category === undefined || p.category === filter.category),
    );
  }

  getProduct(id: string): Product | null {
    return this.data.products.find((p) => p.id === id || p.sku === id) ?? null;
  }

  createProduct(product: Omit<Product, "id" | "createdAt">): Product {
    const created: Product = {
      ...product,
      id: this.nextId("prod"),
      createdAt: this.now(),
    };
    this.data.products.push(created);
    return created;
  }

  updateProduct(
    id: string,
    patch: Partial<
      Pick<Product, "price" | "compareAtPrice" | "stock" | "status" | "supplierId" | "cost">
    >,
  ): Product {
    const product = this.mustFind(
      this.data.products.find((p) => p.id === id),
      "Product",
      id,
    );
    Object.assign(product, patch);
    return product;
  }

  listTrendingProducts(): TrendingProduct[] {
    return this.data.trendingProducts;
  }

  // ---- Customers ----

  listCustomers(filter?: { segment?: Customer["segment"] }): Customer[] {
    return this.data.customers.filter(
      (c) => filter?.segment === undefined || c.segment === filter.segment,
    );
  }

  getCustomer(id: string): Customer | null {
    return this.data.customers.find((c) => c.id === id) ?? null;
  }

  // ---- Orders ----

  listOrders(filter?: { sinceDays?: number; status?: OrderStatus }): Order[] {
    const cutoff = filter?.sinceDays !== undefined ? this.sinceCutoff(filter.sinceDays) : null;
    return this.data.orders.filter(
      (o) =>
        (cutoff === null || Date.parse(o.placedAt) >= cutoff) &&
        (filter?.status === undefined || o.status === filter.status),
    );
  }

  getOrder(id: string): Order | null {
    return this.data.orders.find((o) => o.id === id) ?? null;
  }

  updateOrder(patch: { id: string; status?: OrderStatus; courierId?: string }): Order {
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

  listAbandonedCarts(state?: CartRecoveryState): AbandonedCart[] {
    return this.data.abandonedCarts.filter(
      (c) => state === undefined || c.recoveryState === state,
    );
  }

  updateCart(
    id: string,
    patch: { recoveryState?: CartRecoveryState; recoveryMessage?: string | null },
  ): AbandonedCart {
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

  listCampaigns(status?: Campaign["status"]): Campaign[] {
    return this.data.campaigns.filter((c) => status === undefined || c.status === status);
  }

  getCampaign(id: string): Campaign | null {
    return this.data.campaigns.find((c) => c.id === id) ?? null;
  }

  createCampaign(campaign: Omit<Campaign, "id" | "dailyStats">): Campaign {
    const created: Campaign = { ...campaign, id: this.nextId("cmp"), dailyStats: [] };
    this.data.campaigns.push(created);
    return created;
  }

  updateCampaign(
    id: string,
    patch: Partial<Pick<Campaign, "status" | "dailyBudget" | "notes">>,
  ): Campaign {
    const campaign = this.mustFind(
      this.data.campaigns.find((c) => c.id === id),
      "Campaign",
      id,
    );
    Object.assign(campaign, patch);
    return campaign;
  }

  listSocialPosts(status?: SocialPost["status"]): SocialPost[] {
    return this.data.socialPosts.filter((p) => status === undefined || p.status === status);
  }

  createSocialPost(post: Omit<SocialPost, "id">): SocialPost {
    const created: SocialPost = { ...post, id: this.nextId("post") };
    this.data.socialPosts.push(created);
    return created;
  }

  updateSocialPost(
    id: string,
    patch: Partial<Pick<SocialPost, "status" | "scheduledFor" | "publishedAt">>,
  ): SocialPost {
    const post = this.mustFind(
      this.data.socialPosts.find((p) => p.id === id),
      "Social post",
      id,
    );
    Object.assign(post, patch);
    return post;
  }

  listDiscounts(activeOnly?: boolean): Discount[] {
    return this.data.discounts.filter((d) => !activeOnly || d.active);
  }

  createDiscount(discount: Omit<Discount, "id" | "createdAt">): Discount {
    const created: Discount = {
      ...discount,
      id: this.nextId("disc"),
      createdAt: this.now(),
    };
    this.data.discounts.push(created);
    return created;
  }

  updateDiscount(id: string, patch: { active: boolean }): Discount {
    const discount = this.mustFind(
      this.data.discounts.find((d) => d.id === id),
      "Discount",
      id,
    );
    discount.active = patch.active;
    return discount;
  }

  // ---- Support & messaging ----

  listSupportTickets(status?: TicketStatus): SupportTicket[] {
    return this.data.supportTickets.filter((t) => status === undefined || t.status === status);
  }

  getSupportTicket(id: string): SupportTicket | null {
    return this.data.supportTickets.find((t) => t.id === id) ?? null;
  }

  addTicketMessage(
    ticketId: string,
    message: { from: "nova" | "owner"; text: string },
  ): SupportTicket {
    const ticket = this.mustFind(
      this.data.supportTickets.find((t) => t.id === ticketId),
      "Ticket",
      ticketId,
    );
    ticket.messages.push({ ...message, at: this.now() });
    return ticket;
  }

  updateTicketStatus(ticketId: string, status: TicketStatus): SupportTicket {
    const ticket = this.mustFind(
      this.data.supportTickets.find((t) => t.id === ticketId),
      "Ticket",
      ticketId,
    );
    ticket.status = status;
    return ticket;
  }

  listCustomerMessages(filter?: {
    purpose?: CustomerMessage["purpose"];
    sinceDays?: number;
  }): CustomerMessage[] {
    const cutoff = filter?.sinceDays !== undefined ? this.sinceCutoff(filter.sinceDays) : null;
    return this.data.customerMessages.filter(
      (m) =>
        (filter?.purpose === undefined || m.purpose === filter.purpose) &&
        (cutoff === null || Date.parse(m.sentAt) >= cutoff),
    );
  }

  addCustomerMessage(message: Omit<CustomerMessage, "id" | "sentAt">): CustomerMessage {
    const created: CustomerMessage = {
      ...message,
      id: this.nextId("msg"),
      sentAt: this.now(),
    };
    this.data.customerMessages.push(created);
    return created;
  }

  // ---- Suppliers & logistics ----

  listSuppliers(): Supplier[] {
    return this.data.suppliers;
  }

  getSupplier(id: string): Supplier | null {
    return this.data.suppliers.find((s) => s.id === id) ?? null;
  }

  listPurchaseOrders(status?: PurchaseOrder["status"]): PurchaseOrder[] {
    return this.data.purchaseOrders.filter((po) => status === undefined || po.status === status);
  }

  createPurchaseOrder(po: Omit<PurchaseOrder, "id" | "createdAt" | "total">): PurchaseOrder {
    const created: PurchaseOrder = {
      ...po,
      id: this.nextId("po"),
      total: Math.round(po.quantity * po.unitCost * 100) / 100,
      createdAt: this.now(),
    };
    this.data.purchaseOrders.push(created);
    return created;
  }

  updatePurchaseOrder(id: string, patch: { status: PurchaseOrder["status"] }): PurchaseOrder {
    const po = this.mustFind(
      this.data.purchaseOrders.find((p) => p.id === id),
      "Purchase order",
      id,
    );
    po.status = patch.status;
    return po;
  }

  listCouriers(): Courier[] {
    return this.data.couriers;
  }

  getCourier(id: string): Courier | null {
    return this.data.couriers.find((c) => c.id === id) ?? null;
  }

  // ---- Finance ----

  listExpenses(sinceDays?: number): ExpenseEntry[] {
    const cutoff = sinceDays !== undefined ? this.sinceCutoff(sinceDays) : null;
    return this.data.expenses.filter(
      (e) => cutoff === null || Date.parse(`${e.date}T00:00:00Z`) >= cutoff,
    );
  }

  // ---- Nova agent data ----

  getAutonomy(): AutonomyConfig {
    return this.data.autonomy;
  }

  setAutonomy(config: AutonomyConfig): AutonomyConfig {
    this.data.autonomy = config;
    return config;
  }

  listMemory(namespace?: MemoryNamespace): MemoryEntry[] {
    return this.data.memory.filter((m) => namespace === undefined || m.namespace === namespace);
  }

  upsertMemory(entry: Omit<MemoryEntry, "updatedAt">): MemoryEntry {
    const existing = this.data.memory.find(
      (m) => m.namespace === entry.namespace && m.key === entry.key,
    );
    if (existing) {
      existing.value = entry.value;
      existing.updatedAt = this.now();
      return existing;
    }
    const created: MemoryEntry = { ...entry, updatedAt: this.now() };
    this.data.memory.push(created);
    return created;
  }

  deleteMemory(namespace: MemoryNamespace, key: string): boolean {
    const index = this.data.memory.findIndex(
      (m) => m.namespace === namespace && m.key === key,
    );
    if (index === -1) return false;
    this.data.memory.splice(index, 1);
    return true;
  }

  listActivity(filter?: {
    sinceDays?: number;
    department?: ActivityEntry["department"];
  }): ActivityEntry[] {
    const cutoff = filter?.sinceDays !== undefined ? this.sinceCutoff(filter.sinceDays) : null;
    return this.data.activity.filter(
      (a) =>
        (cutoff === null || Date.parse(a.at) >= cutoff) &&
        (filter?.department === undefined || a.department === filter.department),
    );
  }

  addActivity(entry: Omit<ActivityEntry, "id" | "at">): ActivityEntry {
    const created: ActivityEntry = { ...entry, id: this.nextId("act"), at: this.now() };
    this.data.activity.push(created);
    return created;
  }

  listActions(status?: ActionStatus): ActionRecord[] {
    return this.data.actions.filter((a) => status === undefined || a.status === status);
  }

  getAction(id: string): ActionRecord | null {
    return this.data.actions.find((a) => a.id === id) ?? null;
  }

  addAction(record: Omit<ActionRecord, "id" | "createdAt">): ActionRecord {
    const created: ActionRecord = {
      ...record,
      id: this.nextId("action"),
      createdAt: this.now(),
    };
    this.data.actions.push(created);
    return created;
  }

  updateAction(
    id: string,
    patch: Partial<
      Pick<ActionRecord, "status" | "outcome" | "undoData" | "decidedAt" | "executedAt">
    >,
  ): ActionRecord {
    const action = this.mustFind(
      this.data.actions.find((a) => a.id === id),
      "Action",
      id,
    );
    Object.assign(action, patch);
    return action;
  }

  listReports(filter?: { kind?: NovaReport["kind"]; limit?: number }): NovaReport[] {
    const matching = this.data.reports
      .filter((r) => filter?.kind === undefined || r.kind === filter.kind)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return filter?.limit !== undefined ? matching.slice(0, filter.limit) : matching;
  }

  addReport(report: Omit<NovaReport, "id" | "createdAt">): NovaReport {
    const created: NovaReport = {
      ...report,
      id: this.nextId("rpt"),
      createdAt: this.now(),
    };
    this.data.reports.push(created);
    return created;
  }
}
