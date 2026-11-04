import { CliZcashAdapter } from "@obscura/zcash-adapter";
import { buildSignerServer, SignerService, SqliteSignerStore } from "./index.js";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const db = new DatabaseSync(required("OBSCURA_DB_PATH"));
db.exec("PRAGMA busy_timeout = 5000;");

const service = new SignerService(
  new SqliteSignerStore(db),
  new CliZcashAdapter({ binaryPath: required("ZCASH_DEVTOOL_PATH"), walletsRoot: required("SIGNER_WALLETS_DIR") }),
  {
    tokenSecret: required("GUARDIAN_HMAC_SECRET"),
    settlementAddress: required("DEMO_SETTLEMENT_ADDRESS"),
    sweepAddress: required("USER_SWEEP_ADDRESS"),
    zatoshiPerMinor: Number(process.env.DEMO_ZATOSHI_PER_MINOR ?? 10_000),
  },
);

const app = await buildSignerServer(service, required("SIGNER_AUTH_SECRET"));
// Loopback only: the signer must never be reachable from the frontend or the agent.
await app.listen({ port: Number(process.env.SIGNER_PORT ?? 8789), host: "127.0.0.1" });
