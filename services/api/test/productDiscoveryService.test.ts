import { describe, expect, it, vi } from "vitest";
import { BitrefillClient } from "@obscura/bitrefill-client";
import { ProductDiscoveryService } from "../src/bitrefill/productDiscoveryService.js";

const PRODUCT_DETAIL_RESPONSE = {
  data: {
    id: "bitrefill-esim-japan",
    name: "Japan eSIM",
    currency: "USD",
    packages: [
      { package_id: "bitrefill-esim-japan<&>5gb", value: "5GB, 30 Days", price: 12.5 },
      { package_id: "bitrefill-esim-japan<&>10gb", value: "10GB, 30 Days", price: 19.99 },
    ],
  },
};

const PRODUCT_LIST_RESPONSE = { data: [PRODUCT_DETAIL_RESPONSE.data] };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function clientWithFixture(response: unknown) {
  const fetchImpl = vi.fn(async () => jsonResponse(response)) as unknown as typeof fetch;
  return new BitrefillClient({ apiKey: "test-key", fetchImpl });
}

describe("ProductDiscoveryService", () => {
  it("searchEsims returns normalized internal Products, one per package", async () => {
    const service = new ProductDiscoveryService(clientWithFixture(PRODUCT_LIST_RESPONSE));
    const products = await service.searchEsims("japan");
    expect(products).toHaveLength(2);
    expect(products[0].category).toBe("esim");
    expect(products[0].priceMinor).toBe(1250);
  });

  it("getVerifiedPriceMinor fetches a fresh price for the exact package referenced", async () => {
    const service = new ProductDiscoveryService(clientWithFixture(PRODUCT_DETAIL_RESPONSE));
    const products = await service.getProductDetails("bitrefill-esim-japan");
    const merchantProductId = products[0].merchantProductId;

    const verifyService = new ProductDiscoveryService(clientWithFixture(PRODUCT_DETAIL_RESPONSE));
    const verified = await verifyService.getVerifiedPriceMinor(merchantProductId);
    expect(verified).toBe(1250);
  });

  it("getVerifiedPriceMinor returns null when the package no longer exists (fail-closed signal)", async () => {
    const service = new ProductDiscoveryService(clientWithFixture(PRODUCT_DETAIL_RESPONSE));
    const verified = await service.getVerifiedPriceMinor("bitrefill-esim-japan::does-not-exist");
    expect(verified).toBeNull();
  });

  it("does not expose any invoice-creation capability on its public surface", () => {
    const service = new ProductDiscoveryService(clientWithFixture(PRODUCT_LIST_RESPONSE));
    expect((service as unknown as Record<string, unknown>).createEsimInvoice).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).createInvoiceForOrder).toBeUndefined();
  });
});
