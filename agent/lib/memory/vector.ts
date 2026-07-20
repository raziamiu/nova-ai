/**
 * Retrieval scoring for semantic memory — the "in-process vector store".
 *
 * This is the same fallback shape as the Redis/in-process cache split: the
 * production path can hand ranking to pgvector's HNSW index, but in dev/tests
 * we score with a brute-force cosine over the tenant's in-memory embeddings.
 * Because both go through {@link embedText}, swapping in pgvector changes only
 * WHERE the cosine is computed, not the scoring contract below.
 *
 * Final score (blueprint §APIs): 0.6·cosine + 0.25·recencyDecay + 0.15·weight,
 * with a 0.35 threshold and top-K (K≤8), deduped by (namespace,key).
 */

import type { MemoryEntry } from "../types";

/** Blueprint retrieval constants. */
export const RETRIEVAL = {
  /** Score component weights — must feed a convex combination (sum to 1). */
  cosineWeight: 0.6,
  recencyWeight: 0.25,
  weightWeight: 0.15,
  /** Entries scoring below this are not "relevant" and are dropped. */
  threshold: 0.35,
  /** Top-K cap on what L3 injects. */
  k: 8,
  /** Recency half-life in days — a 30-day-old fact keeps half its recency. */
  recencyHalfLifeDays: 30,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cosine similarity of two equal-length vectors; 0 if either is empty. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Exponential recency decay in [0,1]; 1.0 for something updated just now. */
export function recencyDecay(updatedAt: string, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - Date.parse(updatedAt)) / DAY_MS);
  return Math.exp((-Math.LN2 * ageDays) / RETRIEVAL.recencyHalfLifeDays);
}

/** Normalize a raw weight into [0,1] for the score (default weight 1 → 1.0). */
export function weightScore(weight: number | undefined): number {
  return Math.max(0, Math.min(1, weight ?? 1.0));
}

export interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
  /** Raw cosine, exposed for tests and debugging. */
  similarity: number;
}

/**
 * Score one entry against a query embedding. `nowMs` is passed in (not read
 * from a clock) so scoring is pure and reproducible under `tsx`.
 */
export function scoreEntry(
  entry: MemoryEntry,
  queryEmbedding: readonly number[],
  nowMs: number,
): ScoredEntry {
  const similarity = entry.embedding ? cosine(queryEmbedding, entry.embedding) : 0;
  const score =
    RETRIEVAL.cosineWeight * Math.max(0, similarity) +
    RETRIEVAL.recencyWeight * recencyDecay(entry.updatedAt, nowMs) +
    RETRIEVAL.weightWeight * weightScore(entry.weight);
  return { entry, score, similarity };
}

/** True when an entry's TTL has passed (should not be retrieved). */
export function isExpired(entry: MemoryEntry, nowMs: number): boolean {
  return entry.expiresAt != null && Date.parse(entry.expiresAt) <= nowMs;
}

/**
 * Rank entries against a query embedding: score, drop expired + below-threshold,
 * dedupe by (namespace,key) keeping the best, sort desc, take top-K.
 */
export function rankByRelevance(
  entries: MemoryEntry[],
  queryEmbedding: readonly number[],
  nowMs: number,
  k: number = RETRIEVAL.k,
): ScoredEntry[] {
  const best = new Map<string, ScoredEntry>();
  for (const entry of entries) {
    if (isExpired(entry, nowMs)) continue;
    const scored = scoreEntry(entry, queryEmbedding, nowMs);
    // Semantic recall requires an actual semantic match. Without this, the
    // recency (0.25) + weight (0.15) components alone reach 0.40 > threshold,
    // so a recent entry with a null/zero embedding (async-worker lag, or a
    // value that tokenizes to nothing) would leak in with zero relevance.
    if (scored.similarity <= 0) continue;
    if (scored.score < RETRIEVAL.threshold) continue;
    const dedupeKey = `${entry.namespace}:${entry.key}`;
    const prior = best.get(dedupeKey);
    if (!prior || scored.score > prior.score) best.set(dedupeKey, scored);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
