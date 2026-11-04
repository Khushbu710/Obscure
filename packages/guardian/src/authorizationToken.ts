import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthorizationTokenPayload {
  orderId: string;
  nonce: string;
  mandateId: string;
  /** epoch milliseconds */
  expiresAt: number;
}

const TOKEN_TTL_MS = 90_000; // 90s, per docs/architecture/data-models.md §5

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("hex");
}

export function issueAuthorizationToken(
  payload: Omit<AuthorizationTokenPayload, "expiresAt">,
  secret: string,
  nowMs: number,
): string {
  const full: AuthorizationTokenPayload = { ...payload, expiresAt: nowMs + TOKEN_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export type TokenVerification =
  | { valid: true; payload: AuthorizationTokenPayload }
  | { valid: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

/**
 * Verifies ONLY that the token is well-formed, unexpired, and was issued by
 * a holder of `secret`. This is a transport-binding check, nothing more -
 * the signer must still independently re-validate the order against live
 * mandate state (see security-architecture.md §3). Never treat a valid
 * token as sufficient on its own.
 */
export function verifyAuthorizationToken(token: string, secret: string, nowMs: number): TokenVerification {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "MALFORMED" };
  const [payloadB64, signature] = parts;

  const expectedSignature = sign(payloadB64, secret);
  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expectedSignature, "hex");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: "BAD_SIGNATURE" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "MALFORMED" };
  }

  if (!isAuthorizationTokenPayload(decoded)) {
    return { valid: false, reason: "MALFORMED" };
  }
  const payload = decoded;

  if (nowMs > payload.expiresAt) return { valid: false, reason: "EXPIRED" };

  return { valid: true, payload };
}

/**
 * Defense-in-depth: a correctly-signed token could still decode to a
 * malformed shape if something upstream constructs one incorrectly. Never
 * return `valid: true` with fields that aren't actually present/typed
 * correctly - a consumer trusting `payload.orderId` etc. should never see
 * `undefined` silently pass through.
 */
function isAuthorizationTokenPayload(value: unknown): value is AuthorizationTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.orderId === "string" &&
    v.orderId.length > 0 &&
    typeof v.nonce === "string" &&
    v.nonce.length > 0 &&
    typeof v.mandateId === "string" &&
    v.mandateId.length > 0 &&
    typeof v.expiresAt === "number" &&
    Number.isFinite(v.expiresAt)
  );
}
