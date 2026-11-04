import { createHmac } from "node:crypto";

export class SignerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerUnavailableError";
  }
}

export type WalletOpResult<T> = ({ ok: true } & T) | { ok: false; code: string; reason: string };

export interface EnvelopeInfo {
  walletRef: string;
  receivingAddress: string;
}
export interface EnvelopeStatus extends EnvelopeInfo {
  spendableZatoshi: number;
  totalZatoshi: number;
  funded: boolean;
}
export interface SweepResult {
  tx: { txId: string; status: string; confirmations?: number };
}

export interface TxView {
  txId: string;
  status: "pending" | "broadcast" | "mined" | "confirmed" | "failed";
  confirmations?: number;
}

/** The signer's answer to /sign. `txId` is the transaction the wallet actually broadcast (additive contract field). */
export type SignOutcome =
  | { signed: true; txProposal: { walletRef: string; outputs: Array<{ address: string; amountZatoshi: number }>; memo: string | null }; signedAt: string; txId?: string }
  | { signed: false; code: string; reason: string };

/**
 * The backend's ONLY view of the signer. It carries mandate ids and gets
 * back addresses/balances - never key material. Tests inject a fake.
 */
export interface SignerGateway {
  createEnvelope(mandateId: string): Promise<WalletOpResult<EnvelopeInfo>>;
  envelopeStatus(mandateId: string): Promise<WalletOpResult<EnvelopeStatus>>;
  sweep(mandateId: string): Promise<WalletOpResult<SweepResult>>;
  /** Asks the signer to independently re-validate and pay one authorized order. */
  sign(request: { authorizationToken: string; order: unknown; destinationAddress: string; amountZatoshi: number }): Promise<SignOutcome>;
  /** Read-only confirmation lookup for a signed order's transaction. */
  txStatus(orderId: string, txId: string): Promise<WalletOpResult<{ tx: TxView }>>;
}

/**
 * HMAC-signs the exact JSON body (header `x-signer-signature`), matching
 * apps/signer/src/auth.ts. The signer's own 4xx answers for business rules
 * (e.g. 409 MANDATE_NOT_ACTIVE) carry `{ok:false,...}` and are returned as
 * values; transport/auth/wallet failures (401/400/502/network) throw.
 */
export class HttpSignerClient implements SignerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly authSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const raw = JSON.stringify(body);
    const signature = createHmac("sha256", this.authSecret).update(raw).digest("hex");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signer-signature": signature },
        body: raw,
      });
    } catch {
      throw new SignerUnavailableError("Signer unreachable");
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SignerUnavailableError(`Signer returned a non-JSON response (${res.status})`);
    }
    // Both wallet results ({ok}) and sign outcomes ({signed}) are legitimate
    // business answers, even on 4xx; anything else (401, 400, 502) is a transport-level failure.
    const isResult = typeof json === "object" && json !== null && ("ok" in json || "signed" in json);
    if (!isResult) throw new SignerUnavailableError(`Signer error (${res.status})`);
    return json as T;
  }

  sign(request: { authorizationToken: string; order: unknown; destinationAddress: string; amountZatoshi: number }) {
    return this.post<SignOutcome>("/sign", request);
  }
  txStatus(orderId: string, txId: string) {
    return this.post<WalletOpResult<{ tx: TxView }>>("/tx/status", { orderId, txId });
  }

  createEnvelope(mandateId: string) {
    return this.post<WalletOpResult<EnvelopeInfo>>("/wallets/create", { mandateId });
  }
  envelopeStatus(mandateId: string) {
    return this.post<WalletOpResult<EnvelopeStatus>>("/wallets/status", { mandateId });
  }
  sweep(mandateId: string) {
    return this.post<WalletOpResult<SweepResult>>("/wallets/sweep", { mandateId });
  }
}
