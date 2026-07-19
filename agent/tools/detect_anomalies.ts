import { defineTool } from "eve/tools";
import { z } from "zod";
import { detectAnomalies } from "../lib/nova/analytics";

export default defineTool({
  description:
    "Nova's proactive radar — run at the start of any check-in, pulse, or report. Scans ads, inventory, logistics, sales, support, carts, and margins for problems and returns findings with severity (critical/warning/info), evidence, and a suggested action. Returns { count, findings }.",
  inputSchema: z.object({}),
  async execute() {
    const findings = detectAnomalies();
    return { count: findings.length, findings };
  },
});
