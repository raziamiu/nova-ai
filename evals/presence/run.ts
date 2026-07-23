/**
 * Presence suite (Stage 7 "Presence") — the DETERMINISTIC core.
 *
 * Voice calls, push, and the Bangla bake-off need live external accounts; these
 * checks pin the reproducible-by-construction pieces the §15 gate rests on: the
 * watchdog fires on real thresholds (card always first in the ladder), the
 * confirmation-phrase gate lets a real confirm through and blocks a bare "yes"
 * or a wrong-item confirm (fails safe), ৳ is spoken not shown, and planned-vs-
 * done + hours-saved are exact joins.
 *
 * Run:  npx -y tsx evals/presence/run.ts
 */

import { runWatchdog, nextEscalation } from "../../agent/lib/watchdog/rules";
import { assembleBriefScript, parseVoiceConfirmation, formatTakaSpeech } from "../../agent/lib/voice/scripts";
import { plannedVsDone, hoursSaved } from "../../agent/lib/presence/plan";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n[1] Watchdog fires on real thresholds, card always first");
const quiet = runWatchdog({ spendTodayMinor: 10000, dailySpendCapMinor: 500000, stockouts: [], courierFailStreaks: [] });
check("a calm store fires nothing", quiet.length === 0);
const alarm = runWatchdog({
  spendTodayMinor: 480000, dailySpendCapMinor: 500000,
  stockouts: [{ sku: "EID-SAREE-1", onActiveCampaign: true }],
  courierFailStreaks: [{ courier: "Pathao", streak: 4 }],
  revenueVsTrailing: 0.3,
});
check("the seeded stockout on a live campaign fires", alarm.some((f) => f.ruleKey === "stockout_active_campaign"));
check("critical findings sort first", alarm[0].severity === "critical");
check("the card is always the first ladder step", alarm.every((f) => f.ladder[0] === "card"));
check("a critical finding escalates card→call→push", nextEscalation(alarm[0], ["card"]) === "call");
check("a warning finding never calls (card→push)", alarm.find((f) => f.severity === "warning")?.ladder.includes("call") === false);

console.log("\n[2] The confirmation-phrase gate — fails safe");
const decision = { id: "dec_1", title: "Scale the Eid collection campaign", impactLabel: "+৳31,000 reach" };
const good = parseVoiceConfirmation(
  [{ speaker: "nova", text: "Approve the Eid campaign?" }, { speaker: "founder", text: "Confirm approve the Eid collection" }],
  decision.title,
);
check("an explicit confirm phrase naming the item is accepted", good.confirmed === true);
const bare = parseVoiceConfirmation([{ speaker: "founder", text: "yeah sure, sounds good" }], decision.title);
check("a bare 'yes' is NOT a confirmation", bare.confirmed === false);
const wrongItem = parseVoiceConfirmation([{ speaker: "founder", text: "confirm approve the discount code" }], decision.title);
check("a confirm for a DIFFERENT item does not bind this decision", wrongItem.confirmed === false);
const notFounder = parseVoiceConfirmation([{ speaker: "nova", text: "confirm approve the Eid collection" }], decision.title);
check("only the founder can confirm (not Nova's own words)", notFounder.confirmed === false);
const bn = parseVoiceConfirmation([{ speaker: "founder", text: "Eid collection নিশ্চিত অনুমোদন" }], decision.title);
check("a Bangla confirmation is accepted", bn.confirmed === true);

console.log("\n[3] Money is spoken, not shown");
check("৳ formats for English speech", formatTakaSpeech(4820000, "en") === "48,200 taka");
check("৳ formats for Bangla speech", formatTakaSpeech(4820000, "bn") === "৪৮,২০০ টাকা");

console.log("\n[4] Brief script renders the decisions with a confirm ask");
const script = assembleBriefScript({ narrative: "A steady night." }, [decision], "en");
check("script greets + narrates + asks", script.segments.length >= 3 && /confirm approve/i.test(script.segments.join(" ")));
check("allowed verbs are approve/later only", JSON.stringify(script.allowedVerbs) === JSON.stringify(["approve", "later"]));
check("the decision ref rides the script", script.decisionRefs[0] === "dec_1");

console.log("\n[5] Planned-vs-done + hours-saved are exact joins");
const planned = [
  { id: "p1", department: "marketing", title: "Draft posts" },
  { id: "p2", department: "operations", title: "Stock check" },
  { id: "p3", department: "marketing", title: "Scale campaign" },
];
const pvd = plannedVsDone(planned, ["p1", "p2"]);
check("planned/done counted exactly", pvd.plannedCount === 3 && pvd.doneCount === 2 && pvd.donePct === 67);
check("the missed item is named", pvd.missed.length === 1 && pvd.missed[0].id === "p3");
const hrs = hoursSaved([
  { department: "marketing", savedMinutes: 90 },
  { department: "marketing", savedMinutes: 30 },
  { department: "support", savedMinutes: 60 },
]);
check("hours-saved totals + per-department are exact", hrs.totalMinutes === 180 && hrs.totalHours === 3 && hrs.byDepartment.marketing === 120);

console.log(`\n${failures.length ? "✗" : "✓"} presence suite: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`   - ${f}`)); process.exit(1); }
