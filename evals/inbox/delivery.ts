/**
 * Stage 10 module 06 — the delivery guardrails, fail-closed.
 *
 * `evals/inbox/run.ts`'s `INBOX_AUTO_GATED` loop proves that a registered
 * `inbox.*`-gated verb drafts on an EMPTY platform. That is the floor, and it is
 * the check that caught `update_order_contact` shipping as an unconditional
 * allow. This suite proves what the floor cannot see: that each verb denies for
 * the RIGHT reason on a platform where every other key is present and
 * permissive, that `flag_courier_issue` is unreachable-by-autonomy rather than
 * merely gated, and that the pre-dispatch fence holds.
 *
 * The distinction matters for the same reason it did in module 05: a branch that
 * reads the WRONG key name still returns `needs_approval` on an empty platform,
 * because the FIRST check fails and the later ones never run. Only deleting one
 * key at a time from an otherwise-allowing platform reaches them.
 *
 * WIRING: exports {@link runDeliverySuite} and self-runs when invoked directly —
 * the same shape as `selling.ts`, so `run.ts` folds its counts in without the
 * import exiting the process.
 *
 * Run:  npx -y tsx evals/inbox/delivery.ts
 */

import { pathToFileURL } from "node:url";

import { evaluateAuthority, ALWAYS_DRAFT, NEVER_GATED } from "../../agent/lib/nova/authority";
import { RISK_CLASS } from "../../agent/lib/nova/autonomy";
import { MINUTES_BY_ACTION } from "../../agent/lib/nova/activity";
import { executors, undoers } from "../../agent/lib/nova/executors";
import { DUTIES } from "../../agent/lib/duties";
import { DemoStore } from "../../agent/lib/store/backend";
import { InboxSendRefused } from "../../agent/lib/store/client";
import type { StoreClient } from "../../agent/lib/store/client";
import type {
  ActionType,
  AuthorityState,
  AutonomyLevel,
  DutyState,
  NovaGuardrailsV2,
  NovaMode,
} from "../../agent/lib/types";

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

/** Every key module 06's branches read, all permissive. The baseline must ALLOW. */
const PERMISSIVE: Record<string, unknown> = {
  "inbox.cancelAuto": true,
  "inbox.addressEditAuto": true,
  "case.expiryDays": 14,
};

const without = (key: string): Record<string, unknown> => {
  const bag = { ...PERMISSIVE };
  delete bag[key];
  return bag;
};

/**
 * NOT cast through `unknown`. The first draft of this fixture was
 * `{ autonomyLevel, modes: [...], duties: [...] } as unknown as AuthorityState`,
 * and every one of those three was wrong — the field is `level`, and both maps
 * are Records keyed by scope and duty key rather than arrays. The cast made tsc
 * agree anyway, so the `level: 1` case silently evaluated at level 4 and the
 * check passed for the wrong reason until it did not.
 */
function gateClient(over: { level?: AutonomyLevel; platform?: Record<string, unknown> } = {}): StoreClient {
  const duties: Record<string, DutyState> = {};
  for (const d of DUTIES) duties[d.key] = { enabled: true, doorExists: true } as DutyState;
  const state: AuthorityState = {
    level: over.level ?? 4,
    earnedLevel: 4,
    modes: { store: "autonomous" as NovaMode },
    guardrails: {
      version: 1,
      maxDiscountPct: 90,
      dailySpendCapMinor: 10_000_000,
      noTouch: [],
      // `platform` is typed as the full `Guardrails` while at runtime it is only
      // the flat `inbox.*`/`case.*` bag — the very mismatch that makes
      // `guardrails.maxDiscountPct` compile and read `undefined` inside
      // `checkGuardrails`. The cast is here rather than over the whole object so
      // the fields that ARE real above stay type-checked.
      platform: (over.platform ?? PERMISSIVE) as unknown as NovaGuardrailsV2["platform"],
    },
    duties,
    spentTodayMinor: 0,
  };
  const demo = new DemoStore();
  return { ...demo, getAuthority: async () => state } as unknown as StoreClient;
}

const judge = (
  type: ActionType,
  payload: Record<string, unknown>,
  over: { level?: AutonomyLevel; platform?: Record<string, unknown> } = {},
) =>
  evaluateAuthority(gateClient(over), { type, payload, dutyKey: "shipping.delivery_cases" });

const CANCEL = { orderId: "ord-1", conversationId: "conv-1", reason: "changed their mind" };
const CONTACT = { orderId: "ord-1", conversationId: "conv-1", address: "House 12, Road 4, Banani" };

export async function runDeliverySuite(): Promise<{ passed: number; failures: string[] }> {
  console.log("\n[del-1] The baseline ALLOWS — every row below is meaningless if it does not");
  {
    // Load-bearing exactly as in the selling suite: if `allow` stops being
    // reachable, every "missing key denies" check passes for the wrong reason.
    const cancel = await judge("cancel_order_from_chat", CANCEL);
    check("a fully permissive platform lets a cancel execute", cancel.verdict === "execute", `${cancel.verdict} / ${cancel.rule}`);
    const contact = await judge("update_order_contact", CONTACT);
    check("…and an address fix too", contact.verdict === "execute", `${contact.verdict} / ${contact.rule}`);
  }

  console.log("\n[del-2] Every key each branch reads DENIES when it is missing");
  {
    const rows: [ActionType, Record<string, unknown>, string, string][] = [
      ["cancel_order_from_chat", CANCEL, "inbox.cancelAuto", "guardrail:inbox_cancel_auto_off"],
      ["update_order_contact", CONTACT, "inbox.addressEditAuto", "guardrail:inbox_address_edit_auto_off"],
    ];
    for (const [verb, payload, key, rule] of rows) {
      const v = await judge(verb, payload, { platform: without(key) });
      check(`${verb}: a missing ${key} DRAFTS (${rule})`, v.verdict === "draft" && v.rule === rule, `${v.verdict} / ${v.rule}`);
    }
    // `!== true`, never `=== false`: none of these is permission either.
    for (const junk of ["true", 1, "yes", null] as unknown[]) {
      const v = await judge("cancel_order_from_chat", CANCEL, {
        platform: { ...PERMISSIVE, "inbox.cancelAuto": junk },
      });
      check(
        `cancel: a truthy-but-not-true cancelAuto (${JSON.stringify(junk)}) DRAFTS`,
        v.verdict === "draft" && v.rule === "guardrail:inbox_cancel_auto_off",
        `${v.verdict} / ${v.rule}`,
      );
    }
  }

  console.log("\n[del-3] update_order_contact is GATED — the check that caught this one");
  {
    // It first shipped as an unconditional `allow`, reasoning that the server
    // already refuses a change once the parcel is with the courier and that a
    // pre-dispatch correction is only the customer fixing details they just
    // gave. Both true, and both beside the point: the address is where a COD
    // parcel worth real money goes, and "whoever is typing in this thread" is
    // not the same claim as "the person who placed the order".
    const v = await judge("update_order_contact", CONTACT, { platform: {} });
    check(
      "an EMPTY platform drafts an address change at the TOP of the dial — a redirect is a fraud shape, not only a typo fix",
      v.verdict === "draft",
      `${v.verdict} / ${v.rule}`,
    );
  }

  console.log("\n[del-4] flag_courier_issue is ALWAYS_DRAFT, not merely gated");
  {
    check("it is in ALWAYS_DRAFT", ALWAYS_DRAFT.has("flag_courier_issue"));
    // The mechanism matters, not just the outcome. A guardrail-arm
    // needs_approval is only as permanent as a platform bag, and `riskClass`
    // cannot express it at all — `verdictForLevel` executes every risk class at
    // level 4, and level 4 is reachable on a good trust record.
    const v = await evaluateAuthority(gateClient({ level: 4 }), {
      type: "flag_courier_issue",
      payload: { caseId: "case-1", orderId: "ord-1", courierType: "steadfast", trackingId: "T1", reason: "no scan since Tuesday", recommendation: "ask for a redelivery" },
      dutyKey: "shipping.delivery_cases",
    });
    check(
      "…so it DRAFTS at the very top of the dial, where riskClass alone would have executed",
      v.verdict === "draft",
      `${v.verdict} / ${v.rule}`,
    );
    check("and it is low risk, because it changes nothing", RISK_CLASS.flag_courier_issue === "low");
  }

  console.log("\n[del-5] open_case did NOT join NEVER_GATED, and that set is still two");
  {
    // The module doc asks for a carve-out that does not exist. The only
    // mechanism is NEVER_GATED, which bypasses the dial AND every numeric
    // guardrail, and whose stated bar is "cannot spend, send, or choose".
    // `open_case` enqueues department work whose last step speaks to a customer
    // — the same argument already made for `schedule_follow_up` and rejected.
    check(
      "NEVER_GATED still has exactly two members after module 06",
      NEVER_GATED.size === 2 && !NEVER_GATED.has("open_case") && !NEVER_GATED.has("flag_courier_issue"),
      [...NEVER_GATED].join(", "),
    );
    // The T0 story survives because SERVER-opened cases never reach this gate at
    // all — a courier webhook and the stagnation sweep open them with no model
    // in the loop. Only Nova ASKING is gated.
    const v = await judge("open_case", {
      kind: "delivery_stuck", conversationId: "conv-1", orderId: "ord-1",
      title: "Order stuck 5 days", factsNote: "customer says no scan",
    }, { level: 1 });
    check(
      "at the bottom of the dial, Nova ASKING to open a case is gated like any other verb",
      v.verdict !== "execute",
      `${v.verdict} / ${v.rule}`,
    );
  }

  console.log("\n[del-6] Registration completeness — the table module 05's verbs never got");
  {
    const VERBS: ActionType[] = [
      "open_case", "flag_courier_issue", "confirm_order_intent",
      "update_order_contact", "cancel_order_from_chat",
    ];
    for (const verb of VERBS) {
      check(`${verb}: RISK_CLASS entry`, typeof RISK_CLASS[verb] === "string", String(RISK_CLASS[verb]));
      check(`${verb}: executor registered`, typeof executors[verb] === "function");
      check(
        `${verb}: MINUTES_BY_ACTION entry (TS-forced, but the NUMBER is a claim about the founder's day)`,
        typeof MINUTES_BY_ACTION[verb] === "number",
      );
    }
    // Only one of the five has an inverse, and the four without are deliberate:
    // a case is closed with a resolution rather than deleted, a proposal changes
    // nothing to reverse, `confirmedAt` records that a human said yes, and the
    // old address is one the customer has already said is wrong.
    check("only cancel_order_from_chat is undoable", typeof undoers.cancel_order_from_chat === "function");
    for (const verb of ["open_case", "flag_courier_issue", "confirm_order_intent", "update_order_contact"] as const) {
      check(`${verb} has NO inverse, deliberately`, undoers[verb] === undefined);
    }
  }

  console.log("\n[del-7] The pre-dispatch fence, through the demo backend");
  {
    const demo = new DemoStore();
    const orders = await demo.listOrders();
    const dispatched = orders.find((o) => o.status === "fulfilled" || o.status === "delivered");
    if (dispatched) {
      let refused: unknown = null;
      try {
        await demo.updateOrderDelivery(dispatched.id, { address: "somewhere else" });
      } catch (e) {
        refused = e;
      }
      check(
        "an address change on a dispatched parcel is REFUSED — after handover the label is the courier's",
        refused instanceof InboxSendRefused,
        String(refused),
      );
    } else {
      check("the demo seed has a dispatched order to fence against", false, "no fulfilled/delivered order in the seed");
    }
  }

  console.log("\n[del-8] One parcel, one case — the join, through the demo backend");
  {
    const demo = new DemoStore();
    const base = { kind: "delivery_stuck", orderId: "ord-shared", title: "stuck" };
    const a = await demo.openCase({ ...base, conversationId: "conv-fb" });
    const b = await demo.openCase({ ...base, conversationId: "conv-ig" });
    check("the second asker JOINS rather than opening a duplicate", b.joined === true && b.case.id === a.case.id);
    check(
      "…and BOTH threads are recorded, because the loop-closer fans out over that list",
      (b.case.refs.conversationIds ?? []).length === 2,
      JSON.stringify(b.case.refs.conversationIds),
    );
    check("the department is derived from the kind, never sent by the caller", a.case.department === "shipping");

    // Closing releases the key, which is what lets the same order have another
    // case later. Modelled for real in the demo because every check above rests
    // on it.
    await demo.patchCase(a.case.id, { status: "resolved", resolution: "Courier delivered it." });
    const c = await demo.openCase({ ...base, conversationId: "conv-fb" });
    check("a closed case releases its key, so a NEW problem on that order is a new case", c.joined === false);
  }

  console.log("\n[del-9] Facts are append-only, and a closed case does not reopen");
  {
    const demo = new DemoStore();
    const { case: c } = await demo.openCase({
      kind: "damaged_item", conversationId: "conv-1", title: "cracked", factsNote: "photo attached",
    });
    await demo.patchCase(c.id, { appendFacts: [{ source: "founder", note: "offered a replacement" }] });
    const after = await demo.getCase(c.id);
    check("both facts survive", (after?.facts.length ?? 0) === 2);

    await demo.patchCase(c.id, { status: "resolved", resolution: "Replacement shipped." });
    let refused: unknown = null;
    try {
      await demo.patchCase(c.id, { status: "open" });
    } catch (e) {
      refused = e;
    }
    check(
      "a resolved case refuses to reopen — its key was released and another case may hold it now",
      refused instanceof InboxSendRefused,
      String(refused),
    );
  }

  return { passed, failures };
}

async function main(): Promise<void> {
  console.log("Nova inbox — delivery guardrails, fail-closed (module 06)");
  const result = await runDeliverySuite();
  console.log(`\n${"=".repeat(60)}`);
  if (result.failures.length === 0) {
    console.log(`INBOX DELIVERY GUARDRAILS PASSED — ${result.passed} checks green.`);
  } else {
    console.log(
      `INBOX DELIVERY GUARDRAILS FAILED — ${result.failures.length} of ${result.passed + result.failures.length} checks failed:`,
    );
    for (const f of result.failures) console.log(`  ✗ ${f}`);
  }
  process.exit(result.failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Inbox delivery guardrails crashed:", err);
    process.exit(1);
  });
}
