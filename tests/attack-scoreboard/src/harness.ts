import { randomUUID } from "node:crypto";
import type { BlockchainTxRequest, BlockchainTxResult, Order, ProposedOrder } from "@obscura/contracts";
import { BitrefillClient } from "@obscura/bitrefill-client";
import { MockZcashAdapter } from "@obscura/zcash-adapter";
// The scoreboard attacks the REAL production code, imported from source, not re-implementations.
import { openDatabase } from "../../../services/api/src/db/client.js";
import { MandateRepository } from "../../../services/api/src/repositories/mandateRepository.js";
import { OrderRepository } from "../../../services/api/src/repositories/orderRepository.js";
import { NonceRepository } from "../../../services/api/src/repositories/nonceRepository.js";
import { MandateService } from "../../../services/api/src/mandate/mandateService.js";
import { OrderAuthorizationService } from "../../../services/api/src/mandate/orderAuthorizationService.js";
import { ProductDiscoveryService } from "../../../services/api/src/bitrefill/productDiscoveryService.js";
import { AgentOrchestrator } from "../../../services/api/src/agent/orchestrator.js";
import { SignerService, SqliteSignerStore } from "../../../apps/signer/src/index.js";

export const TOKEN_SECRET = "scoreboard-token-secret";
export const SIGNER_AUTH_SECRET = "scoreboard-signer-auth-secret";
export const SETTLEMENT_ADDRESS = "utest1demosettlementaddress";
export const SWEEP_ADDRESS = "utest1usermainwallet";
export const ZATOSHI_PER_MINOR = 10_000;
export const ATTACKER_ADDRESS = "utest1attackerdrainaddress";

/** Records every transaction the signer actually asks the wallet to build. */
export class SpyAdapter extends MockZcashAdapter {
  sent: BlockchainTxRequest[] = [];
  override async send(request: BlockchainTxRequest): Promise<BlockchainTxResult> {
    this.sent.push(request);
    return super.send(request);
  }
}

export interface Env {
  db: ReturnType<typeof openDatabase>;
  clock: { now: Date };
  adapter: SpyAdapter;
  mandateRepo: MandateRepository;
  orders: OrderRepository;
  mandates: MandateService;
  auth: OrderAuthorizationService;
  signer: SignerService;
  /** Creates a funded mandate (with its own envelope wallet) and returns its id. */
  newMandate(over?: { categories?: string[]; merchants?: string[] | null; totalCapMinor?: number; perOrderCapMinor?: number | null; durationHours?: number; funded?: boolean }): Promise<string>;
  proposal(mandateId: string, over?: { priceMinor?: number; category?: string; merchantId?: string; name?: string }): ProposedOrder;
  /** Runs the same path production does: guardian + reservation. */
  authorize(proposed: ProposedOrder, verifiedPriceMinor?: number): { order: Order; guardian: ReturnType<OrderAuthorizationService["authorize"]>["guardian"] };
  spent(mandateId: string): number;
}

export async function createEnv(): Promise<Env> {
  const db = openDatabase(":memory:");
  const clock = { now: new Date("2026-11-04T12:00:00.000Z") };
  const now = () => clock.now;
  const mandateRepo = new MandateRepository(db);
  const orders = new OrderRepository(db);
  const nonces = new NonceRepository(db);
  const mandates = new MandateService(mandateRepo, now);
  const auth = new OrderAuthorizationService(db, mandateRepo, orders, nonces, TOKEN_SECRET, now);
  const adapter = new SpyAdapter();
  const signer = new SignerService(
    new SqliteSignerStore(db),
    adapter,
    { tokenSecret: TOKEN_SECRET, settlementAddress: SETTLEMENT_ADDRESS, sweepAddress: SWEEP_ADDRESS, zatoshiPerMinor: ZATOSHI_PER_MINOR },
    now,
  );

  return {
    db,
    clock,
    adapter,
    mandateRepo,
    orders,
    mandates,
    auth,
    signer,
    async newMandate(over = {}) {
      const m = mandates.create("demo-user", {
        allowedCategories: over.categories ?? ["esim"],
        allowedMerchants: over.merchants ?? null,
        totalCapMinor: over.totalCapMinor ?? 3000,
        perOrderCapMinor: over.perOrderCapMinor ?? null,
        currency: "USD",
        durationHours: over.durationHours ?? 24,
      });
      if (over.funded !== false) {
        const wallet = await adapter.createWallet(`m-${m.id}`);
        adapter.credit(wallet.walletRef, 500_000_000);
        mandateRepo.setFunding(m.id, wallet.walletRef, wallet.address);
      }
      return m.id;
    },
    proposal(mandateId, over = {}) {
      const priceMinor = over.priceMinor ?? 1000;
      return {
        mandateId,
        priceMinor,
        product: {
          merchantProductId: `esim-${randomUUID().slice(0, 8)}`,
          name: over.name ?? "Japan 5GB eSIM",
          priceMinor,
          currency: "USD",
          category: over.category ?? "esim",
          merchantId: over.merchantId ?? "bitrefill-esim-jp",
        },
      };
    },
    authorize(proposed, verifiedPriceMinor) {
      return auth.authorize(proposed, verifiedPriceMinor ?? proposed.priceMinor);
    },
    spent: (id) => mandates.get(id).spentMinor,
  };
}

/** A fixture-backed Bitrefill client: no network, fully deterministic. */
export function fixtureBitrefill(products: Array<{ id: string; name: string; packageId: string; value: string; price: number }>): BitrefillClient {
  const fetchImpl = (async (url: string | URL) => {
    const m = String(url).match(/\/products\/esims\/([^/?]+)/);
    const p = products.find((x) => x.id === decodeURIComponent(m?.[1] ?? ""));
    if (!p) return new Response(JSON.stringify({ error_code: "not_found", message: "none" }), { status: 404 });
    return new Response(
      JSON.stringify({ data: { id: p.id, name: p.name, currency: "USD", packages: [{ package_id: p.packageId, value: p.value, price: p.price }] } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return new BitrefillClient({ apiKey: "scoreboard", fetchImpl });
}

export function orchestratorFor(env: Env, client: BitrefillClient, driver: ConstructorParameters<typeof AgentOrchestrator>[0]) {
  return new AgentOrchestrator(driver, new ProductDiscoveryService(client), env.auth, 4, 2000);
}
