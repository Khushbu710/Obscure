import { describe, expect, it } from "vitest";
import { MockZcashAdapter } from "../src/index.js";

describe("MockZcashAdapter", () => {
  it("cannot spend more than it was funded with", async () => {
    const a = new MockZcashAdapter();
    const w = await a.createWallet("m1");
    a.credit(w.walletRef, 1000);
    await expect(a.send({ walletRef: w.walletRef, outputs: [{ address: "x", amountZatoshi: 1001 }], memo: null })).rejects.toThrow("INSUFFICIENT_FUNDS");
    const r = await a.send({ walletRef: w.walletRef, outputs: [{ address: "x", amountZatoshi: 400 }], memo: null });
    expect((await a.getBalance(w.walletRef)).spendableZatoshi).toBe(600);
    expect((await a.getTxStatus(w.walletRef, r.txId)).status).toBe("broadcast");
  });
});
