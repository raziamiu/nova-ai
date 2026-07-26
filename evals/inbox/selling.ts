/**
 * Stage 10 module 05 — the FAIL-CLOSED corpus for the two selling guardrails.
 *
 * `evals/inbox/run.ts` proves that a registered `inbox.*Auto`-gated verb drafts
 * on an EMPTY platform. That is the floor. This suite proves the thing the floor
 * cannot see: that each key those branches read denies INDIVIDUALLY, on a
 * platform where every other key is present and permissive.
 *
 * ── WHY THAT DISTINCTION IS THE WHOLE SUITE. ──────────────────────────────
 * `evaluateAuthority` calls `checkGuardrailsForAuthority(client,
 * state.guardrails.platform, …)`, so the parameter named `guardrails` inside
 * `checkGuardrails` is ONLY the flat `inbox.*` bag — while its declared type
 * says the canonical trio (`maxDiscountPct`, `dailySpendCapMinor`, `noTouch`)
 * is there too. So `guardrails.maxDiscountPct` COMPILES, is `undefined` at
 * runtime, and `pct > undefined` is `false`: the clause allows everything.
 * That is not hypothetical — the `create_discount` block at the top of that
 * switch has been dead for exactly this reason since it was written, and it is
 * masked only by a separate check in `authority.ts`.
 *
 * An empty-platform test cannot catch that. A branch that reads the WRONG key
 * name still returns `needs_approval` on an empty platform, because the FIRST
 * check (`inbox.orderAuto`) fails and the later ones never run. Only deleting
 * one key at a time from an otherwise-allowing platform reaches them, which is
 * why this suite is built as a delta table over a baseline that ALLOWS.
 *
 * The baseline itself is therefore load-bearing: if `allow` ever stops being
 * reachable, every "missing key denies" row below passes for the wrong reason.
 * [sell-1] asserts the baseline allows before anything else runs.
 *
 * Deterministic by construction: no model, no network, no key. The client is a
 * hand-built stub, because the point is to control exactly which keys exist.
 *
 * WIRING: exports {@link runSellingGuardrailSuite} and also self-runs when
 * invoked directly, the same shape as `c360.ts` / `promises.ts` / `identity.ts`,
 * so `evals/inbox/run.ts` can fold its counts in without the import exiting the
 * process. Until that fold lands it runs on its own through `test:selling`.
 *
 * Run:  npx -y tsx evals/inbox/selling.ts
 */

import { pathToFileURL } from "node:url";

import { evaluateAuthority } from "../../agent/lib/nova/authority";
import { executors, undoers } from "../../agent/lib/nova/executors";
import { DemoStore } from "../../agent/lib/store/backend";
import type { StoreClient } from "../../agent/lib/store/client";
import type { AuthorityState, CustomerRiskView, Product, StoreSettings } from "../../agent/lib/types";

// --- assert framework (same shape as the sibling suites) --------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- fixtures ---------------------------------------------------------------

/**
 * A platform bag with EVERY key both branches read, all set permissively.
 *
 * `inbox.maxAutoOrder` is 5000 WHOLE TAKA — not 500000 poisha. The module doc
 * called this key `inbox.maxAutoOrderMinor`; comparing a ৳1,780 order against
 * 500000 makes a ৳5,000 cap behave like a ৳500,000 one and nothing ever drafts,
 * so [sell-4] pins the unit by driving an order straight across the boundary.
 */
const PERMISSIVE: Record<string, unknown> = {
  "inbox.orderAuto": true,
  "inbox.maxAutoOrder": 5000,
  "inbox.rtoShadowThreshold": 2,
  "inbox.discountAuto": true,
  "inbox.maxDiscountPct": 15,
  "inbox.discountPerCustomerDays": 30,
};

/** A ৳500 product, so two of them plus ৳120 delivery is ৳1,120 — under the cap. */
const PRODUCT: Product = {
  id: "prod-1",
  sku: "HJB-01",
  name: "Hijab Set",
  category: "Apparel",
  description: "",
  price: 500,
  compareAtPrice: null,
  cost: 300,
  stock: 40,
  reorderPoint: 5,
  supplierId: "sup-1",
  status: "active",
  rating: 4.6,
  reviewCount: 12,
  weeklyVelocity: [3, 4, 5, 4],
  tags: [],
  createdAt: new Date().toISOString(),
};

const SETTINGS: StoreSettings = {
  storeName: "Test Shop",
  storefrontUrl: null,
  deliveryInsideDhaka: 60,
  deliveryOutsideDhaka: 120,
  codAvailable: true,
  policies: [],
};

const CLEAN_RISK: CustomerRiskView = {
  phone: "01712345678",
  level: "POSITIVE",
  totalOrders: 4,
  deliveredOrders: 4,
  cancelledOrders: 0,
  activeOrders: 0,
  rtoCount: 0,
  cancelledOnlyCount: 0,
  successRate: 1,
  returnRate: 0,
  message: "4 delivered",
};

interface Fixture {
  platform?: Record<string, unknown>;
  product?: Product | null;
  productThrows?: boolean;
  settingsThrow?: boolean;
  risk?: CustomerRiskView | null;
  riskThrows?: boolean;
}

/**
 * The smallest client `evaluateAuthority` + the two branches actually touch.
 *
 * Level 4 with an autonomous Inbox door on purpose: this suite is about the
 * GUARDRAIL layer, and anything lower would be stopped by the dial before the
 * branch ran — which would make every row below pass without the code under
 * test ever executing.
 */
function gateClient(fixture: Fixture = {}): StoreClient {
  const state: AuthorityState = {
    level: 4,
    earnedLevel: 4,
    guardrails: {
      version: 1,
      dailySpendCapMinor: 500_000,
      // The canonical-trio ceiling, deliberately set HIGHER than the inbox one
      // and deliberately never satisfied by it. [sell-6] uses this gap.
      maxDiscountPct: 90,
      noTouch: [],
      platform: (fixture.platform ?? PERMISSIVE) as never,
    },
    modes: { "door:Inbox": "autonomous", store: "autonomous" },
    duties: {
      "sales.inbox_orders": { key: "sales.inbox_orders", minLevel: 2, enabled: true, doorExists: true },
      "sales.inbox_discounts": { key: "sales.inbox_discounts", minLevel: 2, enabled: true, doorExists: true },
    },
    spentTodayMinor: 0,
  } as AuthorityState;

  return {
    now: () => new Date().toISOString(),
    getAuthority: async () => state,
    getProduct: async () => {
      if (fixture.productThrows) throw new Error("catalogue unavailable");
      return fixture.product === undefined ? PRODUCT : fixture.product;
    },
    getStoreSettings: async () => {
      if (fixture.settingsThrow) throw new Error("settings unavailable");
      return SETTINGS;
    },
    getCustomerRisk: async () => {
      if (fixture.riskThrows) throw new Error("risk read failed");
      return fixture.risk === undefined ? CLEAN_RISK : fixture.risk;
    },
  } as unknown as StoreClient;
}

/** A chat order that should sail through a fully permissive platform. */
function validOrder(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: "conv-a-1",
    customerName: "Rina",
    customerPhone: "01712345678",
    customerCity: "Mirpur",
    customerDistrict: "Dhaka",
    items: [{ productId: "prod-1", productName: "Hijab Set", qty: 2 }],
    confirmedByCustomer: true,
    ...over,
  };
}

/** A percent discount inside every bound. */
function validDiscount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: "conv-a-1",
    customerId: "cus-1",
    mechanism: "percent",
    percentOff: 10,
    expiresHours: 48,
    reason: "second ask on a 1720 tk cart",
    ...over,
  };
}

/** Drop exactly one key from the permissive bag. */
function without(key: string): Record<string, unknown> {
  const copy = { ...PERMISSIVE };
  delete copy[key];
  return copy;
}

const judgeOrder = (fixture: Fixture, payload = validOrder()) =>
  evaluateAuthority(gateClient(fixture), {
    type: "create_order_from_chat",
    payload,
    dutyKey: "sales.inbox_orders",
  });

const judgeDiscount = (fixture: Fixture, payload = validDiscount()) =>
  evaluateAuthority(gateClient(fixture), {
    type: "offer_chat_discount",
    payload,
    dutyKey: "sales.inbox_discounts",
  });

// --- the suite --------------------------------------------------------------

export async function runSellingGuardrailSuite(): Promise<{ passed: number; failures: string[] }> {
  // [sell-1] NON-VACUITY. Everything below is "…and now it denies"; if the
  //          baseline never allowed, every one of those rows would be green
  //          against a branch that refuses unconditionally.
  console.log("\n[sell-1] The baseline really allows — without this the whole suite is vacuous");
  {
    const order = await judgeOrder({});
    check(
      "a confirmed, in-cap, clean-history chat order EXECUTES on a fully permissive platform",
      order.verdict === "execute",
      `${order.verdict} / ${order.rule}`,
    );
    const discount = await judgeDiscount({});
    check(
      "a 10% discount inside every bound EXECUTES on a fully permissive platform",
      discount.verdict === "execute",
      `${discount.verdict} / ${discount.rule}`,
    );
  }

  // [sell-2] The fail-closed table. One key removed at a time, from a platform
  //          that otherwise allows — the only shape that reaches a branch's
  //          LATER checks at all.
  console.log("\n[sell-2] Every key each branch reads denies when it is missing");
  {
    const orderKeys: [string, string][] = [
      ["inbox.orderAuto", "guardrail:inbox_order_auto_off"],
      ["inbox.maxAutoOrder", "guardrail:inbox_order_needs_review"],
      ["inbox.rtoShadowThreshold", "guardrail:inbox_order_needs_review"],
    ];
    for (const [key, rule] of orderKeys) {
      const verdict = await judgeOrder({ platform: without(key) });
      check(
        `order: a missing ${key} DRAFTS (${rule})`,
        verdict.verdict === "draft" && verdict.rule === rule,
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
    const discountKeys: [string, string][] = [
      ["inbox.discountAuto", "guardrail:inbox_discount_auto_off"],
      // `…_no_ceiling`, not `…_auto_off`: the ceiling is now read BEFORE the auto
      // switch, so a missing ceiling is reported as a missing ceiling.
      ["inbox.maxDiscountPct", "guardrail:inbox_discount_no_ceiling"],
      ["inbox.discountPerCustomerDays", "guardrail:inbox_discount_frequency"],
    ];
    for (const [key, rule] of discountKeys) {
      const verdict = await judgeDiscount({ platform: without(key) });
      check(
        `discount: a missing ${key} DRAFTS (${rule})`,
        verdict.verdict === "draft" && verdict.rule === rule,
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }

    // A key present but of the wrong TYPE is the same failure wearing a
    // different hat: `Guardrails`' index signature is `unknown`, so a string
    // "5000" or a null type-checks into the bag and would sail through any
    // comparison written as `total > cap`.
    for (const junk of ["5000", null, true] as unknown[]) {
      const verdict = await judgeOrder({ platform: { ...PERMISSIVE, "inbox.maxAutoOrder": junk } });
      check(
        `order: a non-numeric cap (${JSON.stringify(junk)}) DRAFTS rather than comparing against it`,
        verdict.verdict === "draft",
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
    // `!== true`, not `=== false`: none of these is permission either.
    for (const junk of ["true", 1, "yes"] as unknown[]) {
      const verdict = await judgeOrder({ platform: { ...PERMISSIVE, "inbox.orderAuto": junk } });
      check(
        `order: a truthy-but-not-true orderAuto (${JSON.stringify(junk)}) DRAFTS`,
        verdict.verdict === "draft" && verdict.rule === "guardrail:inbox_order_auto_off",
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
  }

  // [sell-3] The customer's own yes. The zod literal makes this unreachable
  //          through the tool, so this covers the replayed / hand-built payload.
  console.log("\n[sell-3] An order with no in-thread confirmation never auto-executes");
  {
    for (const value of [undefined, false, "true", 1] as unknown[]) {
      const payload = validOrder();
      if (value === undefined) delete payload.confirmedByCustomer;
      else payload.confirmedByCustomer = value;
      const verdict = await judgeOrder({}, payload);
      check(
        `confirmedByCustomer=${JSON.stringify(value)} DRAFTS — a COD parcel nobody agreed to comes back at the shop's cost`,
        verdict.verdict === "draft" && verdict.rule === "guardrail:inbox_order_needs_review",
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
  }

  // [sell-4] MONEY UNITS. The cap is WHOLE TAKA, and the boundary is driven
  //          from both sides so a ×100 slip anywhere fails here rather than at
  //          a customer's door.
  console.log("\n[sell-4] The auto-order cap is whole taka, and it is sized as an upper bound");
  {
    // 2 × ৳500 goods + the LARGER delivery charge (৳120) = ৳1,120.
    const under = await judgeOrder({});
    check("a ৳1,120 order is under the ৳5,000 cap and executes", under.verdict === "execute", `${under.verdict} / ${under.rule}`);

    // 11 × ৳500 = ৳5,500 goods + ৳120 = ৳5,620.
    const over = await judgeOrder({}, validOrder({ items: [{ productId: "prod-1", productName: "Hijab Set", qty: 11 }] }));
    check(
      "a ৳5,620 order is over it and drafts",
      over.verdict === "draft" && over.rule === "guardrail:inbox_order_over_cap",
      `${over.verdict} / ${over.rule}`,
    );
    check(
      "…and the explanation quotes taka, not poisha — a ×100 slip is visible in the sentence the founder reads",
      over.explanation.includes("৳5,620") && over.explanation.includes("৳5,000"),
      over.explanation,
    );

    // The estimate uses the LARGER of the two delivery charges rather than
    // restating dakio-api's inside/outside-Dhaka predicate. 9 × ৳500 = ৳4,500;
    // + ৳120 = ৳4,620 (under), but a 10th unit puts goods alone at ৳5,000 and
    // ANY delivery charge tips it — so this row proves delivery is counted at
    // all, which a `goods > cap` comparison would silently skip.
    const exact = await judgeOrder({}, validOrder({ items: [{ productId: "prod-1", productName: "Hijab Set", qty: 10 }] }));
    check(
      "delivery is inside the estimate — ৳5,000 of goods plus any charge is over a ৳5,000 cap",
      exact.verdict === "draft" && exact.rule === "guardrail:inbox_order_over_cap",
      `${exact.verdict} / ${exact.rule}`,
    );

    // Unpriceable ⇒ unsizeable ⇒ draft. Three separate ways to lose the price,
    // because each one is a different `null` on the way back.
    for (const [label, fixture] of [
      ["an unknown product", { product: null } as Fixture],
      ["a catalogue read that throws", { productThrows: true } as Fixture],
      ["settings that will not read", { settingsThrow: true } as Fixture],
    ] as [string, Fixture][]) {
      const verdict = await judgeOrder(fixture);
      check(
        `${label} DRAFTS rather than sizing the order at zero`,
        verdict.verdict === "draft" && verdict.rule === "guardrail:inbox_order_needs_review",
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
  }

  // [sell-5] RTO shadow. The count is RETURNED-only and must be read from the
  //          field of that name — `cancelledOrders` lumps RETURNED in with
  //          CANCELLED for risk SCORING, and reading the threshold off that
  //          would draft an order for someone who once changed their mind.
  console.log("\n[sell-5] The RTO shadow reads the returned-only count, and fails closed without it");
  {
    const risky = await judgeOrder({ risk: { ...CLEAN_RISK, rtoCount: 2, cancelledOrders: 2 } });
    check(
      "2 returned parcels at a threshold of 2 DRAFTS",
      risky.verdict === "draft" && risky.rule === "guardrail:inbox_order_needs_review",
      `${risky.verdict} / ${risky.rule}`,
    );
    check(
      "…and the founder is shown the COUNT, not a label — 'risky customer' is a judgement, '2 returned parcels' is a fact",
      risky.explanation.includes("2 returned parcel") && !/risky/i.test(risky.explanation),
      risky.explanation,
    );

    // The distinction that matters: three CANCELLED orders and zero RTOs is a
    // `level: "RISK"` customer who has never refused a parcel. The shadow
    // threshold is about parcels refused at the door, so this one still goes.
    const cancelledOnly = await judgeOrder({
      risk: { ...CLEAN_RISK, level: "RISK", rtoCount: 0, cancelledOrders: 3, cancelledOnlyCount: 3 },
    });
    check(
      "3 cancellations and no returns still EXECUTES — the shadow is about refused parcels, not changed minds",
      cancelledOnly.verdict === "execute",
      `${cancelledOnly.verdict} / ${cancelledOnly.rule}`,
    );

    for (const [label, fixture] of [
      ["a risk read that throws", { riskThrows: true } as Fixture],
      ["a risk shape with no rtoCount at all", { risk: { ...CLEAN_RISK, rtoCount: undefined as unknown as number } } as Fixture],
    ] as [string, Fixture][]) {
      const verdict = await judgeOrder(fixture);
      check(
        `${label} DRAFTS — 'cannot prove they are safe' is not 'they are safe'`,
        verdict.verdict === "draft" && verdict.rule === "guardrail:inbox_order_needs_review",
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
  }

  // [sell-6] THE FAIL-OPEN TRAP ITSELF, driven rather than described.
  console.log("\n[sell-6] The discount ceiling reads the inbox key, not the canonical trio");
  {
    // The trio's `maxDiscountPct` is 90 in this fixture and the inbox key is 15.
    // A branch reading `guardrails.maxDiscountPct` would find `undefined` in the
    // platform bag and allow a 40% discount; a branch reading the trio's real
    // value would allow it too. Only the inbox key refuses it.
    const over = await judgeDiscount({}, validDiscount({ percentOff: 40 }));
    check(
      "40% is refused against the 15% INBOX ceiling, even though the store-wide ceiling is 90%",
      over.verdict === "refuse" && over.rule === "guardrail:inbox_max_discount_pct",
      `${over.verdict} / ${over.rule}`,
    );
    check(
      "…and the refusal escalates, because it is the founder's own number that was crossed",
      over.escalation !== undefined,
      JSON.stringify(over.escalation ?? null),
    );
    const at = await judgeDiscount({}, validDiscount({ percentOff: 15 }));
    check("exactly at the ceiling still executes — the bound is inclusive", at.verdict === "execute", `${at.verdict} / ${at.rule}`);

    // Removing the trio entirely must change nothing. If it does, the branch is
    // reading the wrong object.
    const noTrio = gateClient({});
    const state = await noTrio.getAuthority();
    delete (state.guardrails as unknown as Record<string, unknown>).maxDiscountPct;
    const stillRefused = await evaluateAuthority(noTrio, {
      type: "offer_chat_discount",
      payload: validDiscount({ percentOff: 40 }),
      dutyKey: "sales.inbox_discounts",
    });
    check(
      "…and deleting the canonical trio's maxDiscountPct changes nothing — this branch never read it",
      stillRefused.verdict === "refuse" && stillRefused.rule === "guardrail:inbox_max_discount_pct",
      `${stillRefused.verdict} / ${stillRefused.rule}`,
    );

    // THE ORDERING, ON THE PLATFORM EVERY REAL TENANT ACTUALLY HAS.
    //
    // Every check above runs against PERMISSIVE, where `inbox.discountAuto` is
    // true. No shipped tenant is in that state and none can be until module 11 —
    // the key seeds false and `tierMoveDecision` refuses every move that would
    // turn it on. The ceiling clause used to sit AFTER the auto switch, so on
    // every real tenant the switch returned first and the ceiling was
    // unreachable: a 40% offer came back as an ordinary approve-me card reading
    // "Nova doesn't hand out discounts on its own", never mentioning the
    // founder's own 15% limit, and one tap issued it. The ceiling was
    // bypassable by approval, which is the same as not having one.
    const shipped = await judgeDiscount(
      { platform: { ...PERMISSIVE, "inbox.discountAuto": false } },
      validDiscount({ percentOff: 40 }),
    );
    check(
      "with discountAuto FALSE — the shipped default — 40% still REFUSES, it does not become an approvable draft",
      shipped.verdict === "refuse" && shipped.rule === "guardrail:inbox_max_discount_pct",
      `${shipped.verdict} / ${shipped.rule}`,
    );
    const underCeiling = await judgeDiscount(
      { platform: { ...PERMISSIVE, "inbox.discountAuto": false } },
      validDiscount({ percentOff: 10 }),
    );
    check(
      "…while 10% on that same shipped platform still drafts for approval, as it always did",
      underCeiling.verdict === "draft" && underCeiling.rule === "guardrail:inbox_discount_auto_off",
      `${underCeiling.verdict} / ${underCeiling.rule}`,
    );
  }

  // [sell-7] The hole the registry genuinely has: there is no taka-denominated
  //          discount ceiling anywhere, so a FIXED coupon passes every
  //          percent-based check untouched. It drafts rather than reading as
  //          allowed, and the rule name says WHY.
  console.log("\n[sell-7] A taka discount has no ceiling to check, so it never auto-issues");
  {
    for (const payload of [
      validDiscount({ mechanism: "fixed", percentOff: undefined, amount: 200 }),
      validDiscount({ mechanism: "free_delivery", percentOff: undefined }),
    ]) {
      const verdict = await judgeDiscount({}, payload);
      check(
        `mechanism '${String(payload.mechanism)}' DRAFTS with the no-ceiling rule`,
        verdict.verdict === "draft" && verdict.rule === "guardrail:inbox_discount_no_ceiling",
        `${verdict.verdict} / ${verdict.rule}`,
      );
    }
  }

  // [sell-8] The frequency guard needs something to match on. The SERVER runs
  //          the ledger lookup and 409s; this is the first line, and all it can
  //          honestly check is that the guard is answerable at all.
  console.log("\n[sell-8] A discount with nobody to attribute it to never auto-issues");
  {
    const anonymous = validDiscount({ customerId: undefined, conversationId: "" });
    const verdict = await judgeDiscount({}, anonymous);
    check(
      "no customerId and no conversationId DRAFTS — a frequency rule with nothing to match on passes every time",
      verdict.verdict === "draft" && verdict.rule === "guardrail:inbox_discount_frequency",
      `${verdict.verdict} / ${verdict.rule}`,
    );
    const threadOnly = await judgeDiscount({}, validDiscount({ customerId: undefined }));
    check(
      "…while the thread id alone is enough: a conversation is a person before the identity join has earned them a record",
      threadOnly.verdict === "execute",
      `${threadOnly.verdict} / ${threadOnly.rule}`,
    );
  }

  // [sell-9] The verbs end to end, against the demo backend. The gate above
  //          decides WHETHER; this proves the executor and its inverse actually
  //          work, and specifically that the two-map undo wiring is joined —
  //          `undoData.kind` is the ONLY bridge between nova-ai's verb-keyed
  //          `undoers` and dakio-api's kind-keyed `UNDO`, and omitting it
  //          reaches a founder pressing Undo as "No inverse is defined for
  //          undefined". That has shipped twice.
  console.log("\n[sell-9] Executors and their inverses, through the demo store");
  {
    const store = new DemoStore();
    store.seedInboxConversation({ id: "conv-sell-1" });
    const product = (await store.listProducts({ status: "active" }))[0];
    const orderPayload = {
      conversationId: "conv-sell-1",
      customerName: "Rina",
      customerPhone: "01712345678",
      customerCity: "Mirpur",
      customerDistrict: "Dhaka",
      items: [{ productId: product.id, productName: product.name, qty: 2 }],
      confirmedByCustomer: true,
    };

    const stockBefore = product.stock;
    const placed = await executors.create_order_from_chat(store, orderPayload, {
      approvedActionId: "act-sell-1",
    });
    check("create_order_from_chat: the outcome names a real order number", /Order #\d+/.test(placed.outcome), placed.outcome);
    check(
      "…and leads with what the courier collects, not with the order total",
      placed.outcome.includes("to collect on delivery"),
      placed.outcome,
    );
    check("…and the stock really moved", (await store.getProduct(product.id))!.stock === stockBefore - 2);
    check(
      "…and it claims the order's own total as revenue — a link claims none, an order does",
      placed.revenueInfluence === (placed.after as Record<string, number>).total,
      `${placed.revenueInfluence}`,
    );
    check("…and it targets the orders door", String(placed.targetRef).startsWith("order:"), String(placed.targetRef));
    check(
      "…and carries the undo kind dakio-api's runUndo dispatches on",
      placed.undoable === true && placed.undoData?.kind === "cancel_chat_order",
      JSON.stringify(placed.undoData),
    );
    check(
      "…and an inverse is registered under the VERB name, which is how check-undo-coverage matches it",
      typeof undoers.create_order_from_chat === "function",
    );

    // ONE ORDER, EVER. The same approved action id replays the same order
    // rather than sending a second parcel to the same door.
    const replay = await executors.create_order_from_chat(store, orderPayload, {
      approvedActionId: "act-sell-1",
    });
    check(
      "a replayed approve returns the SAME order — one order, ever, per novaActionId",
      replay.relatedId === placed.relatedId && (await store.listOrders()).filter((o) => o.id === placed.relatedId).length === 1,
      `${replay.relatedId} vs ${placed.relatedId}`,
    );
    check("…and the replay did not decrement stock twice", (await store.getProduct(product.id))!.stock === stockBefore - 2);

    const undone = await undoers.create_order_from_chat!(store, placed.undoData!);
    check(
      "undo CANCELS the order rather than deleting it — an order is a financial record",
      (await store.getOrder(String(placed.relatedId)))!.status === "cancelled" && /Cancelled order/.test(undone),
      undone,
    );
    check("…and the sentence says the customer has to be told", /customer must be told/i.test(undone), undone);

    // Free delivery: the model sends no amount, the executor resolves it.
    const offered = await executors.offer_chat_discount(
      store,
      {
        conversationId: "conv-sell-1",
        mechanism: "free_delivery",
        expiresHours: 48,
        reason: "second ask on a full-price cart",
      },
      { approvedActionId: "act-sell-2" },
    );
    const code = String((offered.after as Record<string, unknown>).code);
    const coupon = (await store.listDiscounts()).find((d) => d.code === code)!;
    check("offer_chat_discount: the code is upper-case, which is the only form any redemption path matches", code === code.toUpperCase());
    check(
      "…and free delivery resolved to the shop's own charge, not to a number the model chose",
      coupon.type === "FIXED" && coupon.amount === (await store.getStoreSettings()).deliveryOutsideDhaka,
      `${coupon.type} ${coupon.amount}`,
    );
    check("…one use only — a chat coupon everyone can use is a public discount", coupon.maxUses === 1);
    check("…and it carries the receipt that explains it", typeof coupon.novaActionId === "string" && coupon.novaActionId.length > 0);
    check(
      "…and claims NO revenue — the order it may close is credited to the order",
      offered.revenueInfluence === 0,
      `${offered.revenueInfluence}`,
    );
    check(
      "…and carries its own undo kind",
      offered.undoable === true && offered.undoData?.kind === "deactivate_chat_discount",
      JSON.stringify(offered.undoData),
    );
    // The FIELD NAME, not just the kind — and it is pinned separately because it
    // shipped wrong: this executor first emitted `discountId` (this repo's word
    // for the row) while dakio-api's `UNDO.deactivate_chat_discount` destructures
    // `{ couponId }` and throws `undoData.couponId is required` on anything else.
    // The kind matched, both undo maps existed, `check:undo` passed, tsc passed —
    // and a founder pressing Undo on the Decision Desk would have been told the
    // coupon id was missing. `undoData` is a WIRE payload read by the OTHER repo,
    // so the other repo's field names are the contract. Same for the order below.
    check(
      "…under the field name dakio-api's UNDO map destructures — `couponId`, not this repo's `discountId`",
      typeof (offered.undoData as Record<string, unknown>).couponId === "string" &&
        (offered.undoData as Record<string, unknown>).discountId === undefined,
      JSON.stringify(offered.undoData),
    );
    check(
      "…and the order's undoData names `orderId`/`orderNumber`, which is what UNDO.cancel_chat_order takes",
      typeof (placed.undoData as Record<string, unknown>).orderId === "string" &&
        typeof (placed.undoData as Record<string, unknown>).orderNumber === "string",
      JSON.stringify(placed.undoData),
    );
    const validBefore = await store.validateCoupon(code, 900);
    check("the issued code actually validates against a cart", validBefore.valid && validBefore.discount === coupon.amount, JSON.stringify(validBefore));

    await undoers.offer_chat_discount!(store, offered.undoData!);
    const validAfter = await store.validateCoupon(code, 900);
    check(
      "undo DEACTIVATES it — the row stays, because a discount somebody already used really happened",
      validAfter.valid === false && validAfter.reason === "inactive",
      JSON.stringify(validAfter),
    );

    // The claim verb writes nothing, and must never read as though it did.
    const filed = await executors.verify_payment_slip(store, {
      conversationId: "conv-sell-1",
      method: "bkash",
      trxId: "8AK3XXXXXX",
      claimedAmount: 2350,
      customerStatement: "bKash e pathaisi bhai",
    });
    check("verify_payment_slip: the outcome says the word CLAIM", filed.outcome.includes("CLAIM"), filed.outcome);
    check("…and says outright that nothing was verified", /Nothing was verified/.test(filed.outcome), filed.outcome);
    check(
      "…and never says the payment was received or confirmed",
      !/payment received|payment confirmed|money received/i.test(filed.outcome),
      filed.outcome,
    );
    check("…and records the claim as unverified on the receipt", (filed.after as Record<string, unknown>).verified === false);
    check(
      "…and is irreversible with no inverse, because it changed nothing to reverse",
      filed.undoable === false && filed.undoData === null && undoers.verify_payment_slip === undefined,
    );
    check("…and claims no revenue for money nobody has received", filed.revenueInfluence === 0, `${filed.revenueInfluence}`);
    check(
      "…and does not stamp the order door — a by:nova chip on that sale would claim Nova touched it",
      String(filed.targetRef).startsWith("inbox_conversation:"),
      String(filed.targetRef),
    );
  }

  return { passed, failures };
}

async function main(): Promise<void> {
  console.log("Nova inbox — selling guardrails, fail-closed (module 05 D5/D6)");
  const result = await runSellingGuardrailSuite();

  console.log(`\n${"=".repeat(60)}`);
  if (result.failures.length === 0) {
    console.log(`INBOX SELLING GUARDRAILS PASSED — ${result.passed} checks green.`);
  } else {
    console.log(
      `INBOX SELLING GUARDRAILS FAILED — ${result.failures.length} of ${result.passed + result.failures.length} checks failed:`,
    );
    for (const f of result.failures) console.log(`  ✗ ${f}`);
  }
  process.exit(result.failures.length === 0 ? 0 : 1);
}

// Self-running when invoked directly, inert when imported — the same shape as
// `c360.ts` / `promises.ts` / `identity.ts`, so the inbox runner can call
// `runSellingGuardrailSuite()` without the import exiting the process out from
// under it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Inbox selling guardrails crashed:", err);
    process.exit(1);
  });
}
