/**
 * Embedding pipeline for semantic memory.
 *
 * Two backends, chosen the same way the cache and vector store choose theirs:
 *
 *   - Default (dev/tests): a DETERMINISTIC local stub — a hashing vectorizer
 *     (feature hashing) over the entry's tokens, L2-normalized. No network, so
 *     retrieval is byte-for-byte reproducible in `tsx`/eval runs where no model
 *     key is available. Cosine similarity tracks shared salient tokens, which
 *     is enough to prove "recall returns the right entries by similarity".
 *   - Gateway (prod): set `NOVA_EMBEDDINGS=gateway` to embed via the Vercel AI
 *     Gateway embedding model (voyage-3.5-lite class). Same normalized-vector
 *     contract, so callers never branch on which backend is live.
 *
 * The embed worker (see service.ts) fills `nova_memory.embedding` asynchronously
 * from an outbox of rows where `embedding IS NULL`; embedding happens on write,
 * never on a read hot path.
 */

/* The model id lives in `lib/models.ts` with every other one. It gained its
 * `voyage/` provider prefix on the way: the bare `voyage-3.5-lite` written
 * here originally is not a valid gateway id and would have failed at request
 * time — never hit, because this path is off unless `NOVA_EMBEDDINGS=gateway`. */
import { EMBED_MODEL } from "../models";

/**
 * Local-stub embedding dimension. The gateway model returns 1024 (the
 * `vector(1024)` column in the pgvector schema); the stub uses a smaller space
 * because query and document vectors only need to share ONE space, and both go
 * through {@link embedText}. Kept a power of two for clean hashing.
 */
export const EMBED_DIM = 256;

/** Words that carry no retrieval signal — dropped before hashing. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "at",
  "by", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "with", "as", "from", "we", "our", "you", "your", "they", "their", "not",
  "no", "do", "does", "did", "so", "than", "then", "over", "under", "up",
  "out", "if", "when", "how", "what", "which", "will", "can", "should",
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Deterministic 32-bit FNV-1a hash of a string. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/**
 * The deterministic stub embedding: a hashing vectorizer with token n-grams so
 * near-identical phrasings land near each other. Two signed hash buckets per
 * token reduce collisions, matching a standard feature-hashing trick.
 */
function stubEmbed(text: string): number[] {
  const vector = new Array<number>(EMBED_DIM).fill(0);
  const tokens = tokenize(text);
  const grams = [...tokens];
  for (let i = 0; i < tokens.length - 1; i += 1) grams.push(`${tokens[i]}_${tokens[i + 1]}`);

  for (const gram of grams) {
    const h1 = fnv1a(gram);
    const h2 = fnv1a(`salt:${gram}`);
    const bucket = h1 % EMBED_DIM;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vector[bucket] += sign;
  }
  return normalize(vector);
}

/** True when the real gateway embedding backend is enabled. */
export function usingGatewayEmbeddings(): boolean {
  return process.env.NOVA_EMBEDDINGS === "gateway";
}

/**
 * Embed a single text into a unit vector. Deterministic in the default (stub)
 * backend; a real gateway call under `NOVA_EMBEDDINGS=gateway`.
 */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Embed a batch of texts. The gateway path batches (≤64) to amortize the round
 * trip; the stub maps locally. Both return unit vectors in the same space.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!usingGatewayEmbeddings()) {
    return texts.map(stubEmbed);
  }
  return embedViaGateway(texts);
}

/** Maximum texts per gateway embedding request (blueprint: batch ≤64). */
const GATEWAY_BATCH = 64;

/**
 * Real embedding path. Lazily imports the `ai` SDK so the stub path (and the
 * eval runs that exercise it) never pull the model client into the bundle.
 * Only reached when `NOVA_EMBEDDINGS=gateway` AND a gateway key is configured.
 */
async function embedViaGateway(texts: string[]): Promise<number[][]> {
  const { embedMany } = await import("ai");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += GATEWAY_BATCH) {
    const slice = texts.slice(i, i + GATEWAY_BATCH);
    const { embeddings } = await embedMany({ model: EMBED_MODEL, values: slice });
    out.push(...embeddings.map(normalize));
  }
  return out;
}
