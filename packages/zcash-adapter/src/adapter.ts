import type { BlockchainTxRequest, BlockchainTxResult } from "@obscura/contracts";

export interface WalletInfo {
  /** Opaque handle (never a filesystem path) - safe to log and store. */
  walletRef: string;
  /** Unified address (utest1... on testnet). */
  address: string;
}

export interface WalletBalance {
  /** Spendable, confirmed zatoshi. */
  spendableZatoshi: number;
  /** Total including unconfirmed/pending. */
  totalZatoshi: number;
}

/**
 * The seam between OBSCURA and Zcash. Implemented by MockZcashAdapter
 * (development) and, once the live PoC proves zcash-devtool is wrappable,
 * a CLI-backed adapter. Implementations MUST NOT log seeds, keys, or
 * wallet directory paths (zcash-integration.md §4).
 */
export interface ZcashAdapter {
  createWallet(label: string): Promise<WalletInfo>;
  getAddress(walletRef: string): Promise<string>;
  getBalance(walletRef: string): Promise<WalletBalance>;
  sync(walletRef: string): Promise<void>;
  send(request: BlockchainTxRequest): Promise<BlockchainTxResult>;
  getTxStatus(walletRef: string, txId: string): Promise<BlockchainTxResult>;
  /**
   * Send the wallet's entire spendable balance (minus the network fee) to
   * `toAddress`. Used only for sweep-back of a revoked/expired envelope.
   * Throws NOTHING_TO_SWEEP if the balance does not cover the fee.
   */
  sweep(walletRef: string, toAddress: string): Promise<BlockchainTxResult>;
}
