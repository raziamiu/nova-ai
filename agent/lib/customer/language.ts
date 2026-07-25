/**
 * Script & language detection for the customer inbox (Stage 10 module 02, D4).
 *
 * BD DM-commerce code-switches every few messages between three registers:
 *
 *   bn        Bangla script      "চট্টগ্রামে ডেলিভারি কত দিন লাগবে?"
 *   banglish  Bangla in Latin    "bhaiya ei shirt ta dam koto?"
 *   en        English            "do you have this in any other colours?"
 *
 * D4's rule is MIRROR, NEVER LEAD: reply in the script and register of the
 * customer's latest message, and never switch first. Detection at reply time is
 * in-turn model work — the model reports what it saw in `sendInboxReplyPayload.
 * language`, and there is deliberately no classifier service in the reply path
 * (a second opinion that disagreed with the model mid-turn would have no way to
 * fix the text it already wrote).
 *
 * So this module is NOT a runtime gate. It is the deterministic ruler the CI
 * mirror eval measures with (`evals/inbox/persona.ts`) — the thing that can say
 * "this Bangla question got a Banglish answer" without a model in the loop —
 * and the same ruler any server-side consumer should use if one is ever needed
 * (the `inbox.lang.detected` telemetry in D4, for example). Keeping one
 * implementation means the number the evals gate on and the number a dashboard
 * plots can never drift apart.
 *
 * Everything here is pure, synchronous and allocation-light: no I/O, no
 * regex-per-call construction, no model.
 */

import type { InboxLanguage } from "../types";

/** Which alphabet the letters of a message are actually written in. */
export type InboxScript = "bengali" | "latin" | "none";

/**
 * D4's threshold: ≥40% Bengali codepoints ⇒ `bn`.
 *
 * It is deliberately well below 50% because a genuinely Bangla message carries
 * Latin runs by design — D4 mandates Latin digits ("2-3 দিনে", never "২-৩"),
 * and product names, sizes and model numbers stay Latin in every language.
 * "M size er ar 3 ta ache" inside an otherwise Bangla sentence must not tip the
 * verdict to Banglish.
 */
export const BENGALI_SCRIPT_THRESHOLD = 0.4;

/** Banglish lexicon hits needed before a Latin-script message stops being English. */
export const BANGLISH_MIN_HITS = 1;

// --- codepoint classification ----------------------------------------------

/**
 * The Bengali Unicode block is U+0980–U+09FF, but it is not all letters: the
 * block also carries Bengali digits, the taka sign, and the currency/fraction
 * numerators. Those must NOT count as script evidence —
 *
 *   - "৳1,250" is the correct way to write a price in an ENGLISH reply, and
 *   - Bengali digits are banned outright by D4 (`hasBengaliDigits` is the
 *     detector for that separate rule),
 *
 * so counting either as "Bengali script" would mis-label replies in both
 * directions. Combining marks (matras, hasant, chandrabindu) DO count: they are
 * inseparable from the letters they sit on, and dropping them would deflate the
 * ratio of exactly the most heavily-conjunct Bangla.
 */
function isBengaliLetter(cp: number): boolean {
  if (cp < 0x0980 || cp > 0x09ff) return false;
  if (cp >= 0x09e6 && cp <= 0x09ef) return false; // ০–৯ Bengali digits
  if (cp >= 0x09f2 && cp <= 0x09fb) return false; // ৲ ৳ and the fraction numerators
  if (cp === 0x09fd) return false; // ৽ abbreviation sign
  return true;
}

/** Bengali digits ০–৯ — banned in every reply register (D4). */
function isBengaliDigit(cp: number): boolean {
  return cp >= 0x09e6 && cp <= 0x09ef;
}

function isLatinLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/**
 * Strip the runs that are script-neutral noise: URLs and emails are Latin by
 * protocol, not by choice, and a storefront link pasted into a Bangla reply
 * (the C-13 "links, not photos" path) would otherwise drag it toward `en`.
 */
function stripNeutralRuns(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi, " ");
}

export interface ScriptStats {
  bengaliLetters: number;
  latinLetters: number;
  bengaliDigits: number;
  latinDigits: number;
}

/** Count what a message is made of. The basis for every verdict below. */
export function scriptStats(text: string): ScriptStats {
  const stats: ScriptStats = { bengaliLetters: 0, latinLetters: 0, bengaliDigits: 0, latinDigits: 0 };
  for (const char of stripNeutralRuns(text)) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (isBengaliLetter(cp)) stats.bengaliLetters += 1;
    else if (isLatinLetter(cp)) stats.latinLetters += 1;
    else if (isBengaliDigit(cp)) stats.bengaliDigits += 1;
    else if (cp >= 0x30 && cp <= 0x39) stats.latinDigits += 1;
  }
  return stats;
}

/**
 * Bengali share of the LETTERS (digits and punctuation excluded — see
 * `isBengaliLetter`). `0` for a message with no letters at all.
 */
export function bengaliRatio(text: string): number {
  const { bengaliLetters, latinLetters } = scriptStats(text);
  const letters = bengaliLetters + latinLetters;
  return letters === 0 ? 0 : bengaliLetters / letters;
}

/**
 * The dominant alphabet, or `"none"` for a message with no letters — an
 * emoji-only "😍", a bare "1250", a lone "?". Callers that assert mirroring
 * must handle `"none"` explicitly rather than defaulting it: there is no script
 * to mirror, and pretending otherwise is how a mirror eval passes vacuously.
 */
export function scriptOf(text: string): InboxScript {
  const { bengaliLetters, latinLetters } = scriptStats(text);
  if (bengaliLetters + latinLetters === 0) return "none";
  return bengaliRatio(text) >= BENGALI_SCRIPT_THRESHOLD ? "bengali" : "latin";
}

/** True if the text writes any number in Bengali digits — always a D4 violation. */
export function hasBengaliDigits(text: string): boolean {
  return scriptStats(text).bengaliDigits > 0;
}

// --- Banglish lexicon -------------------------------------------------------

/**
 * The words that make a Latin-script message Bangla-in-Latin rather than
 * English. D4 names the seed set (`koto`, `dam`, `ache`, `nai`, `lagbe`,
 * `kobe`, `dibo`, `bhai`, `apu`, `hobe`, `koren`, `den`, `nibo`, `stock ase`);
 * the rest are the high-frequency function words that actually carry BD DM
 * traffic — pronouns, verb endings, particles.
 *
 * Two deliberate constraints on what may join this list:
 *
 *   1. Whole-token matching only (see `banglishHits`) — `ache` must not fire on
 *      "headache", `den` must not fire on "denim".
 *   2. Nothing that is also a common English word in shop-talk. `dam`, `den`
 *      and `ache` are the borderline cases and are kept because D4 names them
 *      explicitly; they are single hits, and a real English sentence built out
 *      of them ("the dam den") does not occur in an inbox.
 */
export const BANGLISH_LEXICON: readonly string[] = [
  // D4's named seeds
  "koto", "dam", "ache", "nai", "lagbe", "kobe", "dibo", "bhai", "apu", "hobe",
  "koren", "den", "nibo", "ase",
  // pronouns & address
  "ami", "amar", "amake", "apni", "apnar", "apnara", "tumi", "tomar", "eta",
  "ei", "ta", "oi", "bhaiya", "apuni", "vai",
  // verbs & endings
  "korbo", "korchi", "korlam", "kore", "korte", "koren", "dibe", "diben",
  "niben", "jabe", "jabo", "ashe", "asbe", "peye", "paben", "pathabo",
  "pathate", "dekhe", "dekhi", "dilam", "hoye", "hoyeche", "geche", "chai",
  "chaile", "bolen", "bolchen", "bolben", "janai", "janachchi", "rakhben",
  "lage", "lagbe", "thakbe", "parben", "pari",
  // particles, connectors, time
  "ki", "keno", "kothay", "kobe", "kemon", "kichu", "kichhu", "onek", "ektu",
  "eto", "tobe", "kintu", "achha", "achcha", "shob", "sob", "moddhe", "jonno",
  "ar", "aro", "age", "pore", "aj", "kal", "din", "somoy", "joldi", "ekhoni",
  "taratari", "naki", "sotti", "asol", "kono", "diye", "gulo", "achen",
  "bolchi", "kotha", "sathe",
  // commerce nouns
  "taka", "tk", "poysha", "dokan", "koto", "size", "stock", "order",
  "delivery", "courier", "thikana", "basha", "road",
  // courtesy
  "dhonnobad", "ji", "oboshshoi", "ekdom", "insha",
  // loanwords that only ever ride along (see WEAK_HINTS)
  "manush", "robot", "machine",
];

const BANGLISH_SET = new Set(BANGLISH_LEXICON);

/**
 * Words that are in the lexicon (BD customers really do write them inside
 * Banglish sentences) but may never be EVIDENCE on their own.
 *
 * Two kinds: English shop loanwords ("do you have this in size M?" is an
 * English question), and the identity nouns "manush"/"robot"/"machine", which
 * turn up verbatim in "Are you a robot?" — the exact question whose reply must
 * come back in ENGLISH. A weak hint only carries when the surrounding message
 * has no English function words at all ("manush na machine?"), which is what
 * `detectLanguage` checks.
 */
const WEAK_HINTS = new Set([
  "size", "stock", "order", "delivery", "courier", "road", "tk", "ar",
  "manush", "robot", "machine",
]);

/**
 * The give-away that a Latin-script message is really English: an English
 * sentence almost cannot be built without one of these, and a Banglish one
 * almost never contains one. Only consulted when no strong lexicon hit exists,
 * so it can never override real Banglish evidence.
 */
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "a", "an", "is", "are", "am", "was", "were", "be", "been", "do",
  "does", "did", "you", "your", "yours", "i", "we", "they", "he", "she", "it",
  "this", "that", "these", "those", "to", "of", "in", "on", "for", "with",
  "from", "and", "or", "but", "if", "not", "my", "me", "there", "here",
  "what", "who", "how", "why", "when", "where", "can", "could", "will",
  "would", "should", "have", "has", "had", "any", "some", "still", "please",
]);

/** Lowercase Latin tokens; Bengali runs and punctuation split words apart. */
function latinTokens(text: string): string[] {
  return stripNeutralRuns(text)
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((token) => token.length > 0);
}

/**
 * Which lexicon words a message actually used. Returned (rather than a bare
 * boolean) because a failing mirror check should be able to say WHY it read a
 * reply as Banglish — an eval that only reports "wrong language" is a bug
 * report nobody can act on.
 */
export function banglishHits(text: string): string[] {
  const hits = latinTokens(text).filter((t) => BANGLISH_SET.has(t) && !WEAK_HINTS.has(t));
  return [...new Set(hits)];
}

/** Lexicon words present that are too weak to stand alone (see WEAK_HINTS). */
export function weakBanglishHints(text: string): string[] {
  return [...new Set(latinTokens(text).filter((t) => WEAK_HINTS.has(t)))];
}

/** Apostrophes split here so "you're" surrenders its "you". */
function hasEnglishFunctionWord(text: string): boolean {
  return latinTokens(text)
    .flatMap((token) => token.split("'"))
    .some((token) => ENGLISH_FUNCTION_WORDS.has(token));
}

// --- the verdict ------------------------------------------------------------

/**
 * D4's detection rule, verbatim: ≥40% Bengali letters ⇒ `bn`; otherwise Latin
 * script with Banglish lexicon hits ⇒ `banglish`; otherwise `en`. Mixed script
 * resolves by dominance, which the ratio already encodes.
 *
 * A message with no letters at all (emoji, a bare price, "?") reads `en` —
 * D4's documented default. Use `scriptOf() === "none"` when the distinction
 * matters; `en` here is a fallback, not evidence.
 */
export function detectLanguage(text: string): InboxLanguage {
  if (bengaliRatio(text) >= BENGALI_SCRIPT_THRESHOLD) return "bn";
  if (banglishHits(text).length >= BANGLISH_MIN_HITS) return "banglish";
  // No strong hit: a weak one counts only in a message with no English scaffolding
  // at all — "manush na machine?" is Banglish, "Are you a robot?" is not.
  if (weakBanglishHints(text).length > 0 && !hasEnglishFunctionWord(text)) return "banglish";
  return "en";
}

export interface MirrorVerdict {
  ok: boolean;
  /** What the customer wrote in — the register the reply owes them. */
  expected: InboxLanguage;
  /** What the reply actually came back in. */
  got: InboxLanguage;
  /** Human-readable failure cause, empty when `ok`. */
  reason: string;
  /** Lexicon evidence behind `got`, for a failure message worth reading. */
  hits: string[];
}

/**
 * Does this reply mirror this inbound? The CI gate behind D4's "mirror, never
 * lead" and the acceptance bars in §Testing (bn→bn ≥95%, banglish→banglish
 * ≥90%).
 *
 * Strict equality in both directions is intentional. Answering a Banglish
 * question in polished English is the same failure as answering an English
 * question in Banglish: Nova switched first. The only asymmetry is the
 * unscriptable inbound (emoji/number-only), where there is nothing to mirror
 * and the verdict says so instead of passing quietly.
 */
export function mirrorVerdict(inbound: string, reply: string): MirrorVerdict {
  const expected = detectLanguage(inbound);
  const got = detectLanguage(reply);
  const hits = banglishHits(reply);

  if (scriptOf(inbound) === "none") {
    return { ok: true, expected, got, reason: "inbound carries no script to mirror", hits };
  }
  if (got === expected) return { ok: true, expected, got, reason: "", hits };

  const detail =
    expected === "bn"
      ? "a Bangla-script question must be answered in Bangla script"
      : expected === "banglish"
        ? "a Banglish question must be answered in Banglish, not polished English or Bangla script"
        : "an English question must be answered in English — Nova never switches first";
  return { ok: false, expected, got, reason: detail, hits };
}
