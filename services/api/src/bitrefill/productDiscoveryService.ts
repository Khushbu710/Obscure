import {
  BitrefillClient,
  normalizeEsimProduct,
  parseMerchantProductId,
  type BitrefillProductRaw,
} from "@obscura/bitrefill-client";
import type { Product } from "@obscura/contracts";

/**
 * The ONLY Bitrefill-facing surface the AI agent (Phase F) may ever receive.
 * It exposes search and detail-retrieval only - no invoice creation, no
 * payment execution. This is a structural enforcement of
 * security-architecture.md principle 2 ("agent never authorizes payments")
 * and bitrefill-integration.md §2: whoever wires up the agent's tools in
 * Phase F should hand it an instance of THIS class, never a BitrefillClient
 * or InvoiceService instance.
 */
export class ProductDiscoveryService {
  constructor(private readonly client: BitrefillClient) {}

  async searchEsims(query: string, opts: { country?: string; limit?: number } = {}): Promise<Product[]> {
    const rawProducts = await this.client.searchEsimProducts(query, opts);
    return rawProducts.flatMap(normalizeEsimProduct);
  }

  async listEsims(opts: { country?: string; limit?: number } = {}): Promise<Product[]> {
    const rawProducts = await this.client.listEsimProducts(opts);
    return rawProducts.flatMap(normalizeEsimProduct);
  }

  async getProductDetails(bitrefillProductId: string): Promise<Product[]> {
    const raw = await this.client.getEsimProductDetails(bitrefillProductId);
    return normalizeEsimProduct(raw);
  }

  /**
   * Fetches a FRESH, FULLY-RECONSTRUCTED Product for the exact
   * merchantProductId referenced - never anything the agent asserted about
   * the product (name, category, merchantId, currency, price all come from
   * this live lookup, not the agent's proposal). This is what the agent
   * orchestration layer (Phase F) must call before authorization: it binds
   * verification to the exact product+package by construction, since
   * `merchantProductId` already encodes both (see normalize.ts). Returns
   * null if the specific package can no longer be found (discontinued, out
   * of stock, etc.) - callers must treat "cannot verify" as equivalent to a
   * mismatch and fail closed, never fall back to trusting the agent.
   */
  async getVerifiedProduct(merchantProductId: string): Promise<Product | null> {
    const { productId } = parseMerchantProductId(merchantProductId);
    const raw: BitrefillProductRaw = await this.client.getEsimProductDetails(productId);
    const products = normalizeEsimProduct(raw);
    return products.find((p) => p.merchantProductId === merchantProductId) ?? null;
  }

  /** Convenience wrapper over getVerifiedProduct() for callers that only need the price. */
  async getVerifiedPriceMinor(merchantProductId: string): Promise<number | null> {
    const product = await this.getVerifiedProduct(merchantProductId);
    return product ? product.priceMinor : null;
  }
}
