import { describe, expect, it } from "vitest";
import { BitrefillProductRawSchema } from "../src/types.js";
import { buildMerchantProductId, normalizeEsimProduct, normalizePackages, parseMerchantProductId } from "../src/normalize.js";
import {
  DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE,
  DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES,
} from "./fixtures.js";

describe("normalizePackages - handles both documented shapes", () => {
  it("extracts a single-object packages field (OpenAPI reference shape)", () => {
    const raw = BitrefillProductRawSchema.parse(DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE.data);
    const packages = normalizePackages(raw.packages);
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({ id: "test-gift-card-link<&>10", value: 10, price: 12 });
  });

  it("extracts an array packages field (hand-written guide shape)", () => {
    const raw = BitrefillProductRawSchema.parse(DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES.data);
    const packages = normalizePackages(raw.packages);
    expect(packages).toHaveLength(2);
    expect(packages[0]).toMatchObject({ package_id: "bitrefill-esim-japan<&>5gb", value: "5GB, 30 Days", price: 12.5 });
  });

  it("returns an empty array, never throws, for a missing/null packages field", () => {
    expect(normalizePackages(undefined)).toEqual([]);
    expect(normalizePackages(null)).toEqual([]);
  });

  it("filters out garbage entries that don't look like packages", () => {
    expect(normalizePackages([{ not: "a package" }, { id: "ok", price: 5, value: 1 }])).toHaveLength(1);
  });
});

describe("normalizeEsimProduct", () => {
  it("converts Bitrefill major-unit price to OBSCURA integer minor units", () => {
    const raw = BitrefillProductRawSchema.parse(DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE.data);
    const products = normalizeEsimProduct(raw);
    expect(products).toHaveLength(1);
    expect(products[0].priceMinor).toBe(1200); // $12.00 -> 1200 cents
    expect(Number.isInteger(products[0].priceMinor)).toBe(true);
  });

  it("produces one internal Product per denomination/package", () => {
    const raw = BitrefillProductRawSchema.parse(DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES.data);
    const products = normalizeEsimProduct(raw);
    expect(products).toHaveLength(2);
    expect(products.map((p) => p.priceMinor)).toEqual([1250, 1999]);
  });

  it("always assigns category 'esim' and merchantId 'bitrefill', never from free text", () => {
    const raw = BitrefillProductRawSchema.parse(DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE.data);
    const [product] = normalizeEsimProduct(raw);
    expect(product.category).toBe("esim");
    expect(product.merchantId).toBe("bitrefill");
  });

  it("encodes a recoverable merchantProductId", () => {
    const raw = BitrefillProductRawSchema.parse(DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES.data);
    const [product] = normalizeEsimProduct(raw);
    const { productId, value } = parseMerchantProductId(product.merchantProductId);
    expect(productId).toBe("bitrefill-esim-japan");
    expect(value).toBe("5GB, 30 Days");
  });
});

describe("buildMerchantProductId / parseMerchantProductId round-trip", () => {
  it("round-trips numeric and string values", () => {
    expect(parseMerchantProductId(buildMerchantProductId("prod-a", 25))).toEqual({ productId: "prod-a", value: "25" });
    expect(parseMerchantProductId(buildMerchantProductId("prod-b", "3GB, 30 Days"))).toEqual({
      productId: "prod-b",
      value: "3GB, 30 Days",
    });
  });

  it("throws on a malformed id with no separator", () => {
    expect(() => parseMerchantProductId("no-separator-here")).toThrow();
  });
});
