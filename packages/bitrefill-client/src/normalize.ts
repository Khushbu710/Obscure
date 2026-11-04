import type { Product } from "@obscura/contracts";
import type { BitrefillPackageRaw, BitrefillProductRaw } from "./types.js";

/** Bitrefill, as a merchant, for the eSIM category - not copied from any free-text field. */
export const BITREFILL_MERCHANT_ID = "bitrefill";

const SEPARATOR = "::";

/**
 * Encodes enough information in our internal `merchantProductId` to recover
 * the exact (product_id, value) pair needed to create an invoice later,
 * without inventing any new Bitrefill API field - this is purely an OBSCURA-
 * internal convention.
 */
export function buildMerchantProductId(bitrefillProductId: string, packageValue: string | number): string {
  return `${bitrefillProductId}${SEPARATOR}${packageValue}`;
}

export function parseMerchantProductId(merchantProductId: string): { productId: string; value: string } {
  const idx = merchantProductId.indexOf(SEPARATOR);
  if (idx === -1) {
    throw new Error(`Malformed merchantProductId (missing separator): ${merchantProductId}`);
  }
  return {
    productId: merchantProductId.slice(0, idx),
    value: merchantProductId.slice(idx + SEPARATOR.length),
  };
}

/**
 * Defensive extraction handling the documented inconsistency between
 * Bitrefill's hand-written guide (array of packages, `package_id` field)
 * and its OpenAPI reference (single object, `id` field) - see types.ts's
 * module comment. Never throws on an unexpected shape; returns an empty
 * array and lets the caller decide how to handle "no usable packages"
 * (e.g. skip the product) rather than crashing product search for every
 * other product in the response.
 */
export function normalizePackages(raw: unknown): BitrefillPackageRaw[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.filter((p): p is BitrefillPackageRaw => isPackageLike(p));
  }
  if (isPackageLike(raw)) return [raw];
  if (typeof raw === "object") {
    // Possibly keyed-by-id object form; take the values defensively.
    return Object.values(raw as Record<string, unknown>).filter((p): p is BitrefillPackageRaw => isPackageLike(p));
  }
  return [];
}

function isPackageLike(value: unknown): value is BitrefillPackageRaw {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (typeof v.id === "string" || typeof v.package_id === "string") && typeof v.price === "number";
}

/**
 * One raw Bitrefill product can have multiple denominations/packages, each
 * with its own price - these become distinct internal Products, one per
 * package, since our Product/Order schema carries exactly one price each.
 *
 * Price conversion: Bitrefill documents `price` in major currency units
 * (e.g. 12 for $12.00), confirmed via the OpenAPI reference example
 * (`value: 10, price: 12` for a USD test product). OBSCURA's internal
 * convention is integer minor units (cents) - see data-models.md. We round
 * to the nearest cent; Bitrefill's own documented precision is 2 decimal
 * places for USD-like currencies, so this should not lose information in
 * practice, but this assumption should be re-checked against a live
 * response once credentials are available (see verification-matrix.md).
 */
export function normalizeEsimProduct(raw: BitrefillProductRaw): Product[] {
  const packages = normalizePackages(raw.packages);
  return packages.map((pkg) => {
    const packageId = pkg.id ?? pkg.package_id;
    if (!packageId) {
      // isPackageLike already guarantees one of these is set; this is unreachable
      // but keeps TypeScript honest without a non-null assertion.
      throw new Error("Package missing both id and package_id after normalization");
    }
    return {
      merchantProductId: buildMerchantProductId(raw.id, pkg.value),
      name: `${raw.name} (${pkg.value})`,
      priceMinor: Math.round(pkg.price * 100),
      currency: raw.currency,
      category: "esim",
      merchantId: BITREFILL_MERCHANT_ID,
    } satisfies Product;
  });
}
