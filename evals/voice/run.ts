/**
 * Voice suite (Stage 4 "Craft"). The gate's own scenario lives here: an
 * on-voice draft clears the threshold, a seeded off-voice draft is flagged
 * below it — with cited violations, never an unexplained score. Bangla is a
 * first-class target, not a translation afterthought.
 *
 * Run:  npx -y tsx evals/voice/run.ts
 */

import { scoreVoice } from "../../agent/lib/nova/voice";
import type { BrandProfile } from "../../agent/lib/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const EN_PROFILE: BrandProfile = {
  toneWords: ["cozy", "handmade", "warm"],
  palette: ["#1A1D12"],
  rules: [
    { kind: "dont", text: "cheap" },
    { kind: "dont", text: "limited time only" },
  ],
  languages: ["en"],
  assets: {},
};

const BN_PROFILE: BrandProfile = {
  toneWords: ["আরাম", "হাতে তৈরি"],
  palette: [],
  rules: [{ kind: "dont", text: "সস্তা" }],
  languages: ["bn"],
  assets: {},
};

// 1) on-voice English post — tone words present, nothing banned.
const good = scoreVoice({ text: "Our cozy, handmade throws keep you warm all winter.", type: "post" }, EN_PROFILE);
check("on-voice draft clears the threshold", good.score >= 70 && !good.flagged, `score ${good.score}`);
check("on-voice draft has no violations", good.violations.length === 0);

// 2) off-voice English post — banned phrase + no tone words.
const bad = scoreVoice({ text: "CHEAP blankets, limited time only!!!", type: "post" }, EN_PROFILE);
check("off-voice draft is flagged below threshold", bad.flagged, `score ${bad.score}`);
check("the flag cites the banned phrase", bad.violations.some((v) => v.code === "banned_phrase"));
check("every violation carries a founder-facing message", bad.violations.every((v) => v.message.length > 0));

// 3) Bangla draft against the Bangla profile — matras must not be shredded.
const bnGood = scoreVoice({ text: "আমাদের হাতে তৈরি চাদরে শীতে আরাম পাবেন।", type: "post" }, BN_PROFILE);
check("Bangla on-voice draft clears the threshold (matras intact)", !bnGood.flagged, `score ${bnGood.score}`);

// 4) Bangla banned phrase is caught (the Phase 07 combining-mark bug would miss this).
const bnBad = scoreVoice({ text: "সস্তা চাদর, এখনই কিনুন।", type: "post" }, BN_PROFILE);
check("Bangla banned phrase is caught", bnBad.violations.some((v) => v.code === "banned_phrase"), `score ${bnBad.score}`);

// 5) Language mismatch — English draft against a Bangla-only brand.
const mismatch = scoreVoice({ text: "Warm handmade throws for winter.", type: "post" }, BN_PROFILE);
check("English draft against a Bangla brand is a language mismatch", mismatch.violations.some((v) => v.code === "language_mismatch"));

// 6) Length cap — an SMS over 160 chars.
const longSms = scoreVoice({ text: "cozy ".repeat(60), type: "sms" }, EN_PROFILE);
check("an over-length SMS is flagged too_long", longSms.violations.some((v) => v.code === "too_long"));

// 7) Determinism — same inputs, same score.
const a = scoreVoice({ text: "CHEAP blankets!!!", type: "post" }, EN_PROFILE);
const b = scoreVoice({ text: "CHEAP blankets!!!", type: "post" }, EN_PROFILE);
check("scoring is deterministic", a.score === b.score && JSON.stringify(a.violations) === JSON.stringify(b.violations));

console.log(`\nvoice: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
