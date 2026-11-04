/**
 * Typed frontend wallet-service boundary.
 *
 * OWNERSHIP: Developer 1 owns the Zcash adapter. As of this implementation,
 * `packages/zcash-adapter/` does not exist in this repository at all - no
 * types.ts, no mock.ts were found to inspect, despite being referenced as
 * "draft files." This interface is therefore an ASSUMED shape based only on
 * the operation names given in the task brief
 * (createWallet, getAddress, sync, getBalance, send, getTxStatus), not a
 * verified contract. Do not treat it as agreed.
 *
 * There is also no `/fund` or `/envelope` backend HTTP endpoint - Developer
 * 1 has proposed the adapter remain library-only with the frontend calling
 * such endpoints once they exist. This file defines the shape the Wallet
 * page codes against so it can be wired up later without a rewrite; it
 * currently has exactly one implementation, `UnimplementedWalletService`,
 * which always reports "unavailable" rather than fabricating a balance,
 * address, or transaction.
 */

export type WalletTxStatus =
  | "pending"
  | "broadcast"
  | "mined"
  | "confirmed"
  | "failed";
// NOTE: "seen" is Developer 1's proposed addition to this enum (and to the
// shared BlockchainTxStatus in packages/contracts) - not yet agreed, not
// included here. See docs/architecture/data-models.md §8 discussion.

export interface WalletTransaction {
  txId: string;
  type: "deposit" | "purchase";
  amountZatoshi: number;
  status: WalletTxStatus;
  confirmations?: number;
  timestamp: string;
}

export interface WalletState {
  initialized: boolean;
  address: string | null;
  balanceZatoshi: number | null;
  syncing: boolean;
  transactions: WalletTransaction[];
}

export interface WalletService {
  isAvailable(): boolean;
  getState(): Promise<WalletState>;
}

/**
 * The only real implementation right now. Every method reports the feature
 * as unavailable - this is deliberate honesty, not a stub left unfinished
 * by accident. See apps/web/src/features/wallet/WalletPage.tsx for how the
 * UI renders this.
 */
export class UnimplementedWalletService implements WalletService {
  isAvailable(): boolean {
    return false;
  }

  async getState(): Promise<WalletState> {
    return { initialized: false, address: null, balanceZatoshi: null, syncing: false, transactions: [] };
  }
}

export const walletService: WalletService = new UnimplementedWalletService();
