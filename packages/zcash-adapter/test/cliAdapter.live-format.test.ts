import { describe, expect, it } from "vitest";
import { CliZcashAdapter, parseChainTip, parseListTx, parseSendTxId, type CommandRunner } from "../src/index.js";

// Fixtures captured VERBATIM from real zcash-devtool runs against the live
// Zcash testnet (testnet.zec.rocks, Ironwood pool) on 2026-11-04.
const SEND_OUTPUT = `Creating transaction...
Proposed transfer:
  Min target height: 4582328
  Fee rule: Zip317
  Fee:   0.00025000 TAZ
Sending transaction...
3edb8a5f2efad42b85e7d1bb9b4ee1af9bb0083954a121985911f0a71ffb4dfa
`;

const LIST_TX_OUTPUT = `Transactions:
a58b9ce674f7f4212432f6a95fefe891b0c35f88d7ccd55863a098c449812660
     Mined: 4582318 (2026-11-04 14:25:56.0 +00:00:00)
    Amount:   1.00000000 TAZ
  Fee paid: Unknown
  Sent 0 notes, received 1 notes, 0 memos
  Output 0 (Ironwood)
    Value:   1.00000000 TAZ
3edb8a5f2efad42b85e7d1bb9b4ee1af9bb0083954a121985911f0a71ffb4dfa
     Mined: 4582329 (2026-11-04 14:30:28.0 +00:00:00)
    Amount:   0.30025000 TAZ
  Fee paid:   0.00025000 TAZ
  Sent 1 notes, received 0 notes, 0 memos
  Output 0 (Ironwood)
    Value:   0.30000000 TAZ
`;
const GET_INFO = '{"chain_name":"test","chain_tip_height":4582331,"server_uri":"https://testnet.zec.rocks:443"}';

const TX = "3edb8a5f2efad42b85e7d1bb9b4ee1af9bb0083954a121985911f0a71ffb4dfa";

describe("parsers against real captured output", () => {
  it("extracts the txid from `wallet send` output", () => {
    expect(parseSendTxId(SEND_OUTPUT)).toBe(TX);
    expect(() => parseSendTxId("Creating transaction...\nerror")).toThrow("SEND_PARSE_FAILED");
  });
  it("parses list-tx into txid -> mined height", () => {
    const txs = parseListTx(LIST_TX_OUTPUT);
    expect(txs.size).toBe(2);
    expect(txs.get(TX)?.minedHeight).toBe(4582329);
    expect(parseListTx(`Transactions:\n${TX}\n    Amount: 0.1 TAZ\n`).get(TX)?.minedHeight).toBeNull(); // known but unmined
  });
  it("parses the chain tip", () => {
    expect(parseChainTip(GET_INFO)).toBe(4582331);
  });
});

function adapter(handler: (args: string[]) => string | Error) {
  const calls: string[][] = [];
  const runner: CommandRunner = async (args) => {
    calls.push(args);
    const out = handler(args);
    if (out instanceof Error) throw out;
    return { stdout: out, stderr: "" };
  };
  return { calls, a: new CliZcashAdapter({ binaryPath: "x", walletsRoot: "/w", runner, confirmationsRequired: 3 }) };
}

describe("CliZcashAdapter send / status / sweep", () => {
  it("send builds the exact devtool command and returns a broadcast result", async () => {
    const { a, calls } = adapter(() => SEND_OUTPUT);
    const r = await a.send({ walletRef: "env1", outputs: [{ address: "utest1dest", amountZatoshi: 30_000_000 }], memo: null });
    expect(r).toEqual({ txId: TX, status: "broadcast", confirmations: 0 });
    expect(calls[0]).toEqual(expect.arrayContaining(["send", "--address", "utest1dest", "--value", "30000000"]));
    expect(calls[0]).not.toContain("--memo");
  });

  it("refuses multi-output sends (the tool takes one recipient)", async () => {
    const { a } = adapter(() => SEND_OUTPUT);
    await expect(
      a.send({ walletRef: "env1", outputs: [{ address: "a", amountZatoshi: 1 }, { address: "b", amountZatoshi: 1 }], memo: null }),
    ).rejects.toThrow("UNSUPPORTED");
  });

  it("maps an insufficient-funds failure to a fixed code and never echoes tool output", async () => {
    const err = Object.assign(new Error("failed"), { stderr: "Error: Insufficient balance (have 1, need 2) in C:\\secret\\wallet" });
    const { a } = adapter(() => err);
    const p = a.send({ walletRef: "env1", outputs: [{ address: "a", amountZatoshi: 1 }], memo: null });
    await expect(p).rejects.toThrow("INSUFFICIENT_FUNDS");
    await p.catch((e: Error) => expect(e.message).not.toContain("secret"));
  });

  it("reports broadcast -> mined -> confirmed from list-tx + chain tip", async () => {
    const mk = (list: string, info: string) => adapter((args) => (args.includes("list-tx") ? list : info)).a;
    expect(await mk(`Transactions:\n${TX}\n    Amount: 1 TAZ\n`, GET_INFO).getTxStatus("env1", TX)).toMatchObject({ status: "broadcast", confirmations: 0 });
    expect(await mk(LIST_TX_OUTPUT, '{"chain_tip_height":4582330}').getTxStatus("env1", TX)).toMatchObject({ status: "mined", confirmations: 2 });
    expect(await mk(LIST_TX_OUTPUT, GET_INFO).getTxStatus("env1", TX)).toMatchObject({ status: "confirmed", confirmations: 3 });
    await expect(mk("Transactions:\n", GET_INFO).getTxStatus("env1", TX)).rejects.toThrow("TX_NOT_FOUND");
  });

  it("sweep proposes with increasing fees first and only sends once one fits", async () => {
    const proposeValues: string[] = [];
    const { a, calls } = adapter((args) => {
      if (args.includes("balance")) return '{"ironwood_spendable":100000,"total":100000}';
      if (args.includes("propose")) {
        const v = args[args.indexOf("--value") + 1]!;
        proposeValues.push(v);
        return Number(v) > 85_000 ? new Error("insufficient for fee") : "Proposal:";
      }
      return SEND_OUTPUT;
    });
    const r = await a.sweep("env1", "utest1user");
    expect(r.txId).toBe(TX);
    expect(proposeValues).toEqual(["90000", "85000"]); // 10000 fee too small, 15000 fits
    const sendCall = calls.find((c) => c.includes("send"))!;
    expect(sendCall[sendCall.indexOf("--value") + 1]).toBe("85000");
  });

  it("sweep of a dust balance throws NOTHING_TO_SWEEP and sends nothing", async () => {
    const { a, calls } = adapter((args) => (args.includes("balance") ? '{"ironwood_spendable":5000,"total":5000}' : "x"));
    await expect(a.sweep("env1", "utest1user")).rejects.toThrow("NOTHING_TO_SWEEP");
    expect(calls.some((c) => c.includes("send"))).toBe(false);
  });
});
