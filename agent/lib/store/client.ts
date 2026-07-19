/**
 * The boundary between Nova and the Dakio store.
 *
 * Nova only ever talks to a `StoreClient`. Today that resolves to the
 * in-memory demo backend (`backend.ts`), seeded with realistic data for the
 * "Aurora Living" demo store. When the real Express store API is ready,
 * implement this same interface with `fetch()` calls and swap it in
 * `getStoreClient()` — no tool, subagent, or schedule changes required.
 *
 * The store persists Nova's own data too (memory, activity, prepared
 * actions, reports), matching the Dakio design where the store server saves
 * all agent data.
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
  Supplier,
  SupportTicket,
  TicketStatus,
  TrendingProduct,
} from "../types";
import { DemoStore } from "./backend";

export interface StoreClient {
  /** Store server time, ISO 8601. */
  now(): string;

  // Catalog
  listProducts(filter?: { status?: Product["status"]; category?: string }): Product[];
  getProduct(id: string): Product | null;
  createProduct(product: Omit<Product, "id" | "createdAt">): Product;
  updateProduct(
    id: string,
    patch: Partial<
      Pick<Product, "price" | "compareAtPrice" | "stock" | "status" | "supplierId" | "cost">
    >,
  ): Product;
  listTrendingProducts(): TrendingProduct[];

  // Customers
  listCustomers(filter?: { segment?: Customer["segment"] }): Customer[];
  getCustomer(id: string): Customer | null;

  // Orders
  listOrders(filter?: { sinceDays?: number; status?: OrderStatus }): Order[];
  getOrder(id: string): Order | null;
  updateOrder(patch: { id: string; status?: OrderStatus; courierId?: string }): Order;

  // Abandoned carts
  listAbandonedCarts(state?: CartRecoveryState): AbandonedCart[];
  updateCart(
    id: string,
    patch: { recoveryState?: CartRecoveryState; recoveryMessage?: string | null },
  ): AbandonedCart;

  // Marketing
  listCampaigns(status?: Campaign["status"]): Campaign[];
  getCampaign(id: string): Campaign | null;
  createCampaign(campaign: Omit<Campaign, "id" | "dailyStats">): Campaign;
  updateCampaign(
    id: string,
    patch: Partial<Pick<Campaign, "status" | "dailyBudget" | "notes">>,
  ): Campaign;
  listSocialPosts(status?: SocialPost["status"]): SocialPost[];
  createSocialPost(post: Omit<SocialPost, "id">): SocialPost;
  updateSocialPost(
    id: string,
    patch: Partial<Pick<SocialPost, "status" | "scheduledFor" | "publishedAt">>,
  ): SocialPost;
  listDiscounts(activeOnly?: boolean): Discount[];
  createDiscount(discount: Omit<Discount, "id" | "createdAt">): Discount;
  updateDiscount(id: string, patch: { active: boolean }): Discount;

  // Support & messaging
  listSupportTickets(status?: TicketStatus): SupportTicket[];
  getSupportTicket(id: string): SupportTicket | null;
  addTicketMessage(
    ticketId: string,
    message: { from: "nova" | "owner"; text: string },
  ): SupportTicket;
  updateTicketStatus(ticketId: string, status: TicketStatus): SupportTicket;
  listCustomerMessages(filter?: {
    purpose?: CustomerMessage["purpose"];
    sinceDays?: number;
  }): CustomerMessage[];
  addCustomerMessage(message: Omit<CustomerMessage, "id" | "sentAt">): CustomerMessage;

  // Suppliers & logistics
  listSuppliers(): Supplier[];
  getSupplier(id: string): Supplier | null;
  listPurchaseOrders(status?: PurchaseOrder["status"]): PurchaseOrder[];
  createPurchaseOrder(
    po: Omit<PurchaseOrder, "id" | "createdAt" | "total">,
  ): PurchaseOrder;
  updatePurchaseOrder(id: string, patch: { status: PurchaseOrder["status"] }): PurchaseOrder;
  listCouriers(): Courier[];
  getCourier(id: string): Courier | null;

  // Finance
  listExpenses(sinceDays?: number): ExpenseEntry[];

  // ---- Nova agent data (the store persists these too) ----

  getAutonomy(): AutonomyConfig;
  setAutonomy(config: AutonomyConfig): AutonomyConfig;

  listMemory(namespace?: MemoryNamespace): MemoryEntry[];
  upsertMemory(entry: Omit<MemoryEntry, "updatedAt">): MemoryEntry;
  deleteMemory(namespace: MemoryNamespace, key: string): boolean;

  listActivity(filter?: { sinceDays?: number; department?: ActivityEntry["department"] }): ActivityEntry[];
  addActivity(entry: Omit<ActivityEntry, "id" | "at">): ActivityEntry;

  listActions(status?: ActionStatus): ActionRecord[];
  getAction(id: string): ActionRecord | null;
  addAction(record: Omit<ActionRecord, "id" | "createdAt">): ActionRecord;
  updateAction(
    id: string,
    patch: Partial<
      Pick<ActionRecord, "status" | "outcome" | "undoData" | "decidedAt" | "executedAt">
    >,
  ): ActionRecord;

  listReports(filter?: { kind?: NovaReport["kind"]; limit?: number }): NovaReport[];
  addReport(report: Omit<NovaReport, "id" | "createdAt">): NovaReport;
}

let singleton: StoreClient | null = null;

/**
 * Resolve the store client. Demo backend for now; replace the constructor
 * with an HTTP implementation pointed at the Express store to go live.
 */
export function getStoreClient(): StoreClient {
  if (!singleton) {
    singleton = new DemoStore();
  }
  return singleton;
}
