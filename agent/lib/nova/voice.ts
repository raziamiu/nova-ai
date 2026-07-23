/**
 * Voice scoring (Stage 4 "Craft", §13 + §2.4).
 *
 * `scoreVoice` grades a draft against the structured BrandProfile with a
 * DETERMINISTIC rule pass: language match, banned/required phrases, tone-word
 * coverage, length caps, emoji/hashtag policy. Each miss is a cited violation —
 * an unexplained score is exactly the thing §2.4 forbids, so the score is always
 * `100 − Σ(penalties)` and every penalty names the fragment it fired on.
 *
 * This is pass 1. A model grader (cheap tier) refines tone similarity on top in
 * generation runs; the final score is `min(ruleScore, gradedScore)`. The rule
 * pass alone is enough to flag the Stage 4 seeded off-voice draft, and it is
 * reproducible, which the model grader is not.
 */

import type { BrandProfile, ContentLanguage, ContentType, VoiceScore, VoiceViolation } from "../types";

// NFC + lower + keep letters/numbers/COMBINING MARKS (Bangla matras/nuktas are
// marks — dropping them shreds Bangla into single letters; the Phase 07 lock bug).
function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}

function containsPhrase(haystackNorm: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  return haystackNorm.includes(p);
}

// Per-type hard length caps (characters). Conservative platform limits.
const LEN_CAP: Record<ContentType, number> = {
  sms: 160, push: 160, story: 200, captions: 2200, post: 2200, reel: 1200, email: 6000, product_desc: 3000,
};

// Rough script detection: does the text carry Bangla (U+0980–U+09FF)?
function hasBangla(s: string): boolean { return /[ঀ-৿]/.test(s); }
function hasLatin(s: string): boolean { return /[a-z]/i.test(s); }

export function detectLanguage(text: string): ContentLanguage {
  const bn = hasBangla(text), en = hasLatin(text);
  if (bn && en) return "mixed";
  if (bn) return "bn";
  return "en";
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

export interface VoiceDraft {
  text: string;
  type: ContentType;
  /** Declared language; if omitted, detected from the text. */
  language?: ContentLanguage;
}

export function scoreVoice(draft: VoiceDraft, profile: BrandProfile): VoiceScore {
  const violations: VoiceViolation[] = [];
  const text = draft.text ?? "";
  const norm = normalize(text);
  const declared = draft.language ?? detectLanguage(text);

  // 1) Language match — the profile says which languages are on-brand.
  const langs = profile.languages?.length ? profile.languages : ["en"];
  const actual = detectLanguage(text);
  const langOk =
    actual === "mixed" ? langs.length >= 1 : langs.includes(actual as "bn" | "en");
  if (!langOk) {
    violations.push({
      code: "language_mismatch",
      message: `Written in ${actual}, but the brand voice is ${langs.join("/")}.`,
    });
  }
  if (declared !== actual && !(declared === "mixed" && actual !== "mixed")) {
    // Declared language should match what's actually there (honest labelling).
    violations.push({ code: "language_mismatch", message: `Labelled ${declared} but reads as ${actual}.` });
  }

  // 2) Banned phrases (rules kind:'dont') — hard voice breaks.
  for (const rule of profile.rules ?? []) {
    if (rule.kind !== "dont") continue;
    for (const phrase of [rule.text, rule.textBn].filter(Boolean) as string[]) {
      if (containsPhrase(norm, phrase)) {
        violations.push({ code: "banned_phrase", message: `Uses a phrase the brand avoids: "${phrase}".`, evidence: phrase });
        break;
      }
    }
  }

  // 3) Required phrases (rules kind:'do' that read as a must-include).
  for (const rule of profile.rules ?? []) {
    if (rule.kind !== "do") continue;
    const candidates = [rule.text, rule.textBn].filter(Boolean) as string[];
    const present = candidates.some((c) => containsPhrase(norm, c));
    if (!present && candidates.length) {
      violations.push({ code: "missing_required", message: `Missing something the brand always includes: "${rule.text}".`, evidence: rule.text });
    }
  }

  // 4) Tone-word coverage — at least one tone word should surface.
  const toneWords = profile.toneWords ?? [];
  if (toneWords.length) {
    const covered = toneWords.some((w) => containsPhrase(norm, w));
    if (!covered) {
      violations.push({ code: "tone_thin", message: `None of the brand's tone words (${toneWords.slice(0, 4).join(", ")}) come through.` });
    }
  }

  // 5) Length cap for the type.
  const cap = LEN_CAP[draft.type] ?? 2200;
  if (text.length > cap) {
    violations.push({ code: "too_long", message: `${text.length} chars — over the ${cap} cap for a ${draft.type}.` });
  }

  // 6) Emoji / hashtag policy.
  const emojis = (text.match(EMOJI) ?? []).length;
  const hashtags = (text.match(HASHTAG) ?? []).length;
  if (emojis > 8) violations.push({ code: "emoji_over", message: `${emojis} emojis — heavier than the brand usually goes.` });
  if (hashtags > 6) violations.push({ code: "hashtag_over", message: `${hashtags} hashtags — over the brand's usual handful.` });

  // Score = 100 − Σ penalties, by violation class. Language + banned are the
  // load-bearing breaks; the rest are softer.
  const PENALTY: Record<string, number> = {
    language_mismatch: 40, banned_phrase: 25, missing_required: 15,
    tone_thin: 20, too_long: 20, emoji_over: 10, hashtag_over: 10,
  };
  const penalty = violations.reduce((s, v) => s + (PENALTY[v.code] ?? 10), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const threshold = profile.threshold ?? 70;

  return { score, flagged: score < threshold, violations };
}
