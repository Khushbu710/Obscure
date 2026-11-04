import { describe, expect, it } from "vitest";
import { CliZcashAdapter, parseBalanceJson, parseDefaultAddress } from "../src/index.js";

// Fixtures captured from the live testnet run on 2026-11-04.
const BALANCE = '{"chain_tip_height":4582088,"ironwood_spendable":0,"orchard_spendable":0,"sapling_spendable":0,"total":0,"transparent_spendable":0}';
const ADDRS = "Account AccountUuid(729a)\n     Default Address: utest15yn6t9xvfys7\n";

describe("parsers", () => {
  it("parses balance JSON and sums spendable pools", () => {
    const b = parseBalanceJson(`noise\n${BALANCE.replace('"ironwood_spendable":0', '"ironwood_spendable":12500000').replace('"total":0', '"total":12500000')}`);
    expect(b).toEqual({ spendableZatoshi: 12500000, totalZatoshi: 12500000 });
  });
  it("parses the default address", () => {
    expect(parseDefaultAddress(ADDRS)).toBe("utest15yn6t9xvfys7");
  });
  it("fails loudly on garbage", () => {
    expect(() => parseBalanceJson("nope")).toThrow("BALANCE_PARSE_FAILED");
  });
});

describe("CliZcashAdapter", () => {
  it("rejects wallet refs that could escape the wallets root", async () => {
    const a = new CliZcashAdapter({ binaryPath: "x", walletsRoot: "/w", runner: async () => ({ stdout: "", stderr: "" }) });
    await expect(a.getBalance("../evil")).rejects.toThrow("INVALID_WALLET_REF");
  });
  it("reads balance via the runner", async () => {
    const calls: string[][] = [];
    const a = new CliZcashAdapter({ binaryPath: "x", walletsRoot: "/w", runner: async (args) => (calls.push(args), { stdout: BALANCE, stderr: "" }) });
    expect((await a.getBalance("m1")).spendableZatoshi).toBe(0);
    expect(calls[0]).toContain("--json");
  });
});
