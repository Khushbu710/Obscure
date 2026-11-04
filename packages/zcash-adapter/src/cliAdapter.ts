import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BlockchainTxRequest, BlockchainTxResult } from "@obscura/contracts";
import type { WalletBalance, WalletInfo, ZcashAdapter } from "./adapter.js";

const execFileAsync = promisify(execFile);

export type CommandRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface CliAdapterOptions {
  /** Path to the zcash-devtool executable. */
  binaryPath: string;
  /** Directory under which each wallet gets its own subdirectory. */
  walletsRoot: string;
  network?: "test" | "main";
  /** Blocks (including the mining block) before a transaction counts as `confirmed`. Default 3. */
  confirmationsRequired?: number;
  /** Injection point for tests. */
  runner?: CommandRunner;
}

/** Only allow simple labels so a label can never escape walletsRoot. */
const LABEL_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TXID_RE = /^[0-9a-f]{64}$/;
/** Fees to try, in order, when sweeping (ZIP-317 is 5000 zatoshi per logical action). */
const SWEEP_FEE_CANDIDATES = [10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000];

/**
 * zcash-devtool-backed adapter. Every parser below was written against real
 * output captured from the live Zcash testnet (testnet.zec.rocks, Ironwood
 * pool) on 2026-11-04 - see the fixtures in test/cliAdapter.test.ts.
 *
 * walletRef is the label, never a path. Errors never include paths, stderr, or
 * any command output that might contain key material.
 */
export class CliZcashAdapter implements ZcashAdapter {
  private readonly run: CommandRunner;
  private readonly confirmationsRequired: number;

  constructor(private readonly opts: CliAdapterOptions) {
    this.run = opts.runner ?? (async (args) => execFileAsync(opts.binaryPath, args, { maxBuffer: 10 * 1024 * 1024 }));
    this.confirmationsRequired = opts.confirmationsRequired ?? 3;
  }

  private dirFor(walletRef: string): string {
    if (!LABEL_RE.test(walletRef)) throw new Error("INVALID_WALLET_REF");
    return path.join(this.opts.walletsRoot, walletRef);
  }

  private identityFor(walletRef: string): string {
    return `${this.dirFor(walletRef)}.identity.txt`;
  }

  async createWallet(label: string): Promise<WalletInfo> {
    const dir = this.dirFor(label);
    await mkdir(this.opts.walletsRoot, { recursive: true });
    await this.run(["wallet", "-w", dir, "init", "--name", label, "-i", this.identityFor(label), "-n", this.opts.network ?? "test"]);
    return { walletRef: label, address: await this.getAddress(label) };
  }

  async getAddress(walletRef: string): Promise<string> {
    const { stdout } = await this.run(["wallet", "-w", this.dirFor(walletRef), "list-addresses"]);
    return parseDefaultAddress(stdout);
  }

  async sync(walletRef: string): Promise<void> {
    await this.run(["wallet", "-w", this.dirFor(walletRef), "sync"]);
  }

  async getBalance(walletRef: string): Promise<WalletBalance> {
    const { stdout } = await this.run(["wallet", "-w", this.dirFor(walletRef), "balance", "--json"]);
    return parseBalanceJson(stdout);
  }

  /**
   * Sends to exactly one recipient (`wallet send` takes one address). Returns
   * once the transaction has been broadcast; confirmation is tracked
   * separately via getTxStatus. Throws only on a definitive failure.
   */
  async send(request: BlockchainTxRequest): Promise<BlockchainTxResult> {
    if (request.outputs.length !== 1) throw new Error("UNSUPPORTED: exactly one output per send");
    const [out] = request.outputs;
    const dir = this.dirFor(request.walletRef);
    const args = ["wallet", "-w", dir, "send", "-i", this.identityFor(request.walletRef), "--address", out!.address, "--value", String(out!.amountZatoshi)];
    if (request.memo) args.push("--memo", request.memo);
    return this.sendWith(args);
  }

  async getTxStatus(walletRef: string, txId: string): Promise<BlockchainTxResult> {
    const dir = this.dirFor(walletRef);
    const { stdout } = await this.run(["wallet", "-w", dir, "list-tx"]);
    const tx = parseListTx(stdout).get(txId);
    if (!tx) throw new Error("TX_NOT_FOUND");
    if (tx.minedHeight === null) return { txId, status: "broadcast", confirmations: 0 };
    const info = await this.run(["wallet", "-w", dir, "get-info"]);
    const confirmations = Math.max(0, parseChainTip(info.stdout) - tx.minedHeight + 1);
    return { txId, status: confirmations >= this.confirmationsRequired ? "confirmed" : "mined", confirmations };
  }

  /**
   * Sends the whole spendable balance (minus the ZIP-317 fee) to `toAddress`.
   * The exact fee depends on the transaction shape, so candidate fees are
   * tried against a read-only `propose` first; nothing is built until one fits.
   */
  async sweep(walletRef: string, toAddress: string): Promise<BlockchainTxResult> {
    const dir = this.dirFor(walletRef);
    const { spendableZatoshi } = await this.getBalance(walletRef);
    for (const fee of SWEEP_FEE_CANDIDATES) {
      const value = spendableZatoshi - fee;
      if (value <= 0) break;
      const base = ["wallet", "-w", dir];
      const noSplit = ["--target-note-count", "1"];
      try {
        await this.run([...base, "propose", "--address", toAddress, "--value", String(value), ...noSplit]);
      } catch {
        continue; // this fee leaves too little: try a larger fee
      }
      return this.sendWith([...base, "send", "-i", this.identityFor(walletRef), "--address", toAddress, "--value", String(value), ...noSplit]);
    }
    throw new Error("NOTHING_TO_SWEEP");
  }

  private async sendWith(args: string[]): Promise<BlockchainTxResult> {
    let stdout: string;
    try {
      ({ stdout } = await this.run(args));
    } catch (e) {
      const text = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}${e instanceof Error ? e.message : ""}`;
      // Fixed codes only - never echo tool output (it can contain paths).
      throw new Error(/insufficient/i.test(text) ? "INSUFFICIENT_FUNDS" : "SEND_FAILED");
    }
    const txId = parseSendTxId(stdout);
    return { txId, status: "broadcast", confirmations: 0 };
  }
}

export function parseDefaultAddress(output: string): string {
  const m = output.match(/Default Address:\s*(\S+)/) ?? output.match(/Address:\s*(u(?:test)?1\S+)/);
  if (!m) throw new Error("ADDRESS_PARSE_FAILED");
  return m[1]!;
}

export function parseBalanceJson(output: string): WalletBalance {
  // The tool logs to stderr, but be tolerant: take the last JSON-looking line.
  const line = output.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  if (!line) throw new Error("BALANCE_PARSE_FAILED");
  const j = JSON.parse(line) as Record<string, unknown>;
  const n = (k: string) => (typeof j[k] === "number" ? (j[k] as number) : 0);
  const spendable = n("ironwood_spendable") + n("orchard_spendable") + n("sapling_spendable") + n("transparent_spendable");
  return { spendableZatoshi: spendable, totalZatoshi: n("total") };
}

/** `wallet send` prints the txid (64 hex chars) as its final line. */
export function parseSendTxId(output: string): string {
  const id = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => TXID_RE.test(l));
  if (!id) throw new Error("SEND_PARSE_FAILED");
  return id;
}

export interface ListedTx {
  txId: string;
  /** null while the transaction is known to the wallet but not yet mined. */
  minedHeight: number | null;
}

/** Parses `wallet list-tx`: each transaction starts with a bare 64-hex txid line, followed by an indented `Mined: <height> (...)` line once mined. */
export function parseListTx(output: string): Map<string, ListedTx> {
  const txs = new Map<string, ListedTx>();
  let current: ListedTx | null = null;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (TXID_RE.test(line) && raw === raw.trimStart()) {
      current = { txId: line, minedHeight: null };
      txs.set(line, current);
      continue;
    }
    const mined = current ? line.match(/^Mined:\s*(\d+)/) : null;
    if (current && mined) current.minedHeight = Number(mined[1]);
  }
  return txs;
}

export function parseChainTip(output: string): number {
  const line = output.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  if (!line) throw new Error("INFO_PARSE_FAILED");
  const h = (JSON.parse(line) as { chain_tip_height?: unknown }).chain_tip_height;
  if (typeof h !== "number") throw new Error("INFO_PARSE_FAILED");
  return h;
}
