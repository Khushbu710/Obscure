import { describe, expect, it } from "vitest";
import { BitrefillClient } from "@obscura/bitrefill-client";

/**
 * REAL, LIVE Bitrefill API integration test. Only runs if BITREFILL_API_KEY
 * is set in the environment - no credentials were available at the time
 * this client was built (see verification-matrix.md / the Phase E report),
 * so this suite is SKIPPED, not passing, in that case. Do not interpret a
 * green run of the rest of the suite as evidence this test ran.
 */
const apiKey = process.env.BITREFILL_API_KEY;

describe.skipIf(!apiKey)("Bitrefill live API (requires BITREFILL_API_KEY)", () => {
  it("pings the real API and gets a real eSIM product list", async () => {
    const client = new BitrefillClient({ apiKey: apiKey! });
    const ping = await client.ping();
    expect(ping.message).toBe("pong");

    const products = await client.listEsimProducts({ limit: 1 });
    expect(Array.isArray(products)).toBe(true);
  });
});
