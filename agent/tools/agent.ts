import { disableTool } from "eve/tools";

/**
 * Disable the built-in `agent` self-copy tool (Stage 5 "Conversation", design
 * decision #1). Left enabled, the root could spawn an unnamed copy of itself to
 * answer a department question; disabling it forces every delegation through one
 * of the 10 named departments — the PRD's 11-agent org, mechanically enforced,
 * not just asked for in the prompt. A department reply is therefore always
 * signed by a real department the founder can hold accountable.
 */
export default disableTool();
