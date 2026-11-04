import { CliZcashAdapter } from "@obscura/zcash-adapter";
import {
  SignerMandateRepository,
  SignerOrderRepository,
  SignerService,
  WalletOpsService,
  ZcashBlockchainAdapter,
  buildSignerServer,
  openSignerDatabase,
} from "./index.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const db = openSignerDatabase(required("OBSCURA_DB_PATH"));
db.exec("PRAGMA busy_timeout = 5000;");
const mandates = new SignerMandateRepository(db);
const orders = new SignerOrderRepository(db);

const zcash = new CliZcashAdapter({ binaryPath: required("ZCASH_DEVTOOL_PATH"), walletsRoot: required("SIGNER_WALLETS_DIR") });

// The ONLY address the signer will ever pay an order to. Fixed operator config -
// the agent and frontend cannot choose or widen it. MVP: a demo settlement
// wallet, NOT Bitrefill (docs/architecture/demo-scope.md).
const settlementAddress = required("DEMO_SETTLEMENT_ADDRESS");

const signer = new SignerService(
  db,
  mandates,
  orders,
  required("GUARDIAN_HMAC_SECRET"),
  new ZcashBlockchainAdapter(zcash, mandates),
  () => Date.now(),
  // A real send builds a proof and can take a while; past this the outcome is treated as UNKNOWN (BROADCAST_UNCERTAIN), never as a failure.
  Number(process.env.SIGNER_ADAPTER_TIMEOUT_MS ?? 60_000),
  new Set([settlementAddress]),
);
const wallets = new WalletOpsService(mandates, orders, zcash, { sweepAddress: required("USER_SWEEP_ADDRESS") });

const app = await buildSignerServer(signer, wallets, required("SIGNER_AUTH_SECRET"));
// Loopback only: the signer must never be reachable from the frontend or the agent.
await app.listen({ port: Number(process.env.SIGNER_PORT ?? 8789), host: "127.0.0.1" });
