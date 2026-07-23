// Run the deterministic night shift against whatever backend NOVA_STORE_BACKEND
// selects (dakio = live dakio-api). Verifiable proof of the autonomous authoring
// loop: departments graded, plan board filled, a scale decision authored, brief filed.
import { storeFor } from "../agent/lib/store/resolve";
import { runNightShift } from "../agent/lib/night/nightShift";

const storeId = process.env.NOVA_DEV_STORE_ID;
if (!storeId) throw new Error("NOVA_DEV_STORE_ID required");

const store = storeFor(storeId);
const r = await runNightShift(store);

console.log(JSON.stringify({
  day: r.day,
  departments: r.departments.map((d) => ({ key: d.key, grade: d.grade, metrics: d.metrics?.length ?? 0 })),
  planItems: r.planItems.length,
  waiting: r.planItems.filter((p) => p.status === "WAITING_ON_YOU").map((p) => ({ title: p.title, decisionRef: p.decisionRef })),
  decisions: r.decisions.map((d) => ({ id: d.id, title: d.title, tag: d.tag })),
  briefId: r.briefId,
}, null, 2));
process.exit(0);
