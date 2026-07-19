/**
 * Dakio JWT verification — the trust root for tenancy.
 *
 * Tenancy comes ONLY from a Dakio-signed JWT verified here. The dashboard
 * sends `Authorization: Bearer <jwt>`; on success the channel stamps
 * `attributes.{storeId,role,plan}` onto the session, and every tool reads the
 * store from that verified principal (`requireStore`). Model input is never
 * trusted for tenancy.
 *
 * Self-contained (no `jose` dependency): signatures are checked with
 * `node:crypto`. Production verifies asymmetric tokens against Dakio's JWKS
 * public key (`DAKIO_JWT_PUBLIC_KEY`, RS256/ES256); dev uses a shared HMAC
 * secret (`DAKIO_JWT_SECRET`, HS256). With neither configured, verification
 * fails closed. Issuer and audience are pinned when configured.
 */

import { createHmac, createVerify, timingSafeEqual } from "node:crypto";

export interface DakioClaims {
  /** Subject — the founder/staff user id. */
  sub: string;
  storeId: string;
  role: string;
  plan: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  [claim: string]: unknown;
}

export interface DakioJwtConfig {
  /** Expected `iss`; when set, a mismatch rejects. */
  issuer?: string;
  /** Expected `aud`; when set, the token's aud must include it. */
  audience?: string;
  /** HS256 shared secret (dev/test). */
  secret?: string;
  /** RS256/ES256 verification key, PEM (prod, from Dakio JWKS). */
  publicKey?: string;
  /** Allowed clock skew, seconds (default 60). */
  clockToleranceSec?: number;
  /** Override "now" (epoch seconds) — test only. */
  nowSec?: number;
}

function configFromEnv(): DakioJwtConfig {
  return {
    issuer: process.env.DAKIO_JWT_ISSUER,
    audience: process.env.DAKIO_JWT_AUDIENCE,
    secret: process.env.DAKIO_JWT_SECRET,
    publicKey: process.env.DAKIO_JWT_PUBLIC_KEY,
  };
}

function base64urlDecode(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function verifySignature(
  alg: string,
  signingInput: string,
  signature: Buffer,
  config: DakioJwtConfig,
): boolean {
  if (alg === "HS256") {
    if (!config.secret) return false;
    const expected = createHmac("sha256", config.secret).update(signingInput).digest();
    return expected.length === signature.length && timingSafeEqual(expected, signature);
  }
  if (alg === "RS256") {
    if (!config.publicKey) return false;
    return createVerify("RSA-SHA256").update(signingInput).verify(config.publicKey, signature);
  }
  if (alg === "ES256") {
    if (!config.publicKey) return false;
    // ES256 JWT signatures are IEEE-P1363 (r||s), not DER.
    return createVerify("SHA256").update(signingInput).verify(
      { key: config.publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  }
  return false; // unsupported alg (incl. "none") → reject
}

/**
 * Verify a Dakio JWT and return its claims, or `null` if the token is
 * malformed, unsigned/badly-signed, expired, or fails an issuer/audience/
 * storeId check. Never throws on an untrusted token — callers fail closed on
 * `null`.
 */
export function verifyDakioJwt(
  token: string | null | undefined,
  configInput?: DakioJwtConfig,
): DakioClaims | null {
  if (!token) return null;
  const config = { ...configFromEnv(), ...configInput };

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  let claims: DakioClaims;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
    claims = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  const alg = header.alg;
  if (typeof alg !== "string") return null;
  // Require a verification key; with none configured we cannot trust anything.
  if (!config.secret && !config.publicKey) return null;

  const signature = base64urlDecode(signatureB64);
  if (!verifySignature(alg, `${headerB64}.${payloadB64}`, signature, config)) return null;

  const now = config.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = config.clockToleranceSec ?? 60;
  if (typeof claims.exp === "number" && now > claims.exp + skew) return null;
  if (typeof claims.nbf === "number" && now + skew < claims.nbf) return null;

  if (config.issuer && claims.iss !== config.issuer) return null;
  if (config.audience) {
    const aud = claims.aud;
    const ok = Array.isArray(aud) ? aud.includes(config.audience) : aud === config.audience;
    if (!ok) return null;
  }

  // Tenancy is mandatory: a token with no storeId is useless and unsafe.
  if (typeof claims.storeId !== "string" || claims.storeId.length === 0) return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;

  return claims;
}
