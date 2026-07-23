/**
 * Voice script assembly + the confirmation-phrase gate (Stage 7 "Presence",
 * FR-9.1/§14 NFR) — deterministic, no model on the call critical path.
 *
 * Scripts are RENDERED from rows (brief, decisions, a watchdog finding) so a
 * call is fast and grounded, not improvised live. The confirmation-phrase parser
 * is the hard gate on voice approvals: an approval only lands if the founder said
 * an explicit "confirm approve <name>" (or the Bangla equivalent) in the
 * transcript — ambiguity fails SAFE (the decision stays queued). Money is spoken,
 * not shown, so ৳ is formatted for speech.
 */

export type VoiceLang = "en" | "bn";

/** ৳ minor units → a spoken amount. "৳48,200" reads as "48,200 taka" / "৪৮,২০০ টাকা". */
export function formatTakaSpeech(minor: number, lang: VoiceLang = "en"): string {
  const whole = Math.round((Number(minor) || 0) / 100);
  const grouped = whole.toLocaleString("en-US");
  if (lang === "bn") {
    const bnDigits = grouped.replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
    return `${bnDigits} টাকা`;
  }
  return `${grouped} taka`;
}

export interface ScriptDecision {
  id: string;
  title: string;
  impactLabel?: string;
}

export interface CallScript {
  lang: VoiceLang;
  /** Ordered spoken segments. */
  segments: string[];
  /** Verbs the founder may speak on this call, enforced server-side post-call. */
  allowedVerbs: string[];
  /** Decisions referenced, so the post-call processor can bind an approval. */
  decisionRefs: string[];
}

/** The 06:00 briefing call: narrative + each decision with an approve/later ask. */
export function assembleBriefScript(
  brief: { narrative?: string },
  decisions: ScriptDecision[],
  lang: VoiceLang = "en",
): CallScript {
  const segments: string[] = [];
  const greet = lang === "bn" ? "সুপ্রভাত, ফাউন্ডার।" : "Good morning, Founder.";
  segments.push(greet);
  if (brief.narrative) segments.push(brief.narrative);
  for (const d of decisions) {
    const ask =
      lang === "bn"
        ? `${d.title}${d.impactLabel ? ` — ${d.impactLabel}` : ""}. অনুমোদন করতে বলুন "confirm approve", পরে করতে বলুন "later"।`
        : `${d.title}${d.impactLabel ? ` — ${d.impactLabel}` : ""}. Say "confirm approve" to approve, or "later" to defer.`;
    segments.push(ask);
  }
  return { lang, segments, allowedVerbs: ["approve", "later"], decisionRefs: decisions.map((d) => d.id) };
}

/** A watchdog alert call: the finding + an approve/send-to-desk ask on its decision. */
export function assembleAlertScript(
  finding: { title: string; detail: string },
  decision: ScriptDecision | null,
  lang: VoiceLang = "en",
): CallScript {
  const segments: string[] = [finding.title, finding.detail];
  if (decision) {
    segments.push(
      lang === "bn"
        ? `আমি প্রস্তুত করেছি: ${decision.title}. অনুমোদন করতে "confirm approve", অথবা "send to desk"।`
        : `I've prepared: ${decision.title}. Say "confirm approve", or "send to desk".`,
    );
  }
  return { lang, segments, allowedVerbs: ["approve", "send_to_desk"], decisionRefs: decision ? [decision.id] : [] };
}

export interface TranscriptSegment {
  t?: number;
  speaker: "founder" | "nova" | string;
  text: string;
  lang?: string;
}

export interface ConfirmationResult {
  confirmed: boolean;
  /** The segment index/time the confirmation phrase appeared at. */
  at: number | null;
  reason: string;
}

// Explicit confirmation markers — "confirm approve" (en) / "নিশ্চিত অনুমোদন" (bn).
// A bare "approve"/"yes" is NOT enough — the gate demands the confirm phrase.
const CONFIRM_EN = /\bconfirm(?:ed)?\s+approv/i;
const CONFIRM_BN = /নিশ্চিত.{0,6}অনুমোদন|অনুমোদন.{0,6}নিশ্চিত/;

/**
 * Verify the founder gave an explicit confirmation to approve `decisionTitle`.
 * Only a FOUNDER segment counts, it must carry the confirm marker, AND name
 * something from the decision (a token overlap) so "confirm approve" for the
 * wrong item doesn't bind. Fails safe: no clear match → not confirmed.
 */
export function parseVoiceConfirmation(
  segments: TranscriptSegment[],
  decisionTitle: string,
): ConfirmationResult {
  const titleTokens = decisionTitle
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.speaker !== "founder") continue;
    const text = seg.text || "";
    const hasMarker = CONFIRM_EN.test(text) || CONFIRM_BN.test(text);
    if (!hasMarker) continue;
    const low = text.toLowerCase();
    const namesIt = titleTokens.length === 0 || titleTokens.some((tok) => low.includes(tok));
    if (namesIt) return { confirmed: true, at: seg.t ?? i, reason: "explicit confirm phrase" };
  }
  return { confirmed: false, at: null, reason: "no explicit confirm phrase for this decision" };
}
