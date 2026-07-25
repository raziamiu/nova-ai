import { defineTool } from "eve/tools";
import { z } from "zod";
import { detectAnomalies } from "../lib/nova/analytics";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
import { requireFounderSession } from "../lib/customer/session";

export default defineTool({
  description:
    "Nova's proactive radar — run at the start of any check-in, pulse, or report. Scans ads, inventory, logistics, sales, support, carts, and margins for problems and returns findings with severity (critical/warning/info), evidence, and a suggested action. Returns { count, findings }.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireFounderSession(ctx); // D11: founder-plane tool, never a customer session
    const findings = await detectAnomalies(storeFor(requireStore(ctx).storeId));
    return { count: findings.length, findings };
  },
});
