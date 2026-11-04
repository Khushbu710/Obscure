import type { BlockchainTxRequest, BlockchainTxResult } from "@obscura/contracts";
import type { ZcashAdapter } from "@obscura/zcash-adapter";
import type { BlockchainAdapter } from "./blockchainAdapter.js";
import type { SignerMandateRepository } from "./repositories.js";

/**
 * Plugs the real zcash-devtool adapter into SignerService's narrow
 * `BlockchainAdapter` interface (the swap the interface's own doc comment
 * anticipated), with no change to SignerService.
 *
 * SignerService passes the MANDATE id as `walletRef`. The envelope wallet that
 * actually holds the funds is resolved here, from persisted mandate state,
 * never from the request - so a caller cannot point a payment at some other
 * wallet.
 *
 * Failure semantics matter to SignerService: a THROW here is treated as a
 * definite failure ("never happened") and releases the reservation. So this
 * throws only when nothing was attempted (no envelope) or the CLI reported a
 * definite failure. A hung/slow send is NOT thrown - SignerService's own
 * timeout turns that into BROADCAST_UNCERTAIN, which freezes the order.
 */
export class ZcashBlockchainAdapter implements BlockchainAdapter {
  constructor(
    private readonly zcash: ZcashAdapter,
    private readonly mandates: SignerMandateRepository,
  ) {}

  async signAndBroadcast(request: BlockchainTxRequest): Promise<BlockchainTxResult> {
    const envelope = this.mandates.getEnvelopeInfo(request.walletRef)?.envelopeWalletRef;
    if (!envelope) throw new Error("NO_ENVELOPE");
    return this.zcash.send({ ...request, walletRef: envelope });
  }
}
