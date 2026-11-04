import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The exact blockchain-level terms being authorized, cryptographically bound
 * into the token (2026-11-04, signer security review). Before this, the
 * token only bound orderId+nonce+mandateId; destinationAddress/amountZatoshi
 * were caller-supplied and unverifiable by the signer, which is a real
 * authorization gap (sign-once replay protection is not the same thing as
 * proving a specific destination/amount was ever authorized). `null` means
 * "no blockchain terms authorized yet" - the signer must refuse to sign
 * against a token carrying `null` here.
 */
export interface TransactionIntent {
  destinationAddress: string;
  amountZatoshi: number;
}

export interface AuthorizationTokenPayload {
  orderId: string;
  nonce: string;
  mandateId: string;
  transactionIntent: TransactionIntent | null;
  /** epoch milliseconds */
  expiresAt: number;
}

const TOKEN_TTL_MS = 90_000; // 90s, per docs/architecture/data-models.md §5

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("hex");
}

/**
 * `transactionIntent` defaults to `null` so existing callers that don't yet
 * have a canonical destination/amount to bind (no real settlement system
 * exists - see demo-scope.md) keep compiling unchanged; such tokens simply
 * cannot be used to sign anything (the signer rejects a null intent).
 */
export function issueAuthorizationToken(
  payload: Omit<AuthorizationTokenPayload, "expiresAt" | "transactionIntent"> & {
    transactionIntent?: TransactionIntent | null;
  },
  secret: string,
  nowMs: number,
): string {
  const full: AuthorizationTokenPayload = {
    orderId: payload.orderId,
    nonce: payload.nonce,
    mandateId: payload.mandateId,
    transactionIntent: payload.transactionIntent ?? null,
    expiresAt: nowMs + TOKEN_TTL_MS,
  };
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
  // Normalize so the type's promise (`transactionIntent: TransactionIntent | null`,
  // never `undefined`) is actually true at runtime for a pre-existing token
  // that predates this field.
  const payload: AuthorizationTokenPayload = { ...decoded, transactionIntent: decoded.transactionIntent ?? null };

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
  if (
    typeof v.orderId !== "string" ||
    v.orderId.length === 0 ||
    typeof v.nonce !== "string" ||
    v.nonce.length === 0 ||
    typeof v.mandateId !== "string" ||
    v.mandateId.length === 0 ||
    typeof v.expiresAt !== "number" ||
    !Number.isFinite(v.expiresAt)
  ) {
    return false;
  }
  // `transactionIntent` must be `null`/absent (treated the same - a token
  // issued before this field existed, or issued with no bound intent, is
  // simply "no terms authorized yet") or a well-formed TransactionIntent -
  // never silently coerced otherwise, since this is the field the signer's
  // destination/amount binding depends on.
  if (v.transactionIntent === null || v.transactionIntent === undefined) return true;
  if (typeof v.transactionIntent !== "object") return false;
  const intent = v.transactionIntent as Record<string, unknown>;
  return (
    typeof intent.destinationAddress === "string" &&
    intent.destinationAddress.length > 0 &&
    typeof intent.amountZatoshi === "number" &&
    Number.isInteger(intent.amountZatoshi) &&
    intent.amountZatoshi > 0
  );
}
