/**
 * Generation suite (Stage 4 "Craft", 10-C). The model writes the copy;
 * `draftAndFileContent` (the core of the generate_content tool) scores it
 * against the store's brand voice and files it into review. These checks are
 * the DETERMINISTIC contract around the model's creativity: an in-voice draft
 * clears the bar and lands in review; an off-voice draft is flagged, cites the
 * phrase that broke it, and comes back with revise guidance; re-filing with the
 * same id (the request-changes loop) improves the score and keeps the item.
 *
 * The model's actual wording is exercised at runtime by the marketing subagent
 * eval; here we feed fixed "model output" so the scoring + filing + revise
 * contract is reproducible.
 *
 * Run:  npx -y tsx evals/generate/run.ts
 */

import { DemoStore } from "../../agent/lib/store/backend";
import { createSeed } from "../../agent/lib/store/seed";
import { draftAndFileContent, reviseGuidance } from "../../agent/lib/nova/content";
import type { StoreSeed } from "../../agent/lib/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function freshStore(): DemoStore {
  const seed: StoreSeed = createSeed(Date.UTC(2026, 6, 23, 12, 0, 0));
  return new DemoStore(seed);
}

async function main(): Promise<void> {
  console.log("\n[1] The store serves a real brand voice to score against");
  const store = freshStore();
  const profile = await store.getBrandProfile();
  check("brand profile has tone words", profile.toneWords.length >= 1, JSON.stringify(profile.toneWords));
  check("brand profile bans off-voice phrases", profile.rules.some((r) => r.kind === "dont"));

  console.log("\n[2] An in-voice draft clears the bar and lands in review");
  const good = await draftAndFileContent(store, {
    type: "post",
    title: "Eid collection — launch post",
    text: "Our warm, handmade Eid collection is here — cozy pieces made to last. Tap to see the new arrivals.",
  });
  check("in-voice draft is not flagged", !good.score.flagged, `score ${good.score.score}`);
  check("in-voice draft clears threshold", good.score.score >= 70, `score ${good.score.score}`);
  check("in-voice draft filed to review", good.item.status === "review");
  check("in-voice draft carries its score", good.item.voiceScore === good.score.score);
  check("in-voice draft returns no guidance (nothing to fix)", good.guidance === "");
  check("draft language detected as English", good.item.language === "en", good.item.language);

  console.log("\n[3] An off-voice draft is flagged, cited, and comes back with guidance");
  const bad = await draftAndFileContent(store, {
    type: "post",
    title: "Flash sale blast",
    text: "Big flash sale — cheap sarees, limited time only. Grab yours!",
  });
  check("off-voice draft is flagged", bad.score.flagged, `score ${bad.score.score}`);
  check("off-voice score is below the in-voice score", bad.score.score < good.score.score);
  check(
    "off-voice draft cites the banned phrase",
    bad.score.violations.some((v) => v.evidence === "cheap" || /cheap/.test(v.message)),
    JSON.stringify(bad.score.violations.map((v) => v.code)),
  );
  check("off-voice draft still filed (founder can see the flag)", bad.item.status === "review");
  check("off-voice draft returns revise guidance", bad.guidance.length > 0);
  check("guidance names the draft to revise", bad.guidance.includes(bad.item.id));

  console.log("\n[4] Re-filing with the same id is the request-changes loop");
  const revised = await draftAndFileContent(store, {
    type: "post",
    title: "Flash sale blast",
    text: "Our warm, handmade sarees are back in stock — cozy colours, made to last. Come see them.",
    contentId: bad.item.id,
    note: "drop the 'cheap' and the countdown; keep it warm",
  });
  check("revision reuses the same content item", revised.item.id === bad.item.id);
  check("revision improves the score", revised.score.score > bad.score.score, `${bad.score.score} → ${revised.score.score}`);
  check("revised draft is no longer flagged", !revised.score.flagged, `score ${revised.score.score}`);
  check("revised draft is back in review", revised.item.status === "review");

  console.log("\n[5] Guidance is empty for a clean score, non-empty for a flagged one");
  check("reviseGuidance('') on clean score is empty", reviseGuidance(revised.score, revised.item.id) === "");
  check("reviseGuidance on flagged score is non-empty", reviseGuidance(bad.score, bad.item.id).length > 0);

  console.log(`\n${failures.length ? "✗" : "✓"} generate suite: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach((f) => console.error(`   - ${f}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
