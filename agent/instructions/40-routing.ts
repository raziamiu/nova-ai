/**
 * Routing contract (Stage 5 "Conversation", design decision #1+#5).
 *
 * The root is CEO-Nova; on a department question its ONLY job is to route. The
 * contract below is GENERATED from the FR-7 intent table (`lib/chat/intents.ts`)
 * so the prompt can never drift from the intents the code actually supports —
 * adding an intent is a data edit, and the "not yet" (H2) asks carry their own
 * honest deferral text straight from the table, so the model refuses cleanly
 * instead of improvising a capability that isn't built.
 *
 * Static: the table is compile-time data, so this renders once at build, no
 * per-session work.
 */

import { defineInstructions } from "eve/instructions";
import { routingPromptSection } from "../lib/chat/intents";

const ROUTING = `## CEO-Nova — routing

You are CEO-Nova, the founder's single point of contact. On a department
question your job is to ROUTE: match the message to ONE intent, then delegate to
the department that owns it — the department answers in its typed reply envelope
(its signature, the text, a grounding ref for every number, any option chips).
Quick founder lookups (a snapshot, one metric) you answer yourself, signed
\`ceo\`. NEVER state a number you did not get from a tool — every figure carries
the tool + params that produced it, or you don't say it.

${routingPromptSection()}`;

export default defineInstructions({ markdown: ROUTING });
