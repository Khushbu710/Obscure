import { randomBytes } from "node:crypto";
import type { BlockchainTxRequest, BlockchainTxResult } from "@obscura/contracts";

/**
 * The narrow interface Developer 1's real Zcash adapter (zcash-devtool
 * wrapper) must implement. Deliberately minimal - exactly the shared
 * `BlockchainTxRequestSchema` in -> `BlockchainTxResultSchema` out - so the
 * mock used here can be swapped for the real one with no change to
 * SignerService.
 */
export interface BlockchainAdapter {
  signAndBroadcast(request: BlockchainTxRequest): Promise<BlockchainTxResult>;
}

/**
 * NOT real Zcash cryptography. Produces a deterministic, clearly-labeled
 * fake result so SignerService and its tests can be exercised end-to-end
 * before Developer 1's real adapter exists. Never claim a `MockBlockchainAdapter`
 * result is a real signed or broadcast Zcash transaction.
 */
export class MockBlockchainAdapter implements BlockchainAdapter {
  async signAndBroadcast(request: BlockchainTxRequest): Promise<BlockchainTxResult> {
    void request;
    return {
      txId: `mock-${randomBytes(16).toString("hex")}`,
      status: "broadcast",
      confirmations: 0,
    };
  }
}

/**
 * Test/demo double for simulating a definite adapter-layer failure (the
 * adapter itself asserts the transaction was never attempted/broadcast -
 * e.g. a rejected signature, invalid wallet). Distinct from a timeout: this
 * is safe for SignerService to treat as "definitely did not happen" and
 * release the reservation.
 */
export class FailingMockBlockchainAdapter implements BlockchainAdapter {
  constructor(private readonly message = "mock adapter failure") {}

  async signAndBroadcast(): Promise<BlockchainTxResult> {
    throw new Error(this.message);
  }
}

/**
 * Test double for simulating an adapter call that never returns (network
 * partition, hung RPC). Used to exercise SignerService's own timeout path,
 * which treats a timeout as "broadcast outcome unknown" - NOT a definite
 * failure - and must not release the reservation or retry.
 */
export class HangingBlockchainAdapter implements BlockchainAdapter {
  signAndBroadcast(): Promise<BlockchainTxResult> {
    return new Promise(() => {
      // Deliberately never resolves or rejects.
    });
  }
}
