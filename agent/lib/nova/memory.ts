/**
 * Nova's long-term memory, persisted in the store (the Express server will
 * own this data in production, same as the rest of the agent state).
 *
 * Memory is injected into Nova's system prompt every turn via dynamic
 * instructions, so remembered facts survive across sessions and shape every
 * conversation without an explicit recall step.
 */

import type { MemoryEntry, MemoryNamespace } from "../types";
import type { StoreClient } from "../store/client";

export const MEMORY_NAMESPACES: MemoryNamespace[] = [
  "goals",
  "brand",
  "preferences",
  "rules",
  "insights",
  "experiments",
  "customers",
];

const NAMESPACE_LABEL: Record<MemoryNamespace, string> = {
  goals: "Business goals",
  brand: "Brand & voice",
  preferences: "Owner preferences",
  rules: "Standing rules",
  insights: "Learned insights",
  experiments: "Experiment outcomes",
  customers: "Customer notes",
};

/** Cap injected entries per namespace so the prompt stays lean. */
const INJECT_LIMIT_PER_NAMESPACE = 8;

export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "(Memory is empty so far — store durable facts as you learn them.)";
  }
  const sections: string[] = [];
  for (const namespace of MEMORY_NAMESPACES) {
    const inNamespace = entries
      .filter((e) => e.namespace === namespace)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, INJECT_LIMIT_PER_NAMESPACE);
    if (inNamespace.length === 0) continue;
    sections.push(
      `**${NAMESPACE_LABEL[namespace]}**\n${inNamespace
        .map((e) => `- ${e.key}: ${e.value}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

export async function loadMemorySnapshot(client: StoreClient): Promise<string> {
  return formatMemoryForPrompt(await client.listMemory());
}
