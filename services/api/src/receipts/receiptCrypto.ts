import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ReceiptPayload } from "@obscura/contracts";

/**
 * Receipt cryptography. To be exact about what this is (demo-scope.md
 * section 4): a SHA-256 hash commitment plus an Ed25519 signature over it.
 * It is NOT a zero-knowledge proof - selective disclosure means revealing
 * one receipt's fields and salt so a verifier can recompute the hash and
 * check the signature.
 */

/**
 * commitment = SHA256(orderId || priceMinor || merchantId || timestamp || salt || settlementMode)
 * (payment-flow.md section 5). Fields are length-prefixed ("<len>:<value>")
 * before hashing so no choice of field contents can make two different
 * receipts concatenate to the same bytes. `currency` is deliberately NOT in
 * the committed tuple, to match the documented scheme exactly.
 */
export function computeCommitment(p: Pick<ReceiptPayload, "orderId" | "priceMinor" | "merchantId" | "timestamp" | "salt" | "settlementMode">): string {
  const fields = [p.orderId, String(p.priceMinor), p.merchantId, p.timestamp, p.salt, p.settlementMode];
  const preimage = fields.map((f) => `${Buffer.byteLength(f, "utf8")}:${f}`).join("");
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

export function signCommitment(commitmentHex: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(commitmentHex, "hex"), privateKey).toString("hex");
}

export function verifyCommitmentSignature(commitmentHex: string, signatureHex: string, publicKey: KeyObject): boolean {
  try {
    return verify(null, Buffer.from(commitmentHex, "hex"), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** Public-key import for standalone verifiers (SPKI DER, base64). */
export function publicKeyFromBase64(spkiB64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(spkiB64, "base64"), format: "der", type: "spki" });
}

export interface Disclosure {
  commitment: string;
  signature: string;
  disclosedFields: ReceiptPayload;
}

/**
 * Independent verification of a disclosure artifact: recompute the
 * commitment from the revealed fields, require it to equal the claimed
 * commitment, then check the signature. Needs nothing from the OBSCURA
 * backend except its public key.
 */
export function verifyDisclosure(d: Disclosure, publicKey: KeyObject): { valid: boolean; reason?: string } {
  if (computeCommitment(d.disclosedFields) !== d.commitment) return { valid: false, reason: "COMMITMENT_MISMATCH" };
  if (!verifyCommitmentSignature(d.commitment, d.signature, publicKey)) return { valid: false, reason: "BAD_SIGNATURE" };
  return { valid: true };
}

/** AES-256-GCM. Output is base64(iv[12] || tag[16] || ciphertext). */
export function encryptPayload(payload: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptPayload<T>(encryptedB64: string, key: Buffer): T {
  const raw = Buffer.from(encryptedB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
}

/**
 * The receipt service's own keys: an Ed25519 signing key and an AES key for
 * the stored payloads. Neither is a wallet key, and neither is ever logged.
 */
export class ReceiptKeyring {
  private constructor(
    readonly signingKey: KeyObject,
    readonly publicKey: KeyObject,
    readonly encryptionKey: Buffer,
    readonly persistent: boolean,
  ) {}

  /** Throwaway keys: receipts created with them cannot be read or verified after a restart. Tests and un-configured dev only. */
  static ephemeral(): ReceiptKeyring {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return new ReceiptKeyring(privateKey, publicKey, randomBytes(32), false);
  }

  /** Loads the key file, or creates it on first use. The file holds secrets: it must stay out of git. */
  static fromFile(path: string): ReceiptKeyring {
    if (!existsSync(path)) {
      const { privateKey } = generateKeyPairSync("ed25519");
      const stored = {
        signingKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
        encryptionKey: randomBytes(32).toString("base64"),
      };
      writeFileSync(path, JSON.stringify(stored), { mode: 0o600 });
    }
    const stored = JSON.parse(readFileSync(path, "utf8")) as { signingKeyPkcs8: string; encryptionKey: string };
    const signingKey = createPrivateKey({ key: Buffer.from(stored.signingKeyPkcs8, "base64"), format: "der", type: "pkcs8" });
    const encryptionKey = Buffer.from(stored.encryptionKey, "base64");
    if (encryptionKey.length !== 32) throw new Error("RECEIPT_KEYS: encryption key must be 32 bytes");
    return new ReceiptKeyring(signingKey, createPublicKey(signingKey), encryptionKey, true);
  }

  publicKeyBase64(): string {
    return this.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  }
}
