/**
 * Route auth + page context for Nova's HTTP channel.
 *
 * `dakioJwt()` is the production authenticator: it verifies a Dakio-signed
 * JWT and stamps the verified `{storeId, role, plan}` onto the session, which
 * is the ONLY source of tenancy (see `lib/tenant.ts`). `localDev()` keeps the
 * eve TUI and REPL working on loopback in development. `placeholderAuth` is
 * gone — this channel fails closed for unauthenticated production traffic.
 *
 * `onMessage` maps the dashboard's `x-dakio-client-context` header into the L4
 * page-context line (see `lib/context/client-context.ts`).
 */

import { eveChannel, defaultEveAuth } from "eve/channels/eve";
import { localDev, extractBearerToken, type AuthFn } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { verifyDakioJwt } from "../lib/auth/dakio-jwt";
import { parseClientContext, renderClientContext } from "../lib/context/client-context";

function dakioJwt(): AuthFn<Request> {
  return async (request) => {
    const token = extractBearerToken(request.headers.get("authorization"));

    // Opt-in dev affordance: run two dev stores on one deployment without a
    // signer by passing the store on a header. Off unless DAKIO_DEV_AUTH=1, so
    // production stays fail-closed.
    if (!token && process.env.DAKIO_DEV_AUTH === "1") {
      const storeId = request.headers.get("x-dakio-store-id");
      if (storeId) {
        return {
          authenticator: "dakio-dev",
          principalId: request.headers.get("x-dakio-user-id") ?? "dev-user",
          principalType: "user",
          attributes: {
            storeId,
            role: request.headers.get("x-dakio-role") ?? "owner",
            plan: request.headers.get("x-dakio-plan") ?? "growth",
          },
        } satisfies SessionAuthContext;
      }
    }

    if (!token) return null; // no Dakio credential → fall through to the next entry
    const claims = verifyDakioJwt(token);
    if (!claims) return null; // invalid → fail closed (next entry, else 401)

    const auth: SessionAuthContext = {
      authenticator: "dakio",
      principalId: claims.sub,
      principalType: "user",
      subject: claims.sub,
      attributes: {
        storeId: claims.storeId,
        // Least privilege: no explicit role claim ⇒ non-owner (trust-plane denied).
        role: typeof claims.role === "string" ? claims.role : "staff",
        plan: typeof claims.plan === "string" ? claims.plan : "starter",
      },
    };
    return claims.iss ? { ...auth, issuer: claims.iss } : auth;
  };
}

/**
 * Browser CORS for the merchant dashboard's chat client. Auth still runs on
 * every session request, and tokens travel in the Authorization header (no
 * cookies), so a permissive default origin is acceptable in dev; deployments
 * narrow it with NOVA_CORS_ORIGINS (comma-separated exact origins). Read at
 * channel-compile time — changing the env var needs a server restart.
 */
function corsFromEnv() {
  const origins = (process.env.NOVA_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    origin: origins.length > 0 ? origins : ("*" as const),
    allowHeaders: ["authorization", "content-type", "x-dakio-client-context"] as const,
    exposeHeaders: ["x-eve-session-id"] as const,
  };
}

export default eveChannel({
  auth: [dakioJwt(), localDev()],
  cors: corsFromEnv(),
  onMessage(ctx, _message) {
    const clientContext = parseClientContext(ctx.eve.request.headers.get("x-dakio-client-context"));
    return {
      auth: defaultEveAuth(ctx),
      ...(clientContext ? { context: [renderClientContext(clientContext)] } : {}),
    };
  },
});
