/**
 * Export the canonical duty registry for dakio-api to mirror per tenant.
 *
 * The seed lives in nova-ai (reviewed like code); dakio-api needs the same 65
 * rows to build its authority state and serve the founder's roster. Rather than
 * maintain two lists that can disagree, this generates the backend's copy — and
 * a CI check re-runs it to prove the copy is still current.
 *
 * Run:  npx -y tsx scripts/export-duty-seed.ts
 */
import { writeFileSync } from "node:fs";
import { DUTIES, DOORS } from "../agent/lib/duties";

const seed = DUTIES.map((d) => ({
  key: d.key,
  department: d.department,
  name: d.name,
  nameBn: d.nameBn,
  doorModule: d.door,
  doorExists: DOORS[d.door]?.exists ?? false,
  minLevel: d.minLevel,
}));

const target = process.argv[2] ?? "../dakio-api/src/lib/novaDutySeed.json";
writeFileSync(target, JSON.stringify(seed, null, 2) + "\n", "utf8");
console.log(`Wrote ${seed.length} duties to ${target} (${seed.filter((d) => !d.doorExists).length} awaiting doors)`);
