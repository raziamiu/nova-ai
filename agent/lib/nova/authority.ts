/**
 * The authority seam (PRD §4 Authority, §5) — ONE server-side place that
 * decides what Nova may do.
 *
 * Every action Nova attempts is judged here: founder-only verb → no-touch lock
 * → duty → mode → level → guardrails. **First refusal wins**, and every verdict
 * names the exact rule that produced it, because "Nova refused" is useless to a
 * founder and "Nova refused: no_touch:saree pricing" is actionable.
 *
 * Three rules this module exists to make unbreakable:
 *
 *  1. **Model output can propose, never authorize.** Nothing here reads model
 *     text as permission. Locks and duty names are DATA — they are matched
 *     against, never interpreted as instructions.
 *  2. **Fail closed.** Any lookup that errors or returns something unexpected
 *     refuses. A gate that fails open is not a gate.
 *  3. **Ambiguity resolves toward refusal.** A false freeze costs the founder a
 *     tap; a false pass breaks a promise they made to themselves.
 *
 * There is deliberately no second gate: `checkGuardrails` from `autonomy.ts` is
 * called from inside this seam as the platform superset, not alongside it.
 */

import type {
  ActionType,
  AuthorityDecision,
  AuthorityState,
  AutonomyLevel,
  NovaMode,
  RiskClass,
} from "../types";
import type { StoreClient } from "../store/client";
import { RISK_CLASS, checkGuardrailsForAuthority } from "./autonomy";
import { DUTY_BY_KEY } from "../duties";

/**
 * §5.4 — verbs the founder must perform personally. These are propose-only at
 * EVERY level including L4, on every path. This is a classification of the act,
 * not a check on the caller's role: raising autonomy must never turn a
 * founder-only verb into something Nova can do alone.
 */
export const FOUNDER_ONLY: ReadonlySet<string> = new Set([
  "bulk_refund",
  "guardrail_edit",
  "promotion_accept",
  "contract_sign",
]);

/**
 * Per-verb extractor for the text a no-touch lock is matched against.
 *
 * Registering a verb here is how it becomes lockable. A verb with NO extractor
 * is treated as unlockable-and-therefore-suspicious: `targetTextFor` returns
 * null and the matcher refuses rather than silently letting the action past
 * every lock the founder set. §16.3's CI check owns keeping this table complete.
 */
type Extractor = (payload: Record<string, unknown>) => string;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export const TARGET_TEXT: Partial<Record<ActionType | string, Extractor>> = {
  update_price: (p) => [str(p.productId), str(p.productName), "price", "pricing"].join(" "),
  create_discount: (p) => [str(p.code), str(p.productIds), "discount", "price", "pricing"].join(" "),
  create_campaign: (p) => [str(p.name), str(p.channel), str(p.productIds), "campaign"].join(" "),
  update_campaign: (p) => [str(p.campaignId), str(p.name), str(p.note), "campaign", "budget"].join(" "),
  publish_social_post: (p) => [str(p.caption), str(p.platform), str(p.productIds), "post", "social"].join(" "),
  send_customer_message: (p) => [str(p.subject), str(p.body), str(p.purpose), "message"].join(" "),
  resolve_ticket: (p) => [str(p.reply), str(p.ticketId), "ticket", "support"].join(" "),
  create_purchase_order: (p) => [str(p.supplierId), str(p.productId), "purchase", "supplier"].join(" "),
  switch_supplier: (p) => [str(p.productId), str(p.newSupplierId), "supplier"].join(" "),
  assign_courier: (p) => [str(p.orderId), str(p.courierId), "courier", "delivery", "shipping"].join(" "),
  import_product: (p) => [str(p.trendingProductId), str(p.price), "product", "import"].join(" "),
  bulk_refund: (p) => [str(p.orderIds), str(p.reason), "refund"].join(" "),
};

/**
 * Per-verb extractor for money this action would COMMIT today, in ৳ minor
 * units. Only verbs that actually spend register here; everything else
 * contributes zero to the cumulative daily cap.
 */
export const SPEND_MINOR: Partial<Record<ActionType | string, (p: Record<string, unknown>) => number>> = {
  // A campaign commits its daily budget for today.
  create_campaign: (p) => Math.round(Number(p.dailyBudget ?? 0) * 100),
  // Only an INCREASE counts; lowering a budget spends nothing.
  update_campaign: (p) => {
    const next = Number(p.dailyBudget ?? 0);
    const prev = Number(p.previousDailyBudget ?? 0);
    return Math.max(0, Math.round((next - prev) * 100));
  },
  create_purchase_order: (p) => Math.round(Number(p.quantity ?? 0) * Number(p.unitCost ?? 0) * 100),
};

/* ── no-touch matching ─────────────────────────────────────────────────── */

/**
 * Normalize for comparison: NFC (so composed and decomposed Bangla compare
 * equal), lowercased, punctuation flattened to spaces.
 *
 * NFC matters here specifically — Bangla text arrives in both composed and
 * decomposed forms depending on the keyboard, and a lock typed one way must
 * still match text stored the other way.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Tokens worth matching on. One-character noise is dropped, digits kept. */
function significantTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .filter((t) => t.length > 1);
}

/**
 * A lock matches when EVERY significant token in the lock appears in the
 * target text. Conservative on purpose: "SAREE PRICING" must not fire on every
 * saree action, only on ones that are also about price.
 */
export function lockMatches(lock: string, targetText: string): boolean {
  const lockTokens = significantTokens(lock);
  if (lockTokens.length === 0) return false;
  const haystack = ` ${normalizeForMatch(targetText)} `;
  return lockTokens.every((t) => haystack.includes(` ${t} `) || haystack.includes(t));
}

/** The text a lock is matched against, or null if this verb has no extractor. */
export function targetTextFor(type: string, payload: Record<string, unknown>): string | null {
  const extract = TARGET_TEXT[type];
  if (!extract) return null;
  try {
    return extract(payload);
  } catch {
    return null;
  }
}

/* ── mode + level resolution ───────────────────────────────────────────── */

/** door:<module> beats store, store beats the assisted default. */
export function resolveMode(modes: Record<string, NovaMode>, doorModule: string | null): NovaMode {
  if (doorModule && modes[`door:${doorModule}`]) return modes[`door:${doorModule}`];
  return modes.store ?? "assisted";
}

const MODE_CEILING: Record<NovaMode, AutonomyLevel> = {
  // manual can still recommend — that is L1, "Suggest".
  manual: 1,
  // assisted can prepare a full draft — that is L2, "Draft".
  assisted: 2,
  // autonomous imposes no ceiling of its own.
  autonomous: 4,
};

/** Effective capability is min(mode, level, earnedLevel) — never a max. */
export function effectiveLevel(state: AuthorityState, doorModule: string | null): AutonomyLevel {
  const mode = resolveMode(state.modes, doorModule);
  return Math.min(state.level, state.earnedLevel, MODE_CEILING[mode]) as AutonomyLevel;
}

/** What a given level does with an otherwise-permitted action. */
function verdictForLevel(level: AutonomyLevel, riskClass: RiskClass): AuthorityVerdictish {
  if (level <= 0) return { verdict: "refuse", rule: "level:observe_only" };
  if (level === 1) return { verdict: "suggest", rule: "level:suggest" };
  if (level === 2) return { verdict: "draft", rule: "level:draft" };
  if (level === 3) return riskClass === "low" ? { verdict: "execute", rule: "level:operator" } : { verdict: "draft", rule: "level:operator_needs_approval" };
  return { verdict: "execute", rule: "level:acting_ceo" };
}

type AuthorityVerdictish = { verdict: AuthorityDecision["verdict"]; rule: string };

/* ── the seam ──────────────────────────────────────────────────────────── */

export interface AuthorityRequest {
  type: ActionType | string;
  payload: Record<string, unknown>;
  /** E-5 duty this action is performed under. Unknown keys fail closed. */
  dutyKey?: string;
  /** "chat" | "job" | "founder" — recorded, never trusted for permission. */
  origin?: string;
}

const bn = (en: string, bnText: string): [string, string] => [en, bnText];

function decide(
  verdict: AuthorityDecision["verdict"],
  rule: string,
  [explanation, explanationBn]: [string, string],
  riskClass: RiskClass,
  guardrailsVersion: number,
  escalate = false,
): AuthorityDecision {
  return {
    verdict,
    riskClass,
    rule,
    explanation,
    explanationBn,
    guardrailsVersion,
    ...(escalate
      ? { escalation: { reason: explanation, rule, raisedAt: new Date().toISOString() } }
      : {}),
  };
}

/**
 * Judge one action. Order is fixed and the first refusal wins, so that the
 * rule a founder sees is the FIRST reason their instruction was honoured —
 * not whichever check happened to run last.
 */
export async function evaluateAuthority(
  client: StoreClient,
  request: AuthorityRequest,
): Promise<AuthorityDecision> {
  const riskClass: RiskClass = RISK_CLASS[request.type as ActionType] ?? "high";

  // Fail closed: if we cannot read the authority state, we do not act.
  let state: AuthorityState;
  try {
    state = await client.getAuthority();
  } catch (error) {
    return decide(
      "refuse",
      "authority:unavailable",
      bn(
        `Nova could not read this store's authority settings, so it did nothing. (${String(error)})`,
        "নোভা এই স্টোরের অনুমতি সেটিংস পড়তে পারেনি, তাই কিছু করেনি।",
      ),
      riskClass,
      0,
      true,
    );
  }
  const gv = state.guardrails.version;

  // 1. Founder-only verbs — propose-only at every level, including L4.
  if (FOUNDER_ONLY.has(request.type)) {
    return decide(
      "refuse",
      `founder_only:${request.type}`,
      bn(
        `"${request.type}" is yours to do, not Nova's — it stays a proposal at every autonomy level, including Acting CEO.`,
        `"${request.type}" শুধু আপনি করতে পারেন — নোভা যেকোনো অটোনমি লেভেলে এটি কেবল প্রস্তাব হিসেবে রাখে।`,
      ),
      riskClass,
      gv,
      true,
    );
  }

  // 2. No-touch locks.
  const locks = Array.isArray(state.guardrails.noTouch) ? state.guardrails.noTouch : [];
  if (locks.length > 0) {
    const targetText = targetTextFor(request.type, request.payload);
    if (targetText === null) {
      // Unlockable verb while locks exist → refuse. We cannot prove the action
      // is outside the founder's locks, and guessing is how a lock gets evaded.
      return decide(
        "refuse",
        "no_touch:unverifiable",
        bn(
          `Nova can't check "${request.type}" against your no-touch locks, so it stopped rather than risk crossing one.`,
          `নোভা "${request.type}"-কে আপনার নো-টাচ লকের সাথে মেলাতে পারেনি, তাই ঝুঁকি না নিয়ে থেমে গেছে।`,
        ),
        riskClass,
        gv,
        true,
      );
    }
    const hit = locks.find((lock) => lockMatches(lock, targetText));
    if (hit) {
      return decide(
        "refuse",
        `no_touch:${hit.toLowerCase()}`,
        bn(
          `You locked "${hit}". Nova left it alone.`,
          `আপনি "${hit}" লক করে রেখেছেন। নোভা এতে হাত দেয়নি।`,
        ),
        riskClass,
        gv,
        true,
      );
    }
  }

  // 3. Duty — is this something Nova claims to do, is it on, and is the level enough?
  let doorModule: string | null = null;
  if (request.dutyKey) {
    const spec = DUTY_BY_KEY.get(request.dutyKey);
    const duty = state.duties[request.dutyKey];
    if (!spec) {
      return decide(
        "refuse",
        "duty:unknown",
        bn(
          `"${request.dutyKey}" isn't a duty on Nova's roster, so Nova didn't act on it.`,
          `"${request.dutyKey}" নোভার দায়িত্ব তালিকায় নেই, তাই নোভা এতে কাজ করেনি।`,
        ),
        riskClass,
        gv,
        true,
      );
    }
    doorModule = spec.door;
    if (duty && duty.enabled === false) {
      return decide(
        "refuse",
        "duty:paused",
        bn(
          `You paused "${spec.name}", so Nova skipped it.`,
          `আপনি "${spec.name}" বন্ধ রেখেছেন, তাই নোভা এটি বাদ দিয়েছে।`,
        ),
        riskClass,
        gv,
      );
    }
    if (duty && duty.doorExists === false) {
      return decide(
        "refuse",
        "duty:needs_door",
        bn(
          `"${spec.name}" has nowhere to land yet — its screen isn't built, so Nova didn't start work it couldn't show you.`,
          `"${spec.name}"-এর জন্য এখনো কোনো পর্দা তৈরি হয়নি, তাই নোভা এমন কাজ শুরু করেনি যা আপনাকে দেখাতে পারবে না।`,
        ),
        riskClass,
        gv,
      );
    }
  }

  // 4 + 5. Mode ceiling and level semantics, composed as min(mode, level).
  const level = effectiveLevel(state, doorModule);
  const mode = resolveMode(state.modes, doorModule);
  const levelCall = verdictForLevel(level, riskClass);

  if (levelCall.verdict === "refuse") {
    return decide(
      "refuse",
      levelCall.rule,
      bn(
        "Nova is set to observe only, so it reported this instead of doing it.",
        "নোভা কেবল পর্যবেক্ষণে সেট করা আছে, তাই এটি না করে জানিয়েছে।",
      ),
      riskClass,
      gv,
    );
  }

  if (request.dutyKey) {
    const spec = DUTY_BY_KEY.get(request.dutyKey)!;
    if (spec.minLevel > level) {
      return decide(
        "refuse",
        "duty:min_level",
        bn(
          `"${spec.name}" needs autonomy level ${spec.minLevel}; Nova is effectively at ${level}${mode !== "autonomous" ? ` (${mode} mode)` : ""}.`,
          `"${spec.name}"-এর জন্য অটোনমি লেভেল ${spec.minLevel} দরকার; নোভা এখন কার্যত ${level}-এ আছে।`,
        ),
        riskClass,
        gv,
      );
    }
  }

  // 6. Guardrails — the canonical trio, then the platform superset.
  if (request.type === "create_discount") {
    const pct = Number(request.payload.percentOff ?? 0);
    if (pct > state.guardrails.maxDiscountPct) {
      return decide(
        "refuse",
        "guardrail:max_discount_pct",
        bn(
          `A ${pct}% discount is over your ${state.guardrails.maxDiscountPct}% limit, so Nova didn't create it.`,
          `${pct}% ছাড় আপনার ${state.guardrails.maxDiscountPct}% সীমার বেশি, তাই নোভা এটি তৈরি করেনি।`,
        ),
        riskClass,
        gv,
        true,
      );
    }
  }

  // Cumulative daily spend: today's executed spend PLUS what this would commit.
  const spendFn = SPEND_MINOR[request.type];
  if (spendFn) {
    const requested = Math.max(0, spendFn(request.payload) || 0);
    const projected = state.spentTodayMinor + requested;
    if (requested > 0 && projected > state.guardrails.dailySpendCapMinor) {
      const taka = (m: number): string => `৳${Math.round(m / 100).toLocaleString("en-IN")}`;
      // Deliberately a DOWNGRADE, not a block: the spend is legitimate, it just
      // exceeds what Nova may commit alone. The founder decides.
      return decide(
        "draft",
        "guardrail:daily_spend_cap",
        bn(
          `This would take today's spend to ${taka(projected)}, past your ${taka(state.guardrails.dailySpendCapMinor)}/day cap, so Nova prepared it for you to approve instead of spending it.`,
          `এতে আজকের খরচ ${taka(projected)} হয়ে যেত, যা আপনার দৈনিক ${taka(state.guardrails.dailySpendCapMinor)} সীমার বেশি — তাই নোভা খরচ না করে আপনার অনুমোদনের জন্য প্রস্তুত করেছে।`,
        ),
        riskClass,
        gv,
      );
    }
  }

  // Platform superset — the six shipped numeric caps, same seam, evaluated last.
  const platform = await checkGuardrailsForAuthority(client, state.guardrails.platform, request.type as ActionType, request.payload);
  if (platform.result === "block") {
    return decide(
      "refuse",
      `guardrail:${platform.rule}`,
      bn(platform.why, platform.whyBn ?? platform.why),
      riskClass,
      gv,
      true,
    );
  }
  if (platform.result === "needs_approval") {
    return decide("draft", `guardrail:${platform.rule}`, bn(platform.why, platform.whyBn ?? platform.why), riskClass, gv);
  }

  // Nothing objected.
  return decide(
    levelCall.verdict,
    levelCall.rule,
    bn(
      `Within autonomy level ${level}${mode !== "autonomous" ? ` (${mode} mode)` : ""} and all guardrails.`,
      `অটোনমি লেভেল ${level} এবং সব গার্ডরেলের মধ্যে।`,
    ),
    riskClass,
    gv,
  );
}
