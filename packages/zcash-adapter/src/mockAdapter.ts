import { randomBytes } from "node:crypto";
import type { BlockchainTxRequest, BlockchainTxResult } from "@obscura/contracts";
import type { WalletBalance, WalletInfo, ZcashAdapter } from "./adapter.js";

/** In-memory fake for development. Never presented as real chain data. */
export class MockZcashAdapter implements ZcashAdapter {
  private readonly wallets = new Map<string, { address: string; balance: number }>();
  private readonly txs = new Map<string, BlockchainTxResult>();

  async createWallet(label: string): Promise<WalletInfo> {
    const walletRef = `mock:${label}:${randomBytes(4).toString("hex")}`;
    const address = `utest1mock${randomBytes(8).toString("hex")}`;
    this.wallets.set(walletRef, { address, balance: 0 });
    return { walletRef, address };
  }

  async getAddress(walletRef: string): Promise<string> {
    return this.require(walletRef).address;
  }

  async sweep(walletRef: string, _toAddress: string): Promise<BlockchainTxResult> {
    const wallet = this.require(walletRef);
    const MOCK_FEE = 10_000;
    if (wallet.balance <= MOCK_FEE) throw new Error("NOTHING_TO_SWEEP");
    wallet.balance = 0;
    const result: BlockchainTxResult = { txId: randomBytes(32).toString("hex"), status: "broadcast", confirmations: 0 };
    this.txs.set(result.txId, result);
    return result;
  }

  /** Test helper standing in for a faucet / funding tx. */
  credit(walletRef: string, zatoshi: number): void {
    this.require(walletRef).balance += zatoshi;
  }

  async getBalance(walletRef: string): Promise<WalletBalance> {
    const b = this.require(walletRef).balance;
    return { spendableZatoshi: b, totalZatoshi: b };
  }

  async sync(walletRef: string): Promise<void> {
    this.require(walletRef);
  }

  async send(request: BlockchainTxRequest): Promise<BlockchainTxResult> {
    const wallet = this.require(request.walletRef);
    const total = request.outputs.reduce((s, o) => s + o.amountZatoshi, 0);
    if (total > wallet.balance) throw new Error("INSUFFICIENT_FUNDS");
    wallet.balance -= total;
    const result: BlockchainTxResult = { txId: randomBytes(32).toString("hex"), status: "broadcast", confirmations: 0 };
    this.txs.set(result.txId, result);
    return result;
  }

  async getTxStatus(_walletRef: string, txId: string): Promise<BlockchainTxResult> {
    const tx = this.txs.get(txId);
    if (!tx) throw new Error("TX_NOT_FOUND");
    return tx;
  }

  private require(walletRef: string) {
    const w = this.wallets.get(walletRef);
    if (!w) throw new Error("WALLET_NOT_FOUND");
    return w;
  }
}
