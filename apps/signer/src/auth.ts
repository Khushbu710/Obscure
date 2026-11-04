import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 over the exact raw request body, hex-encoded. */
export function signBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyBodySignature(rawBody: string, signatureHex: string | undefined, secret: string): boolean {
  if (!signatureHex) return false;
  const expected = Buffer.from(signBody(rawBody, secret), "hex");
  const given = Buffer.from(signatureHex, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
