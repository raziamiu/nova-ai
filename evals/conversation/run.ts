/**
 * Conversation suite (Stage 5 "Conversation") — the DETERMINISTIC spine.
 *
 * The 10-intent live corpus (×2 languages) and the grounding audit are
 * model-driven and run against a live model; these checks gate the pieces that
 * must hold with no model in the loop: the intent table is well-formed and
 * generates a routing prompt, and the reply envelope rejects a hallucinated
 * signature, an over-cap stats array, and an ungrounded number BEFORE anything
 * reaches the founder.
 *
 * Run:  npx -y tsx evals/conversation/run.ts
 */

import {
  INTENTS, liveIntents, deferredIntents, routingPromptSection, validateIntents, intentsForDepartment,
} from "../../agent/lib/chat/intents";
import { parseEnvelope } from "../../agent/lib/chat/envelope";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── Intent table ────────────────────────────────────────────────────────────
console.log("\n[1] The intent table is well-formed");
check("no structural errors (ids unique, depts valid, verbs/notes present)", validateIntents().length === 0, validateIntents().join("; "));
check("there are live intents", liveIntents().length >= 7, String(liveIntents().length));
check("H2 intents ship as honest deferrals", deferredIntents().length >= 3, String(deferredIntents().length));
check("every deferred intent has an honest note", deferredIntents().every((i) => (i.deferralNote ?? "").length > 10));
check("the guardrail-refusal intent exists (the gate's refused ask)", INTENTS.some((i) => i.id === "guardrail_refusal"));
check("delegate_task routes an open-ended job", INTENTS.some((i) => i.id === "delegate_task" && i.verbs.includes("delegate_task")));

console.log("\n[2] The routing prompt is derived from the table");
const prompt = routingPromptSection();
check("prompt lists a live intent", prompt.includes("explain_grade"));
check("prompt carries the H2 deferral text (never improvise)", deferredIntents().every((i) => prompt.includes(i.deferralNote!)));
check("marketing owns content_review", intentsForDepartment("marketing").some((i) => i.id === "content_review"));

// ── Reply envelope ──────────────────────────────────────────────────────────
console.log("\n[3] A well-formed envelope parses and keeps its evidence");
const good = parseEnvelope({
  agentId: "marketing",
  text: "You had 12 orders today, up from 9 yesterday.",
  stats: [{ label: "orders today", value: 12, source: { tool: "get_orders", params: { sinceDays: 1 } } }],
  optionRefs: [{ decisionRef: "dec_1", label: "Scale the winner" }],
});
check("valid envelope parses", good.ok === true);
check("stats survive with their source", good.ok && good.envelope.stats[0].source.tool === "get_orders");
check("optionRefs default applies", parseEnvelope({ agentId: "ceo", text: "hi" }).ok === true);

console.log("\n[4] The envelope rejects what must never reach the founder");
check("hallucinated signature rejected", parseEnvelope({ agentId: "wizard", text: "hi" }).ok === false);
check("a stat missing its source is rejected", parseEnvelope({ agentId: "ceo", text: "5 orders", stats: [{ label: "orders", value: 5 }] }).ok === false);
const over = parseEnvelope({ agentId: "ceo", text: "x", stats: Array.from({ length: 9 }, (_, i) => ({ label: `m${i}`, value: i, source: { tool: "t" } })) });
check("an over-cap stats array (>8) is rejected", over.ok === false);
check("more than 3 option chips are rejected", parseEnvelope({ agentId: "ceo", text: "x", optionRefs: Array.from({ length: 4 }, (_, i) => ({ decisionRef: `d${i}`, label: `o${i}` })) }).ok === false);
check("empty text is rejected", parseEnvelope({ agentId: "ceo", text: "" }).ok === false);

console.log(`\n${failures.length ? "✗" : "✓"} conversation suite: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`   - ${f}`)); process.exit(1); }
