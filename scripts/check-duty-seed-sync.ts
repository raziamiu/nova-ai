/**
 * CI check: dakio-api's mirrored duty seed must match this repo's registry.
 *
 * The backend needs the same 65 duties to build authority state and serve the
 * roster. Two hand-maintained lists would drift, and the drift would be silent
 * — a duty the backend thinks is L2 and the agent thinks is L4. So the JSON is
 * GENERATED, and this proves the committed copy is still current.
 *
 * Run:  npx -y tsx scripts/check-duty-seed-sync.ts   (wired into npm test)
 */
import { readFileSync } from "node:fs";
import { DUTIES, DOORS } from "../agent/lib/duties";

const TARGET = "../dakio-api/src/lib/novaDutySeed.json";

const expected = DUTIES.map((d) => ({
  key: d.key,
  department: d.department,
  name: d.name,
  nameBn: d.nameBn,
  doorModule: d.door,
  doorExists: DOORS[d.door]?.exists ?? false,
  minLevel: d.minLevel,
}));

let actual: unknown;
try {
  actual = JSON.parse(readFileSync(TARGET, "utf8"));
} catch (error) {
  console.error(`✗ could not read ${TARGET}: ${String(error)}`);
  console.error("  Run: npx -y tsx scripts/export-duty-seed.ts");
  process.exit(1);
}

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error("✗ dakio-api's duty seed is STALE — the registry changed and the mirror did not.");
  console.error("  Run: npx -y tsx scripts/export-duty-seed.ts");
  const a = Array.isArray(actual) ? actual : [];
  console.error(`  (mirror has ${a.length} duties, registry has ${expected.length})`);
  process.exit(1);
}

console.log(`DUTY SEED SYNC PASSED — dakio-api mirrors all ${expected.length} duties.`);
